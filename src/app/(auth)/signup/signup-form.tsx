"use client";

import { useActionState } from "react";
import { signup } from "../actions";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export function SignupForm() {
  const [state, action] = useActionState(signup, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Your name">
        <Input name="fullName" autoComplete="name" required />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
