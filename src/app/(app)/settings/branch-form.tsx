"use client";

import { useActionState } from "react";
import { saveBranchDetails } from "./actions";
import type { Tables } from "@/lib/database.types";
import { toTimeInput } from "@/lib/format";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

export function BranchForm({ branch, disabled }: { branch: Tables<"branches">; disabled: boolean }) {
  const [state, action] = useActionState(saveBranchDetails, null);

  return (
    <form action={action}>
      <SettingsSection title="Branch" description="Shown on bills and the PC lock screen. Opening hours are used to measure how busy you are.">
        <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Branch name">
            <Input name="name" defaultValue={branch.name} required />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" defaultValue={branch.phone ?? ""} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input name="address" defaultValue={branch.address ?? ""} />
          </Field>
          <Field label="Opens at">
            <Input name="opening_time" type="time" defaultValue={toTimeInput(branch.opening_time)} />
          </Field>
          <Field label="Closes at" hint="Earlier than opening means you close after midnight.">
            <Input name="closing_time" type="time" defaultValue={toTimeInput(branch.closing_time)} />
          </Field>
        </fieldset>
        {!disabled && (
          <div className="mt-4 border-t border-line pt-4">
            <SaveBar>
              <FormMessage state={state} />
              <SubmitButton>Save branch</SubmitButton>
            </SaveBar>
          </div>
        )}
      </SettingsSection>
    </form>
  );
}
