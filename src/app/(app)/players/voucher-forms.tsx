"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Printer, Ticket, X } from "lucide-react";
import { createVouchers, redeemVoucher, voidVoucher } from "./actions";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, SubmitButton } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

/** ABCDEFGH → ABCD-EFGH */
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

// Owner: make a batch of vouchers, then copy or print the codes.
export function CreateVouchersButton({ venueName }: { venueName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("100");
  const [state, action] = useActionState(
    async (prev: (ActionState & { codes?: string[] }) | null, fd: FormData) => {
      const res = await createVouchers(prev, fd);
      if (res?.codes) router.refresh();
      return res;
    },
    null,
  );
  const codes = state?.codes ?? [];

  const print = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const doc = w.document;
    doc.title = "Vouchers";
    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:system-ui,sans-serif;margin:24px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}" +
      ".v{border:1.5px dashed #555;border-radius:10px;padding:14px}.n{font-size:12px;color:#555}.a{font-size:22px;font-weight:700;margin:4px 0}" +
      ".c{font-family:ui-monospace,monospace;font-size:20px;letter-spacing:.12em}@media print{body{margin:8mm}}";
    doc.head.append(style);
    const grid = doc.createElement("div");
    grid.className = "grid";
    for (const code of codes) {
      const card = doc.createElement("div");
      card.className = "v";
      const venue = doc.createElement("div");
      venue.className = "n";
      venue.textContent = `${venueName} · voucher`;
      const value = doc.createElement("div");
      value.className = "a";
      value.textContent = `₹${Number(amount).toLocaleString("en-IN")}`;
      const c = doc.createElement("div");
      c.className = "c";
      c.textContent = showCode(code);
      const how = doc.createElement("div");
      how.className = "n";
      how.textContent = "Use once. Show at the counter, or type it in the PC menu.";
      card.append(venue, value, c, how);
      grid.append(card);
    }
    doc.body.append(grid);
    w.focus();
    w.print();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Ticket /> Make vouchers
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Make vouchers" description="One-time codes that add money to a player's wallet.">
        {codes.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{state?.ok} Each code works once.</p>
            <ul className="num grid max-h-64 grid-cols-2 gap-1.5 overflow-auto rounded-xl border border-line bg-subtle p-3 text-[15px] tracking-[0.08em] sm:grid-cols-3">
              {codes.map((c) => (
                <li key={c} className="select-all">
                  {showCode(c)}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(codes.map(showCode).join("\n"))}>
                <Copy /> Copy codes
              </Button>
              <Button variant="secondary" onClick={print}>
                <Printer /> Print
              </Button>
              <Button variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="How many">
                <Input name="count" type="number" min={1} max={100} defaultValue={5} required />
              </Field>
              <Field label="Worth (₹ each)">
                <Input name="amount" type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
            </div>
            <Field label="Expires on" hint="Optional. The last day it can be used.">
              <Input name="expires_on" type="date" />
            </Field>
            <Field label="Note" hint="For you, e.g. Instagram contest or Diwali offer. Shown in the player's wallet history.">
              <Input name="note" maxLength={80} placeholder="Instagram contest" />
            </Field>
            <FormMessage state={state} />
            <SubmitButton>Make vouchers</SubmitButton>
          </form>
        )}
      </Modal>
    </>
  );
}

export function VoidVoucherButton({ voucherId, code }: { voucherId: string; code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={`Cancel voucher ${showCode(code)}`}
        onClick={() => {
          if (!confirm(`Cancel voucher ${showCode(code)}? It stops working.`)) return;
          start(async () => {
            const res = await voidVoucher(voucherId);
            setError(res.error);
            if (!res.error) router.refresh();
          });
        }}
      >
        <X />
      </Button>
    </span>
  );
}

// Staff on a player's page: type the code from the player's slip or phone.
export function RedeemVoucherButton({ customerId, playerName }: { customerId: string; playerName: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await redeemVoucher(prev, fd);
    if (res?.ok) setCode("");
    return res;
  }, null);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Ticket /> Voucher
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`Use a voucher · ${playerName}`} description="The voucher's value goes into the wallet as bonus credit.">
        <form action={action} className="flex flex-col gap-3.5">
          <input type="hidden" name="customerId" value={customerId} />
          <Field label="Voucher code">
            <Input
              name="code"
              value={code}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              className="num text-lg tracking-[0.12em] uppercase"
              onChange={(e) => {
                const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
                setCode(raw.length > 4 ? showCode(raw) : raw);
              }}
            />
          </Field>
          <FormMessage state={state} />
          <SubmitButton>Add to wallet</SubmitButton>
        </form>
      </Modal>
    </>
  );
}
