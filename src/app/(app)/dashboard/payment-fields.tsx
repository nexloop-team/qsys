"use client";

import { useEffect, useState } from "react";
import { Banknote, QrCode, Split } from "lucide-react";
import { formatINR } from "@/lib/format";
import { Button, Field, Input, Segmented } from "@/components/ui";

// Venues take cash and UPI only.
export type PaymentMethod = "cash" | "upi";
export type PaymentRow = { method: PaymentMethod; amount: number; reference?: string };

// Collects how a bill is paid. Emits rows that add up to `total`.
// UPI is paid on the venue's own counter QR; staff confirm it arrived, then mark paid.
export function PaymentFields({ total, onChange }: { total: number; onChange: (rows: PaymentRow[]) => void }) {
  const [split, setSplit] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState("");
  // Split: part in cash, the rest on UPI.
  const [cashPart, setCashPart] = useState("");

  const cashAmount = Math.min(Math.max(Number(cashPart) || 0, 0), total);
  const upiAmount = Math.round((total - cashAmount) * 100) / 100;

  useEffect(() => {
    if (!split) {
      onChange(total > 0 ? [{ method, amount: total, reference: reference || undefined }] : []);
    } else {
      onChange(
        [
          { method: "cash" as const, amount: cashAmount },
          { method: "upi" as const, amount: upiAmount, reference: reference || undefined },
        ].filter((r) => r.amount > 0),
      );
    }
  }, [split, method, reference, total, cashAmount, upiAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const usesUpi = split ? upiAmount > 0 : method === "upi";
  const change = Number(received) - total;

  return (
    <div className="flex flex-col gap-3">
      {!split ? (
        <>
          <Segmented
            value={method}
            onChange={setMethod}
            className="w-full"
            options={[
              { value: "cash", label: <><Banknote /> Cash</> },
              { value: "upi", label: <><QrCode /> UPI</> },
            ]}
          />
          {method === "cash" && (
            <Field label="Cash received (optional)" hint={received && change >= 0 ? `Return ${formatINR(change)}` : undefined}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={String(total)}
              />
            </Field>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_140px] items-center gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Banknote className="size-4 text-muted" /> Cash
            </span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={total}
              value={cashPart}
              onChange={(e) => setCashPart(e.target.value)}
              placeholder="Amount"
              aria-label="Cash amount"
            />
          </div>
          <div className="grid grid-cols-[1fr_140px] items-center gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <QrCode className="size-4 text-muted" /> UPI (the rest)
            </span>
            <div className="num flex h-9 items-center justify-end rounded-lg border border-line bg-subtle px-3 text-sm text-muted">
              {formatINR(upiAmount)}
            </div>
          </div>
        </div>
      )}

      {usesUpi && (
        <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] text-muted">
          Player pays on your counter UPI QR. Check the payment has arrived before marking it paid.
        </p>
      )}

      {usesUpi && (
        <Field label="UPI reference (optional)" hint="Transaction ID from the payment screen, for matching later.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} />
        </Field>
      )}

      <Button variant="ghost" size="sm" className="self-start" onClick={() => setSplit(!split)}>
        <Split /> {split ? "Single payment" : "Split payment"}
      </Button>
    </div>
  );
}
