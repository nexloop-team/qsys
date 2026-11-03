"use client";

import { useTransition } from "react";
import { setActiveBranch } from "./actions";

export function BranchSwitcher({
  branches,
  activeId,
}: {
  branches: { id: string; name: string }[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();

  if (branches.length < 2) {
    return (
      <span className="hidden h-7 items-center rounded-md border border-line px-2 text-xs text-muted sm:inline-flex">
        {branches[0]?.name}
      </span>
    );
  }

  return (
    <select
      aria-label="Branch"
      value={activeId}
      disabled={pending}
      onChange={(e) => startTransition(() => setActiveBranch(e.target.value))}
      className="h-7 rounded-md border border-line-strong bg-panel px-2 text-xs font-medium"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
