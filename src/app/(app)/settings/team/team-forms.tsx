"use client";

import { useActionState, useState, useTransition } from "react";
import { Copy, Trash2, UserMinus } from "lucide-react";
import { changeRole, createInvite, deleteInvite, removeMember } from "./actions";
import { Button, ErrorText, Select, SubmitButton } from "@/components/ui";

export function InviteForm() {
  const [state, action] = useActionState(createInvite, null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <SubmitButton pendingText="Creating…">Create staff invite code</SubmitButton>
      </form>
      {state?.error && <ErrorText>{state.error}</ErrorText>}
      {state?.code && (
        <div className="flex items-center gap-3 rounded-md border border-line-strong bg-subtle px-4 py-3">
          <span className="num text-2xl font-semibold tracking-[0.2em]">{state.code}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(state.code!);
              setCopied(true);
            }}
          >
            <Copy /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DeleteInviteButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Delete invite"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deleteInvite(id)))}
    >
      <Trash2 />
    </Button>
  );
}

export function MemberActions({ userId, role }: { userId: string; role: "owner" | "staff" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="inline-flex items-center gap-1">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Select
        value={role}
        disabled={pending}
        aria-label="Role"
        className="h-8 w-28"
        onChange={(e) => {
          const next = e.target.value as "owner" | "staff";
          if (next === "owner" && !confirm("Make this person an owner? They'll get full access, including settings and team.")) {
            return;
          }
          startTransition(async () => setError((await changeRole(userId, next))?.error));
        }}
      >
        <option value="staff">Staff</option>
        <option value="owner">Owner</option>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Remove from team"
        disabled={pending}
        onClick={() => {
          if (!confirm("Remove this person from your venue?")) return;
          startTransition(async () => setError((await removeMember(userId))?.error));
        }}
      >
        <UserMinus />
      </Button>
    </span>
  );
}
