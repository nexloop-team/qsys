"use client";

import { useActionState, useState } from "react";
import { saveStationTypes } from "./actions";
import type { StationType } from "@/lib/constants";
import { StationTypePicker } from "@/components/station-type-picker";
import { FormMessage, SubmitButton } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

export function StationTypesForm({ types: initial, disabled }: { types: StationType[]; disabled: boolean }) {
  const [state, action] = useActionState(saveStationTypes, null);
  const [types, setTypes] = useState(initial);

  return (
    <form action={action}>
      <SettingsSection
        title="Station types"
        description="What this venue has. Only these appear when adding stations, setting prices and choosing timer modes."
      >
        <fieldset disabled={disabled} className="min-w-0">
          <StationTypePicker name="station_types" value={types} onChange={setTypes} disabled={disabled} />
        </fieldset>
        {!disabled && (
          <div className="mt-4 border-t border-line pt-4">
            <SaveBar inline>
              {types.length === 0 ? (
                <p className="text-sm text-danger">Pick at least one.</p>
              ) : (
                <FormMessage state={state} />
              )}
              <SubmitButton disabled={types.length === 0}>Save types</SubmitButton>
            </SaveBar>
          </div>
        )}
      </SettingsSection>
    </form>
  );
}
