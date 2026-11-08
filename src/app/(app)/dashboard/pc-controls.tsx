"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageSquare, Power, RotateCcw, Zap } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { seenAgo, type DeviceStatus } from "@/lib/devices";
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

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">PC app</h3>
      {children}
    </section>
  );
}
