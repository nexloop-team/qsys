"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveRatePlan } from "./actions";
import { FRAME_TYPES, STATION_TYPE_LABEL, unitWord, type StationType } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton, Toggle } from "@/components/ui";

type Plan = Tables<"rate_plans">;

export function PlanDialogButton({
  stationType,
  tiers,
  plan,
  perPerson,
}: {
  stationType: StationType;
  tiers: string[];
  plan?: Plan;
  /** This station type is charged per person (Settings › Billing). */
  perPerson: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {plan ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Edit rate">
          <Pencil />
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus /> Add rate
        </Button>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`${plan ? "Edit" : "Add"} ${STATION_TYPE_LABEL[stationType]} rate`}
        wide
      >
        <RatePlanForm stationType={stationType} tiers={tiers} plan={plan} perPerson={perPerson} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function RatePlanForm({
  stationType,
  tiers,
  plan,
  perPerson,
  onSaved,
}: {
  stationType: StationType;
  tiers: string[];
  plan?: Plan;
  perPerson: boolean;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(saveRatePlan, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  const frameable = FRAME_TYPES.has(stationType);
  const [frames, setFrames] = useState(plan?.per_frame != null);
  // Per person or per table / console, as set under Settings › Billing.
  const each = perPerson ? ", per person" : `, per ${unitWord(stationType)}`;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <input type="hidden" name="station_type" value={stationType} />
      <input type="hidden" name="name" value={plan?.name ?? `${STATION_TYPE_LABEL[stationType]} rate`} />
      <input type="hidden" name="player_choices" value="[]" />
      <input type="hidden" name="frames_on" value={frameable && frames ? "on" : ""} />

      {frameable && (
        <Toggle
          name="frames_toggle"
          checked={frames}
          onChange={setFrames}
          label="Bill by frame too"
          description="Adds a Frames timer mode: staff tap + Frame as each frame starts. Turn it on per station type under Settings › Billing."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Price per hour (₹)${each}`}
          hint={perPerson ? "Staff enter how many play. Change it under Settings › Billing." : undefined}
        >
          <Input name="per_hour" type="number" min={0} step="0.01" defaultValue={plan?.per_hour ?? ""} autoFocus required />
        </Field>
        {frameable && frames ? (
          <Field label={`Price per frame (₹)${each}`}>
            <Input name="per_frame" type="number" min={0} step="0.01" defaultValue={plan?.per_frame ?? ""} required />
          </Field>
        ) : (
          <input type="hidden" name="per_frame" value="" />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Applies to">
          <Select name="tier" defaultValue={plan?.tier ?? ""}>
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Round time up to" hint="Exact minutes is fairest. 15 or 30 is common for tables.">
          <Select name="rounding_minutes" defaultValue={String(plan?.rounding_minutes ?? 1)}>
            <option value="1">Exact minutes</option>
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                Next {m} min
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum charge (minutes)" hint="0 for none. 30 means every session is billed at least 30 min.">
          <Input name="min_minutes" type="number" min={0} max={600} defaultValue={plan?.min_minutes ?? 0} />
        </Field>
        <Field label="GST rate override (%)" hint="Leave blank to use the branch rate.">
          <Input
            name="gst_rate_override"
            type="number"
            min={0}
            max={28}
            step="0.01"
            defaultValue={plan?.gst_rate_override ?? ""}
          />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton className="self-end">{plan ? "Save changes" : "Add rate"}</SubmitButton>
    </form>
  );
}

