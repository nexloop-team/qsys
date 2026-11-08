"use client";

import { useEffect, useState } from "react";
import { Banknote, QrCode, Split, Wallet } from "lucide-react";
import { formatINR } from "@/lib/format";
import { Button, Field, Input, Segmented } from "@/components/ui";

export type PaymentMethod = "cash" | "upi" | "wallet";
export type PaymentRow = { method: PaymentMethod; amount: number; reference?: string };

export function PaymentFields({
  total,
  onChange,
  walletBalance = 0,
  playerName,
}: {
  total: number;
  onChange: (rows: PaymentRow[]) => void;
  walletBalance?: number;
  playerName?: string;
}) {
  const [split, setSplit] = useState(false);
  const [userMethod, setUserMethod] = useState<PaymentMethod | null>(null);
  const method: PaymentMethod = userMethod ?? (walletBalance > 0 ? "wallet" : "cash");
  const [remainderMethod, setRemainderMethod] = useState<"cash" | "upi">("cash");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState("");
  const [cashPart, setCashPart] = useState("");

  const cashAmount = Math.min(Math.max(Number(cashPart) || 0, 0), total);
  const upiAmount = Math.round((total - cashAmount) * 100) / 100;

  useEffect(() => {
    if (total <= 0) {
      onChange([]);
      return;
    }

    if (method === "wallet") {
      if (walletBalance >= total) {
        onChange([{ method: "wallet", amount: total }]);
      } else {
        const fromWallet = Math.max(0, walletBalance);
        const remaining = Math.round((total - fromWallet) * 100) / 100;
        const rows: PaymentRow[] = [];
        if (fromWallet > 0) rows.push({ method: "wallet", amount: fromWallet });
        if (remaining > 0) rows.push({ method: remainderMethod, amount: remaining, reference: reference || undefined });
        onChange(rows);
      }
    } else if (!split) {
      onChange([{ method, amount: total, reference: reference || undefined }]);
    } else {
      onChange(
        [
          { method: "cash" as const, amount: cashAmount },
          { method: "upi" as const, amount: upiAmount, reference: reference || undefined },
        ].filter((r) => r.amount > 0),
      );
    }
  }, [split, method, remainderMethod, reference, total, cashAmount, upiAmount, walletBalance]); // eslint-disable-line react-hooks/exhaustive-deps

  const usesUpi =
    method === "wallet" && walletBalance < total
      ? remainderMethod === "upi"
      : split
        ? upiAmount > 0
        : method === "upi";

  const change = Number(received) - total;

  const methodOptions = [
    ...(walletBalance > 0
      ? [
          {
            value: "wallet" as const,
            label: (
              <>
                <Wallet /> Wallet ({formatINR(walletBalance)})
              </>
            ),
          },
        ]
      : []),
    { value: "cash" as const, label: <><Banknote /> Cash</> },
    { value: "upi" as const, label: <><QrCode /> UPI</> },
  ];

  return (
    <div className="flex flex-col gap-3">
      {!split ? (
        <>
          <Segmented
            value={method}
            onChange={(m) => setUserMethod(m as PaymentMethod)}
            className="w-full"
            options={methodOptions}
          />

          {method === "wallet" && (
            <div className="rounded-xl border border-ok/30 bg-ok/8 p-3 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-semibold text-ok">
                <span>{playerName ? `${playerName}'s wallet` : "Wallet"}</span>
                <span>{formatINR(Math.min(walletBalance, total))}</span>
              </div>
              {walletBalance >= total ? (
                <p className="text-muted">
                  The whole bill comes out of the wallet. Left after:{" "}
                  <span className="font-semibold text-fg">{formatINR(walletBalance - total)}</span>
                </p>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  <p className="text-muted">
                    The wallet covers {formatINR(walletBalance)}. Pay the other{" "}
                    <span className="font-semibold text-fg">{formatINR(total - walletBalance)}</span> by:
                  </p>
                  <Segmented
                    value={remainderMethod}
                    onChange={setRemainderMethod}
                    className="w-full"
                    options={[
                      { value: "cash", label: <><Banknote /> Cash ({formatINR(total - walletBalance)})</> },
                      { value: "upi", label: <><QrCode /> UPI ({formatINR(total - walletBalance)})</> },
                    ]}
                  />
                </div>
              )}
            </div>
          )}

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
        <p className="text-xs text-muted">Check the payment has arrived on your phone before marking it paid.</p>
      )}

      {usesUpi && (
        <Field label="UPI reference (optional)" hint="Transaction ID from the payment screen, for matching later.">
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="12-digit UTR"
            className="num"
          />
        </Field>
      )}

      {method !== "wallet" && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSplit(!split);
              setCashPart("");
              setReference("");
            }}
          >
            <Split /> {split ? "Single payment" : "Split cash + UPI"}
          </Button>
        </div>
      )}
    </div>
  );
}
