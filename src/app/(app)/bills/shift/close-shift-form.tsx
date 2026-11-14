"use client";

import { useActionState, useState } from "react";
import { closeShift } from "./actions";
import { Field, FormMessage, Input, SubmitButton, cx } from "@/components/ui";
import { formatINR } from "@/lib/format";

// Count the drawer, see the difference before closing, and leave change for the next shift.
export function CloseShiftForm({ expected, lastFloat }: { expected: number; lastFloat: number }) {
  const [state, action] = useActionState(closeShift, null);
  const [counted, setCounted] = useState("");
  const [floatLeft, setFloatLeft] = useState(lastFloat > 0 ? String(lastFloat) : "");
  const n = Number(counted);
  const diff = counted === "" ? null : Math.round((n - expected) * 100) / 100;
  const handover = counted === "" ? null : Math.max(0, n - (Number(floatLeft) || 0));

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cash counted in the drawer (₹)">
          <Input
            name="counted"
            type="number"
            min={0}
            step="0.01"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0"
            required
            className="num text-lg"
          />
        </Field>
        <Field label="Leave in the drawer (₹)" hint="Change for the next shift. The rest goes to the owner.">
          <Input name="float_left" type="number" min={0} step="0.01" value={floatLeft} onChange={(e) => setFloatLeft(e.target.value)} placeholder="0" />
        </Field>
      </div>
      {diff !== null && (
        <div
          className={cx(
            "flex flex-wrap items-baseline justify-between gap-2 rounded-xl border px-4 py-3",
            diff === 0 ? "border-free/40 bg-free/8" : diff < 0 ? "border-over/40 bg-over/8" : "border-ending/40 bg-ending/8",
          )}
        >
          <span className="text-sm font-medium">
            {diff === 0 ? "Cash matches" : diff < 0 ? "Short" : "Over"}
          </span>
          <span className={cx("num text-xl font-semibold", diff === 0 ? "text-free" : diff < 0 ? "text-over" : "text-ending")}>
            {diff === 0 ? formatINR(0) : `${diff < 0 ? "−" : "+"}${formatINR(Math.abs(diff))}`}
          </span>
          {handover !== null && (
            <span className="w-full text-xs text-muted">
              Hand over <span className="num font-medium text-fg">{formatINR(handover)}</span> to the owner.
            </span>
          )}
        </div>
      )}
      <Field label="Note" hint="Optional, e.g. ₹200 taken out for milk.">
        <Input name="note" maxLength={200} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Close shift</SubmitButton>
    </form>
  );
}
