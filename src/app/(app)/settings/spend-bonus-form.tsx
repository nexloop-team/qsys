"use client";

import { useActionState, useState } from "react";
import { saveSpendBonus } from "./actions";
import { formatINR } from "@/lib/format";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

// "5% back": every bill a player pays in cash or UPI adds bonus credit to their wallet.
export function SpendBonusForm({ pct, disabled }: { pct: number; disabled: boolean }) {
  const [state, action] = useActionState(saveSpendBonus, null);
  const [value, setValue] = useState(pct > 0 ? String(pct) : "");
  const n = Number(value) || 0;

  return (
    <form action={action}>
      <SettingsSection
        title="Bonus on spending"
        description="A reason to come back: part of every bill goes into the player's wallet as bonus credit, to spend on their next visit. Only bills of a known player (picked on the bill, or their mobile number) and only the cash or UPI part count, rounded down to whole rupees. Cancelling the bill takes the bonus back."
      >
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
          <Field label="Bonus (% of the bill)" hint="0 or empty turns it off. Up to 20%.">
            <Input
              name="spend_bonus_pct"
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={value}
              placeholder="0"
              className="max-w-32"
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          {n > 0 && n <= 20 && (
            <p className="text-xs text-muted">
              A {formatINR(500)} bill paid in cash or UPI adds{" "}
              <span className="num font-medium text-fg">{formatINR(Math.floor((500 * n) / 100))}</span> to the player&apos;s wallet.
            </p>
          )}
        </fieldset>
      </SettingsSection>
      {!disabled && (
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save bonus</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
