"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageSquare, Power, RotateCcw, Zap } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { healthItems, healthWarnings, readHealth, seenAgo, type DeviceStatus } from "@/lib/devices";
import { Button, ErrorText, Input, cx } from "@/components/ui";
import { friendlyError } from "@/lib/errors";

type Kind = "message" | "restart" | "shutdown" | "wake";

const SENT: Record<Kind, string> = {
  message: "Message sent.",
  restart: "Restarting the PC…",
  shutdown: "Shutting down the PC…",
  wake: "Wake signal sent. The PC should start within a minute.",
};

// PC app controls in the station sheet: status, message, restart, shut down, turn on.
// Locking and unlocking follow the session (start / pause / end) and need no button.
export function PcControls({
  stationId,
  stationName,
  device,
  online,
  nowMs,
  sessionLive,
  isOwner,
  supabase,
  onSent,
}: {
  stationId: string;
  stationName: string;
  device: DeviceStatus | undefined;
  online: boolean;
  nowMs: number;
  sessionLive: boolean;
  isOwner: boolean;
  supabase: SupabaseClient<Database>;
  onSent: () => void;
}) {
  const [pending, start] = useTransition();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!device) {
    return (
      <Section>
        <p className="text-[13px] text-muted">
          No PC app on this PC.{" "}
          {isOwner ? (
            <>
              Pair it under{" "}
              <Link href="/stations" className="font-medium text-fg underline-offset-4 hover:underline">
                Stations
              </Link>{" "}
              to lock and unlock it from here.
            </>
          ) : (
            "The owner can pair it under Stations."
          )}
        </p>
      </Section>
    );
  }

  const send = (kind: Kind, payload: Record<string, string> = {}) =>
    start(async () => {
      setError(undefined);
      setNote(undefined);
      const { error } = await supabase.rpc("send_station_command", { p_station_id: stationId, p_kind: kind, p_payload: payload });
      if (error) {
        setError(friendlyError(error));
        return;
      }
      setNote(SENT[kind]);
      if (kind === "message") {
        setText("");
        setWriting(false);
      }
      onSent();
    });

  const confirmPower = (kind: "restart" | "shutdown") => {
    const verb = kind === "restart" ? "Restart" : "Shut down";
    const warn = sessionLive ? "\n\nA session is running: its timer keeps going." : "";
    if (confirm(`${verb} ${stationName}? Unsaved work on it is lost.${warn}`)) send(kind);
  };

  return (
    <Section>
      <p className="flex items-center gap-2 text-[13px]">
        <span className={cx("size-2 shrink-0 rounded-full", online ? "bg-free" : "bg-faint")} />
        <span className="font-medium">{online ? "PC online" : "PC offline"}</span>
        <span className="truncate text-muted">
          · {device.hostname ?? "PC"} ·{" "}
          {online ? (device.screen_locked ? "screen locked" : "screen unlocked") : seenAgo(device.last_seen_at, nowMs)}
        </span>
      </p>

      <HealthLine device={device} online={online} nowMs={nowMs} />

      {writing ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send("message", { text: text.trim() });
          }}
        >
          <Input
            autoFocus
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            placeholder="10 minutes left, please save your game"
            aria-label="Message to show on the PC"
          />
          <Button type="submit" size="sm" disabled={pending || !text.trim()}>
            Send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {online ? (
            <>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setWriting(true)}>
                <MessageSquare /> Message
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => confirmPower("restart")}>
                <RotateCcw /> Restart
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => confirmPower("shutdown")}>
                <Power /> Shut down
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending || !device.mac} onClick={() => send("wake")}>
              <Zap /> Turn on
            </Button>
          )}
        </div>
      )}
      {!online && !device.mac && (
        <p className="mt-2 text-xs text-muted">Turn on works after the PC has connected once.</p>
      )}
      {note && <p className="mt-2 text-xs text-free">{note}</p>}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

const RESTRICTION_LABEL: Record<string, string> = {
  task_manager: "Task Manager",
  control_panel: "Control Panel",
  command_line: "command line",
  usb_drives: "USB drives",
};

// CPU · RAM · GPU · disk from the last check-in, with anything worth a look in amber.
function HealthLine({ device, online, nowMs }: { device: DeviceStatus; online: boolean; nowMs: number }) {
  const health = online ? readHealth(device, nowMs) : null;
  if (!health) return null;
  const items = healthItems(health);
  const warnings = healthWarnings(health);
  const watchedOnly = Object.entries(health.restrictions ?? {})
    .filter(([, how]) => how !== "policy")
    .map(([k, how]) => `${RESTRICTION_LABEL[k] ?? k}${how === "watch" ? " (reported, not blocked)" : " (apps closed)"}`);
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {items.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
          {items.map((i) => (
            <div key={i.label} className="min-w-0">
              <dt className="text-[11px] text-faint">{i.label}</dt>
              <dd className={cx("num truncate font-medium", i.warn ? "text-ending" : "text-fg")}>{i.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {health.gpu?.name && <p className="truncate text-[11px] text-faint">{health.gpu.name}</p>}
      {warnings.length > 0 && <p className="text-xs font-medium text-ending">{warnings.join(" · ")}</p>}
      {watchedOnly.length > 0 && (
        <p className="text-[11px] text-faint">Without administrator rights: {watchedOnly.join(", ")}.</p>
      )}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">PC app</h3>
      {children}
    </section>
  );
}
