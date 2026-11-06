"use client";

import { formatINR } from "@/lib/format";
import { Field, Input, cx } from "@/components/ui";

const REASONS = ["Regular player", "Birthday", "Happy hour", "Fault / complaint", "Staff / friend"];

// Discount amount + reason. Staff are capped at `maxPct` of the bill (the database enforces
// the same rule); the owner passes maxPct = null for no cap.
export function DiscountFields({
  subtotal,
  value,
  onChange,
  reason,
  onReasonChange,
  maxPct,
}: {
  subtotal: number;
  value: string;
  onChange: (v: string) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  maxPct: number | null;
}) {
  const amount = Number(value) || 0;
  const cap = maxPct === null ? subtotal : Math.round(subtotal * maxPct) / 100;
  const over = amount > cap + 0.009;
  const presets = [5, 10, 15, 20].filter((p) => maxPct === null || p <= maxPct);

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Discount (₹)"
        hint={maxPct !== null ? `Staff can give up to ${maxPct}% (${formatINR(cap)}). More needs the owner.` : undefined}
      >
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={cap}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          aria-invalid={over}
        />
      </Field>
      {subtotal > 0 && presets.length > 0 && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          {presets.map((pct) => {
            const amt = Math.round((subtotal * pct) / 100);
            const active = amount === amt;
            return (
              <button
                key={pct}
                type="button"
                onClick={() => onChange(active ? "" : String(amt))}
                className={cx(
                  "cursor-pointer rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-line bg-subtle text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {pct}% ({formatINR(amt)})
              </button>
            );
          })}
          {amount > 0 && (
            <button type="button" onClick={() => onChange("")} className="ml-auto cursor-pointer text-xs text-muted hover:text-danger">
              Clear
            </button>
          )}
        </div>
      )}
      {over && <p className="text-xs text-danger">That&apos;s more than staff can give. Ask the owner.</p>}
      {amount > 0 && (
        <Field label="Reason for the discount" hint="Shows on the bill and in Activity.">
          <Input value={reason} onChange={(e) => onReasonChange(e.target.value)} maxLength={120} placeholder="e.g. Regular player" />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onReasonChange(r)}
                className={cx(
                  "cursor-pointer rounded-md border px-2 py-0.5 text-xs transition-colors",
                  reason === r ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-muted hover:text-fg",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

// True when the discount can be submitted (within the cap, and has a reason if non-zero).
export function discountReady(subtotal: number, value: string, reason: string, maxPct: number | null) {
  const amount = Number(value) || 0;
  if (amount <= 0) return true;
  const cap = maxPct === null ? subtotal : Math.round(subtotal * maxPct) / 100;
  return amount <= cap + 0.009 && reason.trim().length >= 3;
}
