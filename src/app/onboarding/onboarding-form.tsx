"use client";

import { useActionState, useState } from "react";
import { createOrganization, joinWithCode } from "./actions";
import { Field, FormMessage, Input, Select, SubmitButton, cx } from "@/components/ui";
import { StationTypePicker } from "@/components/station-type-picker";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Colombo"];

export function OnboardingChoice() {
  const [mode, setMode] = useState<"create" | "join">("create");

  return (
    <div className="flex flex-col gap-6">
      {mode === "create" && (
        <ol aria-label="Setup steps" className="grid grid-cols-3 gap-2">
          {["Your venue", "Stations", "Prices"].map((label, i) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span aria-hidden className={cx("h-[3px] rounded-full", i === 0 ? "bg-fg" : "bg-line-strong")} />
              <span className={cx("font-plexmono text-xs", i === 0 ? "font-semibold text-fg" : "text-muted")}>
                {i + 1} · {label}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div>
        <h1 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em]">
          {mode === "create" ? "Set up your venue" : "Join your team"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "create"
            ? "Next you'll add stations and set prices. Takes about two minutes."
            : "Ask the owner for an invite code from the Team page."}
        </p>
      </div>
      {/* Owner or staff: two big choices, easy to hit with a thumb. */}
      <div role="radiogroup" aria-label="Who are you" className="grid grid-cols-2 gap-2">
        {(
          [
            ["create", "I own a venue", "Create it, invite staff"],
            ["join", "I work at one", "Join with an invite code"],
          ] as const
        ).map(([value, title, note]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cx(
              "flex flex-col items-start gap-0.5 rounded-lg border bg-panel p-3.5 text-left transition-colors",
              mode === value ? "border-fg ring-1 ring-fg" : "border-line-strong hover:border-faint",
            )}
          >
            <b className="text-[15px] font-semibold">{title}</b>
            <span className="text-xs text-muted">{note}</span>
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-panel p-5 sm:p-6">
        {mode === "create" ? <CreateForm /> : <JoinForm />}
      </div>
    </div>
  );
}

function CreateForm() {
  const [state, action] = useActionState(createOrganization, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Venue name" hint="Shown on bills and the PC lock screen.">
        <Input name="orgName" placeholder="Respawn Gaming Zone" autoFocus required />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">What do you have?</legend>
        <StationTypePicker name="stationTypes" defaultValue={[]} />
        <span className="text-xs text-muted">Pick all that apply. You can change this later in Settings.</span>
      </fieldset>
      <Field label="Branch name" hint="You can add more branches later.">
        <Input name="branchName" defaultValue="Main branch" required />
      </Field>
      <Field label="Time zone">
        <Select name="timezone" defaultValue="Asia/Kolkata">
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating…" size="lg">
        Create venue
      </SubmitButton>
    </form>
  );
}

function JoinForm() {
  const [state, action] = useActionState(joinWithCode, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Invite code">
        <Input
          name="code"
          placeholder="ABCD2345"
          maxLength={8}
          autoCapitalize="characters"
          autoComplete="off"
          className="num h-11 text-center text-lg tracking-[0.3em] uppercase"
          autoFocus
          required
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Joining…" size="lg">
        Join
      </SubmitButton>
    </form>
  );
}
