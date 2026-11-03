"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveRatePlan } from "./actions";
import { STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

type Plan = Tables<"rate_plans">;

// How "extra players" reads for each kind of station. PCs are one person each.
const CONSOLE = {
  included: "Controllers included",
  includedHint: "Controllers covered by the hourly price.",
  extra: "Extra controller (₹/hr)",
  extraHint: "Charged per additional controller. 0 for none.",
};
const TABLE = {
  included: "Players included",
  includedHint: "Most halls charge per table, whatever the number of players.",
  extra: "Extra player (₹/hr)",
  extraHint: "Leave 0 to charge per table only.",
};
const PLAYER_FIELDS: Record<StationType, typeof CONSOLE | null> = {
  pc: null,
  ps5: CONSOLE,
  xbox: CONSOLE,
  pool: TABLE,
  snooker: TABLE,
  other: TABLE,
};

export function PlanDialogButton({
  stationType,
  tiers,
  plan,
}: {
  stationType: StationType;
  tiers: string[];
  plan?: Plan;
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
        <RatePlanForm stationType={stationType} tiers={tiers} plan={plan} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function RatePlanForm({
  stationType,
  tiers,
  plan,
  onSaved,
}: {
  stationType: StationType;
  tiers: string[];
  plan?: Plan;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(saveRatePlan, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);
  const players = PLAYER_FIELDS[stationType];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <input type="hidden" name="station_type" value={stationType} />
      <input type="hidden" name="name" value={plan?.name ?? `${STATION_TYPE_LABEL[stationType]} rate`} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price per hour (₹)">
          <Input name="per_hour" type="number" min={0} step="0.01" defaultValue={plan?.per_hour ?? ""} autoFocus required />
        </Field>
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
        <Field label="Minimum charge (minutes)" hint="0 for none. E.g. 30 = always bill at least 30 min.">
          <Input name="min_minutes" type="number" min={0} max={600} defaultValue={plan?.min_minutes ?? 0} />
        </Field>
        {players ? (
          <>
            <Field label={players.included} hint={players.includedHint}>
              <Input name="included_players" type="number" min={1} max={16} defaultValue={plan?.included_players ?? 1} />
            </Field>
            <Field label={players.extra} hint={players.extraHint}>
              <Input
                name="extra_player_per_hour"
                type="number"
                min={0}
                step="0.01"
                defaultValue={plan?.extra_player_per_hour ?? 0}
              />
            </Field>
          </>
        ) : (
          <>
            {/* One person per PC: no player-based pricing. */}
            <input type="hidden" name="included_players" value={1} />
            <input type="hidden" name="extra_player_per_hour" value={0} />
          </>
        )}
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
