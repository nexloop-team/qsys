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
      <span className="hidden h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium text-muted shadow-xs sm:inline-flex">
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
      className="h-8 rounded-lg border border-line bg-panel px-2 text-xs font-medium shadow-xs outline-none transition-colors hover:bg-hover focus:border-accent"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
