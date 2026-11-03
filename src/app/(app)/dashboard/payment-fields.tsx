"use client";

import { useEffect, useState } from "react";
import { Banknote, CreditCard, QrCode, Split } from "lucide-react";
import { formatINR } from "@/lib/format";
import { Button, Field, Input, Segmented, Select } from "@/components/ui";

export type PaymentMethod = "cash" | "upi" | "card";
export type PaymentRow = { method: PaymentMethod; amount: number; reference?: string };

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", upi: "UPI", card: "Card" };

// Collects how a bill is paid. Emits rows that add up to `total`.
// UPI is paid on the venue's own counter QR; staff confirm it arrived, then mark paid.
export function PaymentFields({ total, onChange }: { total: number; onChange: (rows: PaymentRow[]) => void }) {
  const [split, setSplit] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState("");
  const [first, setFirst] = useState<{ method: PaymentMethod; amount: string }>({ method: "cash", amount: "" });
  const [secondMethod, setSecondMethod] = useState<PaymentMethod>("upi");

  const firstAmount = Math.min(Math.max(Number(first.amount) || 0, 0), total);
  const secondAmount = Math.round((total - firstAmount) * 100) / 100;

  useEffect(() => {
    if (!split) {
      onChange(total > 0 ? [{ method, amount: total, reference: reference || undefined }] : []);
    } else {
      onChange(
        [
          { method: first.method, amount: firstAmount },
          { method: secondMethod, amount: secondAmount, reference: reference || undefined },
        ].filter((r) => r.amount > 0),
      );
    }
  }, [split, method, reference, total, first.method, firstAmount, secondMethod, secondAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const usesUpi = split ? first.method === "upi" || secondMethod === "upi" : method === "upi";
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
              { value: "card", label: <><CreditCard /> Card</> },
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
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Select
              value={first.method}
              onChange={(e) => setFirst({ ...first, method: e.target.value as PaymentMethod })}
              aria-label="First method"
            >
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={total}
              value={first.amount}
              onChange={(e) => setFirst({ ...first, amount: e.target.value })}
              placeholder="Amount"
              aria-label="First amount"
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Select
              value={secondMethod}
              onChange={(e) => setSecondMethod(e.target.value as PaymentMethod)}
              aria-label="Second method"
            >
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
            <div className="num flex h-9 items-center justify-end rounded-md border border-line px-3 text-sm text-muted">
              {formatINR(secondAmount)}
            </div>
          </div>
        </div>
      )}

      {usesUpi && (
        <p className="rounded-md border border-line px-3 py-2 text-[13px] text-muted">
          Player pays on your counter UPI QR. Check the payment has arrived before marking it paid.
        </p>
      )}

      {(method !== "cash" || split) && (
        <Field label="Reference (optional)" hint="UPI transaction ID or card slip number, for matching later.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} />
        </Field>
      )}

      <Button variant="ghost" size="sm" className="self-start" onClick={() => setSplit(!split)}>
        <Split /> {split ? "Single payment" : "Split payment"}
      </Button>
    </div>
  );
}
