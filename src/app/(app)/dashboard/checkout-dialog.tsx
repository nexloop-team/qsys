"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Printer } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { computeBill } from "@/lib/bill";
import { formatINR } from "@/lib/format";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Field, Input, buttonClass } from "@/components/ui";
import { WhatsAppButton } from "../bills/[id]/whatsapp-button";
import { PaymentFields, type PaymentRow } from "./payment-fields";
import { DiscountFields, discountReady } from "./discount-fields";
import type { FloorPlan, FloorSettings, FloorStation, LiveSession } from "./types";
import { SESSION_MODE_LABEL } from "@/lib/constants";

const METHOD_NAME = { cash: "Cash", upi: "UPI", wallet: "Wallet" } as const;

export function CheckoutDialog({
  open,
  onOpenChange,
  sessions,
  stations,
  plans,
  settings,
  canWriteOff = false,
  venueName,
  supabase,
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
  supabase: SupabaseClient<Database>;
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

  const billable = sessions.filter((s) => s.status === "ended" && Number(s.outstanding) > 0);
  const primaryPhone = billable.find((s) => s.customer_phone)?.customer_phone;
  const primaryName = billable.find((s) => s.customer_name)?.customer_name;
  // The wallet that can pay is the bill's own player (the database charges the same one).
  const customerId = billable.find((s) => s.customer_id)?.customer_id ?? null;

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    supabase
      .from("customers")
      .select("wallet_balance")
      .eq("id", customerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWalletBalance(Number(data?.wallet_balance ?? 0));
      });
    return () => {
      cancelled = true;
    };
  }, [open, customerId, supabase]);
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
        p_payments: payments,
        p_discount_reason: bill.discount > 0 ? discountReason.trim() : null,
      });
      if (res.error || !res.data) return setError(res.error?.message ?? "Couldn't create the bill.");
      const invoiceId = res.data;
      const { data: inv } = await supabase.from("invoices").select("number, total").eq("id", invoiceId).single();
      setPaid({ id: invoiceId, number: inv?.number ?? "", total: Number(inv?.total ?? bill.total) });
    });

  const doWriteOff = () =>
    startTransition(async () => {
      setError(undefined);
      for (const s of billable) {
        const { error } = await supabase.rpc("write_off_session", { p_session_id: s.id, p_reason: writeOff ?? "" });
        if (error) return setError(error.message);
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
            <Link href={`/bills/${paid.id}`} target="_blank" className={buttonClass("secondary")}>
              <Printer /> Print bill
            </Link>
            <WhatsAppButton
              phone={primaryPhone}
              venueName={venueName}
              billNumber={paid.number}
              dateTime={new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              items={lines.map((l) => ({
                description: `${l.station?.name ?? "Station"} · ${SESSION_MODE_LABEL[l.session.mode].toLowerCase()}`,
                amount: formatINR(l.amount),
              }))}
              total={formatINR(paid.total)}
              paidBy={payments.map((p) => METHOD_NAME[p.method]).join(" + ") || "—"}
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
        <p className="text-sm text-muted">Nothing left to collect for this session.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {lines.map((l) => (
              <li key={l.session.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {l.station?.name ?? "Station"}
                  <span className="text-muted">
                    {" "}
                    · {l.session.mode === "prepaid" ? "fixed time" : "open time"}
                    {l.session.customer_name ? ` · ${l.session.customer_name}` : ""}
                  </span>
                </span>
                <span className="num">{formatINR(l.amount)}</span>
              </li>
            ))}
          </ul>

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

          <PaymentFields
            total={bill.total}
            onChange={setPayments}
            walletBalance={walletBalance}
            playerName={primaryName ?? undefined}
          />

          <ErrorText>{error}</ErrorText>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Not now
            </Button>
            <Button
              onClick={confirm}
              disabled={
                pending ||
                bill.total <= 0 ||
                !discountReady(bill.subtotal, discount, discountReason, canWriteOff ? null : settings.staffMaxDiscountPct)
              }
            >
              {pending ? "Saving…" : `Mark paid ${formatINR(bill.total)}`}
            </Button>
          </div>

          {canWriteOff &&
            (writeOff === null ? (
              <button
                type="button"
                className="self-center text-xs text-muted underline-offset-4 hover:text-danger hover:underline"
                onClick={() => setWriteOff("")}
              >
                Write off (player left without paying)
              </button>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <Field label="Reason for write-off">
                  <Input value={writeOff} onChange={(e) => setWriteOff(e.target.value)} placeholder="e.g. walked out" />
                </Field>
                <Button variant="danger" size="sm" disabled={pending || writeOff.trim().length < 3} onClick={doWriteOff}>
                  Write off {formatINR(bill.subtotal)}
                </Button>
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
}
