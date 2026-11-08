"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { saveRatePlan } from "./actions";
import { FRAME_TYPES, MULTIPLAYER_TYPES, STATION_TYPE_LABEL, playersWord, type StationType } from "@/lib/constants";
import { planChoices } from "@/lib/pricing";
import type { Tables } from "@/lib/database.types";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Segmented, Select, SubmitButton, Toggle } from "@/components/ui";

type Plan = Tables<"rate_plans">;
type ChoiceRow = { players: string; per_hour: string; per_frame: string };

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

// Sensible first choices: 2 and 4 for tables and consoles.
function startingChoices(plan?: Plan): ChoiceRow[] {
  const existing = plan ? planChoices(plan) : [];
  if (existing.length) {
    return existing.map((c) => ({
      players: String(c.players),
      per_hour: String(c.per_hour),
      per_frame: c.per_frame != null ? String(c.per_frame) : "",
    }));
  }
  const base = plan ? Number(plan.per_hour) : 0;
  const frame = plan?.per_frame != null ? Number(plan.per_frame) : 0;
  return [
    { players: "2", per_hour: base ? String(base) : "", per_frame: frame ? String(frame) : "" },
    { players: "4", per_hour: "", per_frame: "" },
  ];
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

  const multiplayer = MULTIPLAYER_TYPES.has(stationType);
  const frameable = FRAME_TYPES.has(stationType);
  const word = playersWord(stationType);

  const [pricing, setPricing] = useState<"same" | "choices">(plan && planChoices(plan).length ? "choices" : "same");
  const [choices, setChoices] = useState<ChoiceRow[]>(() => startingChoices(plan));
  const [frames, setFrames] = useState(plan?.per_frame != null);

  const byChoice = multiplayer && pricing === "choices";
  const setRow = (i: number, patch: Partial<ChoiceRow>) =>
    setChoices((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const choicesJson = byChoice
    ? JSON.stringify(
        choices.map((c) => ({
          players: Number(c.players),
          per_hour: c.per_hour === "" ? null : Number(c.per_hour),
          per_frame: frames ? (c.per_frame === "" ? null : Number(c.per_frame)) : null,
        })),
      )
    : "[]";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <input type="hidden" name="station_type" value={stationType} />
      <input type="hidden" name="name" value={plan?.name ?? `${STATION_TYPE_LABEL[stationType]} rate`} />
      <input type="hidden" name="player_choices" value={choicesJson} />
      <input type="hidden" name="frames_on" value={frameable && frames ? "on" : ""} />

      {multiplayer && (
        <Field label={`Price by number of ${word}`}>
          <Segmented
            value={pricing}
            onChange={setPricing}
            className="w-full"
            options={[
              { value: "same", label: "Same for any number" },
              { value: "choices", label: `Price per choice` },
            ]}
          />
        </Field>
      )}

      {frameable && (
        <Toggle
          name="frames_toggle"
          checked={frames}
          onChange={setFrames}
          label="Bill by frame too"
          description="Adds a Frames timer mode: staff tap + Frame as each frame starts. Turn it on per station type under Settings › Billing."
        />
      )}

      {byChoice ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Choices</span>
          <p className="-mt-1 text-xs text-muted">
            Staff pick one when starting, for example 2 {word} at ₹200/hr and 4 {word} at ₹300/hr. Happy-hour rates lower the smallest
            choice, and the others keep the same gap above it.
          </p>
          <ul className="flex flex-col gap-2">
            {choices.map((c, i) => (
              <li key={i} className="flex items-end gap-2">
                <Field label={i === 0 ? capitalize(word) : <span className="sr-only">{word}</span>} className="w-20 shrink-0">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={16}
                    value={c.players}
                    onChange={(e) => setRow(i, { players: e.target.value })}
                    aria-label={`${capitalize(word)} in choice ${i + 1}`}
                    required
                  />
                </Field>
                <Field label={i === 0 ? "₹ per hour" : <span className="sr-only">₹ per hour</span>} className="min-w-0 flex-1">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={c.per_hour}
                    onChange={(e) => setRow(i, { per_hour: e.target.value })}
                    aria-label={`Price per hour for choice ${i + 1}`}
                    required
                  />
                </Field>
                {frames && (
                  <Field label={i === 0 ? "₹ per frame" : <span className="sr-only">₹ per frame</span>} className="min-w-0 flex-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={c.per_frame}
                      onChange={(e) => setRow(i, { per_frame: e.target.value })}
                      aria-label={`Price per frame for choice ${i + 1}`}
                      required
                    />
                  </Field>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-0.5 shrink-0"
                  aria-label={`Remove choice ${i + 1}`}
                  disabled={choices.length <= 2}
                  onClick={() => setChoices((rows) => rows.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {choices.length < 8 && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                const last = Number(choices.at(-1)?.players) || 0;
                setChoices((rows) => [...rows, { players: String(Math.min(16, last + 1)), per_hour: "", per_frame: "" }]);
              }}
            >
              <Plus /> Add choice
            </Button>
          )}
          {/* The database sets the base price from the smallest choice. */}
          <input type="hidden" name="per_hour" value={choices[0]?.per_hour || "0"} />
          <input type="hidden" name="per_frame" value={frames ? choices[0]?.per_frame || "0" : ""} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price per hour (₹)">
            <Input name="per_hour" type="number" min={0} step="0.01" defaultValue={plan?.per_hour ?? ""} autoFocus required />
          </Field>
          {frameable && frames ? (
            <Field label="Price per frame (₹)">
              <Input name="per_frame" type="number" min={0} step="0.01" defaultValue={plan?.per_frame ?? ""} required />
            </Field>
          ) : (
            <input type="hidden" name="per_frame" value="" />
          )}
        </div>
      )}

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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
