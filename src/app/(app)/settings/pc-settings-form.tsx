"use client";

import { useActionState, useState } from "react";
import { savePcSettings } from "./actions";
import { Field, FormMessage, Input, SubmitButton, Textarea, Toggle } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

// Settings for the QueSys PC app on this branch's PCs. Pairing itself is per PC, under Stations.
export function PcSettingsForm({
  blockedApps,
  lockMessage,
  playerLogin,
  branchName,
  disabled,
}: {
  blockedApps: string[];
  lockMessage: string;
  playerLogin: boolean;
  branchName: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(savePcSettings, null);
  const [login, setLogin] = useState(playerLogin);

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection
          title="Lock screen"
          description={`Shown on every locked PC at ${branchName}, under the station name. Leave empty for the default "Ask at the counter to start your session".`}
        >
          <Field label="Message" hint="Up to 200 characters, e.g. rates or Wi-Fi details.">
            <Input name="lock_message" defaultValue={lockMessage} maxLength={200} placeholder="Ask at the counter to start your session" />
          </Field>
        </SettingsSection>

        <SettingsSection
          title="Player login"
          description="Players with a PIN can start their own session on a free PC. Set a player's PIN on their page under Players."
        >
          <Toggle
            name="pc_player_login"
            checked={login}
            onChange={setLogin}
            label="Players log in on the PC with mobile + PIN"
            description="Starts open time in their name. They pay at the counter at the end, like any session."
          />
        </SettingsSection>

        <SettingsSection
          title="Blocked apps"
          description="Programs the PC app closes while a player is on the PC, e.g. Task Manager or cheat tools. Each one it closes shows up under Activity."
        >
          <Field label="Program names" hint="One per line, as shown in Task Manager › Details, e.g. taskmgr.exe. Up to 100.">
            <Textarea
              name="blocked_apps"
              defaultValue={blockedApps.join("\n")}
              rows={6}
              spellCheck={false}
              placeholder={"taskmgr.exe\nregedit.exe\ncmd.exe"}
              className="num text-[13px]"
            />
          </Field>
        </SettingsSection>
      </fieldset>
      {!disabled && (
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
