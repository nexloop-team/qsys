"use client";

import { useActionState } from "react";
import { changePassword, saveProfile } from "../actions";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export function ProfileForm({ name }: { name: string }) {
  const [state, action] = useActionState(saveProfile, null);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Your name" className="flex-1">
        <Input name="full_name" defaultValue={name} maxLength={80} required />
      </Field>
      <SubmitButton>Save</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password">
          <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Repeat new password">
          <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3">
        <FormMessage state={state} />
        <SubmitButton pendingText="Changing…">Change password</SubmitButton>
      </div>
    </form>
  );
}
