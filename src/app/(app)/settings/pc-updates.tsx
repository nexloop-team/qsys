"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Button, ErrorText } from "@/components/ui";

// Owner: ask every PC in the branch to update now (each installs when nobody is playing on it).
export function UpdateAllButton({ branchId, count }: { branchId: string; count: number }) {
  const [supabase] = useState(createClient);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending || count === 0}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const { data, error: err } = await supabase.rpc("update_all_pcs", { p_branch_id: branchId });
            if (err) return setError(friendlyError(err));
            setNote(
              data
                ? `Asked ${data} ${data === 1 ? "PC" : "PCs"} to update. Each installs when nobody is playing on it.`
                : "Every PC already has an update waiting.",
            );
          })
        }
      >
        <Download /> Update all PCs now
      </Button>
      {note && <p className="text-xs text-muted">{note}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
