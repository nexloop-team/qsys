"use client";

import { useActionState, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { addRateRule } from "./actions";
import { DAY_LABELS } from "@/lib/constants";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export function RuleDialogButton({ ratePlanId }: { ratePlanId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Clock /> Time rate
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add a time-based rate"
        description="E.g. a cheaper afternoon happy hour, or a higher weekend rate."
      >
        <RuleForm ratePlanId={ratePlanId} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function RuleForm({ ratePlanId, onSaved }: { ratePlanId: string; onSaved: () => void }) {
  const [state, action] = useActionState(addRateRule, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="rate_plan_id" value={ratePlanId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input name="name" placeholder="Happy hour" required />
        </Field>
        <Field label="From">
          <Input name="start_time" type="time" defaultValue="12:00" required />
        </Field>
        <Field label="To" hint="Earlier than From runs past midnight.">
          <Input name="end_time" type="time" defaultValue="16:00" required />
        </Field>
        <Field label="Price per hour (₹)" className="col-span-2">
          <Input name="per_hour" type="number" min={0} step="0.01" required />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, i) => (
            <label
              key={label}
              className="cursor-pointer rounded-md border border-line-strong px-2.5 py-1 text-[13px] has-[:checked]:border-fg has-[:checked]:bg-invert has-[:checked]:text-invert-fg"
            >
              <input type="checkbox" name="days_of_week" value={i} defaultChecked className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton className="self-end">Add rate</SubmitButton>
    </form>
  );
}
