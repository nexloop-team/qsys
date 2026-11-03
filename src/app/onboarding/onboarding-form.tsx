"use client";

import { useActionState, useState } from "react";
import { createOrganization, joinWithCode } from "./actions";
import { Field, FormMessage, Input, Segmented, Select, SubmitButton } from "@/components/ui";
import { StationTypePicker } from "@/components/station-type-picker";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Colombo"];

export function OnboardingChoice() {
  const [mode, setMode] = useState<"create" | "join">("create");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "create" ? "Set up your venue" : "Join your team"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "create"
            ? "Next you'll add stations and set prices. Takes about two minutes."
            : "Ask the owner for an invite code from the Team page."}
        </p>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        className="w-full"
        options={[
          { value: "create", label: "I own a venue" },
          { value: "join", label: "Join with invite code" },
        ]}
      />
      <div className="rounded-2xl border border-line bg-panel p-5 shadow-pop sm:p-6">
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
