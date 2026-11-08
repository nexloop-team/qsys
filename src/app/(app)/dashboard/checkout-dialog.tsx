"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, Ban, CheckCircle2, Printer, UserRound } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { computeBill } from "@/lib/bill";
import { formatINR } from "@/lib/format";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, ErrorText, Field, Input, buttonClass } from "@/components/ui";
import { WhatsAppButton } from "../bills/[id]/whatsapp-button";
import { PaymentFields, type PaymentRow } from "./payment-fields";
import { DiscountFields, discountReady } from "./discount-fields";
import { PlayerField, type PlayerValue } from "./player-field";
import type { FloorPlan, FloorSettings, FloorStation, LiveSession } from "./types";
import { SESSION_MODE_LABEL } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";

const METHOD_NAME = { cash: "Cash", upi: "UPI", wallet: "Wallet" } as const;

// "3 frames" for frames, otherwise the timer mode ("open time", "fixed time").
function modeText(s: { mode: keyof typeof SESSION_MODE_LABEL; frames: number }) {
  return s.mode === "frames" ? `${s.frames} ${s.frames === 1 ? "frame" : "frames"}` : SESSION_MODE_LABEL[s.mode].toLowerCase();
}

// Shown only when it matters: the player already owes from before, or Pay later would take them over their limit.
function KhataNote({
  name,
  amount,
  owedElsewhere,
  limit,
}: {
  name: string;
  amount: number;
  owedElsewhere: number;
  limit: number | null;
}) {
  const after = owedElsewhere + amount;
  const over = limit !== null && after > limit;
  if (owedElsewhere <= 0 && !over) return null;
  return (
    <p className={`mb-2 flex items-start gap-1.5 text-xs ${over ? "text-ending" : "text-muted"}`}>
      {over && <AlertTriangle className="mt-px size-3.5 shrink-0" />}
      <span>
        {owedElsewhere > 0
          ? `${name} already owes ${formatINR(owedElsewhere)}. Pay later makes it ${formatINR(after)}.`
          : `Pay later leaves ${formatINR(after)} in ${name}'s name.`}
        {over && ` That's over the ${formatINR(limit)} limit: staff can't start their next session until it's paid.`}
      </span>
    </p>
  );
}

