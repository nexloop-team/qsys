"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, MonitorSmartphone, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DEVICE_SELECT, healthWarnings, isOnline, readHealth, seenAgo, type DeviceStatus } from "@/lib/devices";
import { Modal } from "@/components/overlay";
import { Button } from "@/components/ui";
import { createPairingCode, unpairDevice } from "./actions";

// "PC app" cell on a PC station's row: paired status, and Pair / Unpair for the owner.
export function PcAppCell({
  stationId,
  stationName,
  device,
  editable,
}: {
  stationId: string;
  stationName: string;
  device: DeviceStatus | undefined;
  editable: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [pairing, setPairing] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const online = isOnline(device, now);
  const warnings = online ? healthWarnings(readHealth(device, now)) : [];

  return (
    // One line: status on the left (dot = online or not), actions on the right.
    <div className="flex flex-wrap items-center gap-2">
      {device ? (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs" title={device.ip ?? undefined}>
          <span className={`size-2 shrink-0 rounded-full ${online ? "bg-free" : "bg-faint"}`} aria-hidden />
          <span className="min-w-0 truncate">
            <span className="font-medium">{online ? "Online" : "Offline"}</span>
            <span className="text-muted">
              {" · "}
              {device.hostname ?? "PC"} · {online ? (device.screen_locked ? "locked" : "unlocked") : seenAgo(device.last_seen_at, now)}
            </span>
          </span>
        </span>
      ) : (
        <span className="flex-1 text-xs text-muted">PC app not paired</span>
      )}
      {editable && (
        <span className="inline-flex shrink-0 gap-1">
          <Button size="sm" variant="secondary" onClick={() => setPairing(true)}>
            <MonitorSmartphone /> {device ? "Re-pair" : "Pair"}
          </Button>
          {device && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Unpair ${stationName}`}
              onClick={() => {
                if (!confirm(`Unpair the PC app on ${stationName}? It stays locked until it is paired again.`)) return;
                start(async () => setError((await unpairDevice(stationId))?.error));
              }}
            >
              <Unlink />
            </Button>
          )}
        </span>
      )}
      {warnings.length > 0 && <p className="w-full text-xs font-medium text-ending">{warnings.join(" · ")}</p>}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
      {pairing && (
        <PairDialog
          stationId={stationId}
          stationName={stationName}
          previousDevice={device?.created_at ?? null}
          onClose={() => setPairing(false)}
        />
      )}
    </div>
  );
}

function PairDialog({
  stationId,
  stationName,
  previousDevice,
  onClose,
}: {
  stationId: string;
  stationName: string;
  /** created_at of the PC app paired now, if any: a different one means the new pairing worked. */
  previousDevice: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [paired, setPaired] = useState<DeviceStatus>();

  useEffect(() => {
    let cancelled = false;
    void createPairingCode(stationId).then((r) => {
      if (cancelled) return;
      setCode(r.code);
      setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  // Watch for the PC app to use the code, then show who paired.
  useEffect(() => {
    if (!code || paired) return;
    const supabase = createClient();
    const id = window.setInterval(async () => {
      const { data } = await supabase.from("devices").select(DEVICE_SELECT).eq("station_id", stationId).maybeSingle();
      // Paired and checked in at least once.
      if (data && data.created_at !== previousDevice && data.last_seen_at) {
        setPaired(data);
        router.refresh();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [code, paired, stationId, previousDevice, router]);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Pair ${stationName}`} description="Connect the QueSys PC app on this PC.">
      {paired ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CircleCheck className="size-8 text-free" />
          <p className="font-semibold">Paired with {paired.hostname ?? "the PC"}</p>
          <p className="text-sm text-muted">The PC locks until a session starts on {stationName}.</p>
          <Button className="mt-2" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !code ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Creating a code…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Install the QueSys PC app on this PC and open it.</li>
            <li>Type this code on its setup screen.</li>
          </ol>
          <p className="num rounded-xl border border-line bg-subtle py-4 text-center text-3xl font-semibold tracking-[0.25em] select-all">
            {code.slice(0, 4)} {code.slice(4)}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for the PC… The code works once and expires in 15 minutes.
          </p>
          {previousDevice !== null && (
            <p className="text-xs text-muted">Pairing again replaces the current PC app on {stationName}.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
