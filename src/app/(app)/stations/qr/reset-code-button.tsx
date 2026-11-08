"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

// New code for one station (owner). The old sticker stops working, e.g. after it was copied.
export function ResetCodeButton({ stationId, stationName }: { stationId: string; stationName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="print:hidden">
      <button
        type="button"
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
        onClick={() => {
          if (!window.confirm(`New QR code for ${stationName}? The old sticker will stop working.`)) return;
          startTransition(async () => {
            setError(undefined);
            const { error } = await createClient().rpc("reset_station_code", { p_station_id: stationId });
            if (error) return setError(friendlyError(error));
            router.refresh();
          });
        }}
      >
        <RefreshCw className="size-3" /> {pending ? "Making…" : "New code"}
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
