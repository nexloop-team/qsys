"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login } from "../actions";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export function LoginForm() {
  const [state, action] = useActionState(login, null);
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const linkError = params.has("error");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            Password
            <Link href="/forgot-password" className="text-xs font-normal text-muted underline-offset-4 hover:text-fg hover:underline">
              Forgot password?
            </Link>
          </span>
        }
      >
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {linkError && !state && (
        <p className="text-sm text-danger">That link has expired or was already used. Try again.</p>
      )}
      <FormMessage state={state} />
      <SubmitButton pendingText="Logging in…">Log in</SubmitButton>
    </form>
  );
}
