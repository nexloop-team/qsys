"use client";

import { useActionState, useTransition } from "react";
import { addBranch } from "../actions";
import { setActiveBranch } from "../../actions";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

export function SwitchBranchButton({ branchId }: { branchId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(() => setActiveBranch(branchId))}>
      {pending ? "Switching…" : "Switch to"}
    </Button>
  );
}

export function AddBranchForm() {
  const [state, action] = useActionState(addBranch, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Branch name">
          <Input name="name" placeholder="Koramangala" required />
        </Field>
        <Field label="Time zone">
          <Select name="timezone" defaultValue="Asia/Kolkata">
            {["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Colombo"].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3">
        <FormMessage state={state} />
        <SubmitButton pendingText="Adding…">Add branch</SubmitButton>
      </div>
    </form>
  );
}
