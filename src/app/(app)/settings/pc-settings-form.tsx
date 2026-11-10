"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { savePcSettings } from "./actions";
import { Button, Field, FormMessage, Input, SubmitButton, Textarea, Toggle } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

type Game = { id: string; name: string; target: string };

const RESTRICTIONS = [
  {
    key: "task_manager",
    label: "Task Manager",
    description: "Players can't open Task Manager to close the timer or the lock.",
  },
  {
    key: "control_panel",
    label: "Control Panel and Settings",
    description: "No changing Windows settings, drivers or accounts.",
  },
  {
    key: "command_line",
    label: "Command prompt, PowerShell and Registry Editor",
    description: "Their windows are closed. Batch files that game launchers use keep working.",
  },
  {
    key: "usb_drives",
    label: "USB drives",
    description:
      "Blocks pen drives and USB disks (needs the PC app to run as administrator; otherwise a plugged-in drive is reported in Activity). Keyboards, mice and headsets keep working.",
  },
] as const;

// Settings for the QueSys PC app on this branch's PCs. Pairing itself is per PC, under Stations.
export function PcSettingsForm({
  blockedApps,
  lockMessage,
  playerLogin,
  games,
  restrictions,
  branchName,
  disabled,
}: {
  blockedApps: string[];
  lockMessage: string;
  playerLogin: boolean;
  games: Game[];
  restrictions: string[];
  branchName: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(savePcSettings, null);
  const [login, setLogin] = useState(playerLogin);
  const [rows, setRows] = useState<Game[]>(games);
  const [on, setOn] = useState<Set<string>>(() => new Set(restrictions));
  const setRow = (i: number, patch: Partial<Game>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection
          title="Lock screen"
          description={`Shown on every locked PC at ${branchName}, under the station name. Leave empty for the default "Ask at the counter to start your session".`}
        >
          <Field label="Message" hint="Up to 200 characters, such as your rates or Wi-Fi password.">
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
          title="Games menu"
          description="When a session starts, the PC shows a menu with these games, the player's wallet balance, snack orders and a Call staff button. It stays in the taskbar while they play."
        >
          <div className="flex min-w-0 flex-col gap-2">
            {rows.length === 0 && <p className="text-sm text-muted">No games yet. The menu still offers snacks and Call staff.</p>}
            {rows.map((r, i) => (
              <div key={r.id || i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                <input type="hidden" name="game_id" value={r.id} />
                <Field label="Name">
                  <Input name="game_name" value={r.name} maxLength={40} placeholder="Valorant" onChange={(e) => setRow(i, { name: e.target.value })} />
                </Field>
                <Field label="Program or launcher link" className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <Input
                    name="game_target"
                    value={r.target}
                    maxLength={300}
                    spellCheck={false}
                    className="num text-[13px]"
                    placeholder="steam://rungameid/730"
                    onChange={(e) => setRow(i, { target: e.target.value })}
                  />
                </Field>
                <Button
                  size="md"
                  variant="ghost"
                  aria-label={`Remove ${r.name || "game"}`}
                  className="row-start-1 col-start-2 sm:col-start-auto sm:row-start-auto"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            {rows.length < 40 && (
              <Button size="sm" variant="secondary" className="self-start" onClick={() => setRows([...rows, { id: "", name: "", target: "" }])}>
                <Plus /> Add game
              </Button>
            )}
            <p className="text-xs text-muted">
              Use the game&apos;s .exe or shortcut path on the PCs (the same on every PC), or a launcher link such as
              steam://rungameid/730 (Counter-Strike 2) or com.epicgames.launcher://apps/Fortnite?action=launch.
            </p>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Restrictions"
          description="Turned off for players while they have the PC, locked or playing. Staff unlock with the PIN gives a normal PC."
        >
          <div className="flex flex-col gap-4">
            {RESTRICTIONS.map((r) => (
              <Toggle
                key={r.key}
                name={`restrict_${r.key}`}
                checked={on.has(r.key)}
                onChange={(v) => {
                  const next = new Set(on);
                  if (v) next.add(r.key);
                  else next.delete(r.key);
                  setOn(next);
                }}
                label={r.label}
                description={r.description}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Blocked apps"
          description="Programs the PC app closes while a player is on the PC, such as Task Manager or cheat tools. Each one it closes shows up under Activity."
        >
          <Field label="Program names" hint="One per line, as shown in Task Manager › Details (for example taskmgr.exe). Up to 100.">
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
