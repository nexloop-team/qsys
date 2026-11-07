"use client";

import { useTransition } from "react";
import { ChevronsUpDown } from "lucide-react";
import { setActiveBranch } from "./actions";

// Branch picker inside the sidebar's venue card.
export function BranchSwitcher({
  branches,
  activeId,
}: {
  branches: { id: string; name: string }[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Branch</span>
      <select
        value={activeId}
        disabled={pending}
        onChange={(e) => startTransition(() => setActiveBranch(e.target.value))}
        className="w-full cursor-pointer appearance-none truncate bg-transparent pr-5 text-xs text-muted outline-none hover:text-fg focus-visible:text-fg disabled:opacity-60"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} branch
          </option>
        ))}
      </select>
      <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-0 size-3.5 text-faint" />
    </label>
  );
}
