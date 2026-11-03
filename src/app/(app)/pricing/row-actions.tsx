"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { setPackageActive } from "./actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui";

export function DeleteButton({
  onDelete,
  confirmText,
}: {
  onDelete: () => Promise<ActionState>;
  confirmText: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label="Delete"
        onClick={() => {
          if (!confirm(confirmText)) return;
          startTransition(async () => setError((await onDelete())?.error));
        }}
      >
        <Trash2 />
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

export function PackageActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title={isActive ? "Hide from staff" : "Show to staff"}
      aria-label={isActive ? "Hide package" : "Show package"}
      onClick={() => startTransition(async () => void (await setPackageActive(id, !isActive)))}
    >
      {isActive ? <Eye /> : <EyeOff />}
    </Button>
  );
}