export function CheckoutDialog({
  open,
  onOpenChange,
  sessions,
  stations,
  plans,
  settings,
  canWriteOff = false,
  venueName,
  orgId,
  creditLimit,
  supabase,
  onRefresh,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: LiveSession[];
  stations: FloorStation[];
  plans: FloorPlan[];
  settings: FloorSettings;
  canWriteOff?: boolean;
  venueName: string;
  orgId: string;
  /** Venue-wide khata limit; null = none. */
  creditLimit: number | null;
  supabase: SupabaseClient<Database>;
  /** Reload the floor's sessions (after the payer changes). */
  onRefresh: () => Promise<void>;
  onDone: () => void;
}) {
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [paid, setPaid] = useState<{ id: string; number: string; total: number } | null>(null);
  const [writeOff, setWriteOff] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  // Who pays: the bill (or the khata, on "Not now") goes to this player.
  const [changingPayer, setChangingPayer] = useState(false);
  const [payer, setPayer] = useState<PlayerValue>({ phone: "", name: "", isNew: false, ready: false });
  const [khata, setKhata] = useState<{ owedElsewhere: number; limit: number | null } | null>(null);

  const billable = sessions.filter((s) => s.status === "ended" && Number(s.outstanding) > 0);
  const primaryPhone = billable.find((s) => s.customer_phone)?.customer_phone;
  const primaryName = billable.find((s) => s.customer_name)?.customer_name;
  // The wallet that can pay is the bill's own player (the database charges the same one).
  const customerId = billable.find((s) => s.customer_id)?.customer_id ?? null;

  const billableIds = billable.map((s) => s.id).join(",");
  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    const ids = billableIds.split(",");
    void Promise.all([
      supabase.from("customers").select("wallet_balance, credit_limit").eq("id", customerId).maybeSingle(),
      supabase
        .from("sessions")
        .select("id, outstanding")
        .eq("customer_id", customerId)
        .eq("status", "ended")
        .eq("written_off", false)
        .gt("outstanding", 0),
    ]).then(([cu, owed]) => {
      if (cancelled) return;
      setWalletBalance(Number(cu.data?.wallet_balance ?? 0));
      const own = cu.data?.credit_limit;
      setKhata({
        owedElsewhere: (owed.data ?? []).filter((s) => !ids.includes(s.id)).reduce((t, s) => t + Number(s.outstanding), 0),
        limit: own != null ? Number(own) : creditLimit,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, customerId, billableIds, creditLimit, supabase]);

  const changePayer = () =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await supabase.rpc("set_session_payer", {
        p_session_ids: billable.map((s) => s.id),
        p_phone: payer.phone,
        p_name: payer.isNew ? payer.name : null,
      });
      if (error) return setError(friendlyError(error));
      await onRefresh();
      setChangingPayer(false);
    });
  const lines = billable.map((s) => {
    const plan = plans.find((p) => p.id === s.rate_plan_id);
    return {
      session: s,
      station: stations.find((st) => st.id === s.station_id),
      amount: Number(s.outstanding),
      gstRate: plan?.gst_rate_override ?? settings.gstRate,
    };
  });
  const bill = computeBill(lines, Number(discount) || 0, {
    gstEnabled: settings.gstEnabled,
    pricesIncludeTax: settings.pricesIncludeTax,
  });
  const names = lines.map((l) => l.station?.name).filter(Boolean).join(", ");

  const confirm = () =>
    startTransition(async () => {
      setError(undefined);
      // One call: the database creates the bill and takes any wallet part, together or not at all.
      const res = await supabase.rpc("checkout", {
        p_session_ids: billable.map((s) => s.id),
        p_discount: bill.discount,
        p_payments: bill.total > 0 ? payments : [],
        p_discount_reason: bill.discount > 0 ? discountReason.trim() : null,
      });
      if (res.error || !res.data) return setError(friendlyError(res.error, "Couldn't create the bill."));
      const invoiceId = res.data;
      const { data: inv } = await supabase.from("invoices").select("number, total").eq("id", invoiceId).single();
      setPaid({ id: invoiceId, number: inv?.number ?? "", total: Number(inv?.total ?? bill.total) });
    });

  const doWriteOff = () =>
    startTransition(async () => {
      setError(undefined);
      for (const s of billable) {
        const { error } = await supabase.rpc("write_off_session", { p_session_id: s.id, p_reason: writeOff ?? "" });
        if (error) return setError(friendlyError(error));
      }
      onDone();
    });

  if (paid) {
    return (
      <Modal open={open} onOpenChange={(o) => !o && onDone()} title="Paid">
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-8 text-ok" />
          <p className="num text-3xl font-semibold">{formatINR(paid.total)}</p>
          <p className="text-sm text-muted">Bill {paid.number}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/bills/${paid.id}?print=1&from=floor`} className={buttonClass("secondary")}>
              <Printer /> Print bill
            </Link>
            <WhatsAppButton
              phone={primaryPhone}
              venueName={venueName}
              billNumber={paid.number}
              dateTime={new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              items={lines.map((l) => ({
                description: `${l.station?.name ?? "Station"} · ${modeText(l.session)}`,
                amount: formatINR(l.amount),
              }))}
              total={formatINR(paid.total)}
              paidBy={payments.map((p) => METHOD_NAME[p.method]).join(" + ") || "Free"}
              size="md"
            />
          </div>
          <Button onClick={onDone} className="w-full">
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Collect payment" description={names}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">
          {/* Just ended: the floor's copy may still say running for a moment. */}
          {sessions.some((s) => s.status !== "ended") ? "Loading the bill…" : "Nothing left to collect for this session."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {lines.map((l) => (
              <li key={l.session.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {l.station?.name ?? "Station"}
                  <span className="text-muted">
                    {" "}
                    · {modeText(l.session)}
                    {l.session.customer_name ? ` · ${l.session.customer_name}` : ""}
                  </span>
                </span>
                <span className="num">{formatINR(l.amount)}</span>
              </li>
            ))}
          </ul>

          {/* Who pays. On a table the losing side usually pays the whole bill. */}
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            {changingPayer ? (
              <>
                <PlayerField orgId={orgId} supabase={supabase} onChange={setPayer} />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setChangingPayer(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={changePayer} disabled={pending || !payer.ready}>
                    Bill to {payer.name || "this player"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <UserRound className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block text-xs text-muted">Who pays</span>
                  <span className="block truncate font-medium">
                    {primaryName ?? "No player"}
                    {primaryPhone && <span className="num font-normal text-muted"> · {primaryPhone}</span>}
                  </span>
                </span>
                <Button variant="secondary" size="sm" onClick={() => setChangingPayer(true)}>
                  Change
                </Button>
              </div>
            )}
          </div>

          <DiscountFields
            subtotal={bill.subtotal}
            value={discount}
            onChange={setDiscount}
            reason={discountReason}
            onReasonChange={setDiscountReason}
            maxPct={canWriteOff ? null : settings.staffMaxDiscountPct}
          />

          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-muted">Subtotal</dt>
            <dd className="num text-right">{formatINR(bill.subtotal)}</dd>
            {bill.discount > 0 && (
              <>
                <dt className="text-muted">Discount</dt>
                <dd className="num text-right">−{formatINR(bill.discount)}</dd>
              </>
            )}
            {settings.gstEnabled && (
              <>
                <dt className="text-muted">
                  Taxable value{settings.pricesIncludeTax ? " (GST included in prices)" : ""}
                </dt>
                <dd className="num text-right">{formatINR(bill.taxable)}</dd>
                <dt className="text-muted">CGST</dt>
                <dd className="num text-right">{formatINR(bill.cgst)}</dd>
                <dt className="text-muted">SGST</dt>
                <dd className="num text-right">{formatINR(bill.sgst)}</dd>
              </>
            )}
            <dt className="mt-1 border-t border-line pt-2 font-medium">Total</dt>
            <dd className="num mt-1 border-t border-line pt-2 text-right text-2xl font-semibold">
              {formatINR(bill.total)}
            </dd>
          </dl>

          {bill.total > 0 ? (
            <PaymentFields
              total={bill.total}
              onChange={setPayments}
              walletBalance={walletBalance}
              playerName={primaryName ?? undefined}
            />
          ) : (
            <p className="text-sm text-muted">Fully discounted: nothing to collect. The bill is still saved, with the reason.</p>
          )}

          {canWriteOff &&
            (writeOff === null ? (
              <Button type="button" variant="secondary" size="sm" className="text-danger" onClick={() => setWriteOff("")}>
                <Ban /> Write off: player left without paying
              </Button>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs text-muted">
                  The amount leaves what the player owes and shows as Written off in Reports and the activity log.
                </p>
                <Field label="Reason for write-off">
                  <Input value={writeOff} onChange={(e) => setWriteOff(e.target.value)} placeholder="Walked out" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setWriteOff(null)}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" disabled={pending || writeOff.trim().length < 3} onClick={doWriteOff}>
                    Write off {formatINR(bill.subtotal)}
                  </Button>
                </div>
              </div>
            ))}

          <StickyActions>
            <ErrorText>{error}</ErrorText>
            {khata && primaryName && <KhataNote name={primaryName} amount={bill.subtotal} {...khata} />}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={pending}>
                Pay later
              </Button>
              <Button
                size="lg"
                onClick={confirm}
                disabled={
                  pending ||
                  bill.subtotal <= 0 ||
                  !discountReady(bill.subtotal, discount, discountReason, canWriteOff ? null : settings.staffMaxDiscountPct)
                }
              >
                {pending ? "Saving…" : bill.total > 0 ? `Mark paid ${formatINR(bill.total)}` : "Close bill (free)"}
              </Button>
            </div>
          </StickyActions>
        </div>
      )}
    </Modal>
  );
}
