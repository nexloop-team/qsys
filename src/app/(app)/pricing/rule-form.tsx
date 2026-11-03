"use client";

import { useActionState, useEffect, useState } from "react";
import { Clock, Pencil } from "lucide-react";
import { saveRateRule } from "./actions";
import { DAY_LABELS } from "@/lib/constants";
import { toTimeInput } from "@/lib/format";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export type RuleValues = {
  id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  per_hour: number;
};

// "Time rate" (add) or a pencil (edit an existing rule).
export function RuleDialogButton({ ratePlanId, rule }: { ratePlanId: string; rule?: RuleValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {rule ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${rule.name}`} title="Edit">
          <Pencil />
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Clock /> Time rate
        </Button>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={rule ? `Edit ${rule.name}` : "Add a time-based rate"}
        description="E.g. a cheaper afternoon happy hour, or a higher weekend rate."
      >
        {open && <RuleForm ratePlanId={ratePlanId} rule={rule} onSaved={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function RuleForm({ ratePlanId, rule, onSaved }: { ratePlanId: string; rule?: RuleValues; onSaved: () => void }) {
  const [state, action] = useActionState(saveRateRule, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);
  const days = new Set(rule?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="rate_plan_id" value={ratePlanId} />
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input name="name" placeholder="Happy hour" defaultValue={rule?.name} required />
        </Field>
        <Field label="From">
          <Input name="start_time" type="time" defaultValue={rule ? toTimeInput(rule.start_time) : "12:00"} required />
        </Field>
        <Field label="To" hint="Earlier than From runs past midnight.">
          <Input name="end_time" type="time" defaultValue={rule ? toTimeInput(rule.end_time) : "16:00"} required />
        </Field>
        <Field label="Price per hour (₹)" className="col-span-2">
          <Input name="per_hour" type="number" min={0} step="0.01" defaultValue={rule?.per_hour} required />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, i) => (
            <label
              key={label}
              className="cursor-pointer rounded-lg border border-line-strong px-2.5 py-1 text-[13px] font-medium text-muted transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input type="checkbox" name="days_of_week" value={i} defaultChecked={days.has(i)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton className="self-end">{rule ? "Save rate" : "Add rate"}</SubmitButton>
    </form>
  );
}
