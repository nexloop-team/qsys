import { Lock } from "lucide-react";

export function OwnerOnlyNote() {
  return (
    <p className="mb-5 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
      <Lock className="size-4" /> Only the owner can change these.
    </p>
  );
}
