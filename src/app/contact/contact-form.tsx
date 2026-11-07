"use client";

import { useActionState, useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import { sendContactMessage } from "./actions";
import { TOPICS } from "./topics";

// Contact form. Phone-first: one column, 16px inputs, the right keyboard per field, a full-width
// send button. After sending it says thanks instead of showing an empty form again.
export function ContactForm() {
  const [state, action] = useActionState(sendContactMessage, null);
  // When the form appeared in the browser: a send within 3 seconds is a bot. Set after load (the
  // page itself is prerendered, so it can't carry a time).
  const openedAt = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (openedAt.current) openedAt.current.value = String(Date.now());
  }, []);

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 border-t-2 border-fg pt-6">
        <CircleCheck className="size-7 text-free" aria-hidden />
        <p className="text-[26px] leading-tight font-semibold tracking-[-0.025em]">Message sent.</p>
        <p className="text-[15px] text-muted">{state.ok} We reply on the email or mobile number you gave.</p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 border-t-2 border-fg pt-6">
      <input ref={openedAt} type="hidden" name="opened_at" defaultValue="" />
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="name" autoComplete="name" maxLength={80} required />
        </Field>
        <Field label="Venue name" hint="Optional">
          <Input name="venue" autoComplete="organization" maxLength={80} />
        </Field>
        <Field label="Mobile" hint="Email or mobile, at least one">
          <Input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" maxLength={120} placeholder="you@venue.in" />
        </Field>
      </div>
      <Field label="What's it about?">
        <Select name="topic" defaultValue="setup" required>
          {Object.entries(TOPICS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message">
        <Textarea name="message" rows={5} minLength={10} maxLength={2000} required placeholder="How many PCs, consoles or tables do you have? What would you like to know?" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Sending…" className="w-full rounded-full! sm:w-auto sm:self-start">
        Send message
      </SubmitButton>
    </form>
  );
}
