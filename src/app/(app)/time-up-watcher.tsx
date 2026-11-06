"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, Clock, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { beep, useMuted } from "./dashboard/use-floor";

type Live = {
  id: string;
  station_id: string;
  planned_end_at: string | null;
  paused_at: string | null;
  customer_name: string | null;
};
type Toast = { id: string; kind: "soon" | "up"; title: string; body: string };

const SOON_SECONDS = 5 * 60;
const ASKED_KEY = "qs_notify_asked";

// Watches the branch's fixed-time sessions from any page of the app, so "time's up" is noticed
// even when nobody has the Floor open: sound + toast, and a system notification when the tab
// is in the background. (When the app is closed entirely, only the PC app can lock the PC.)
export function TimeUpWatcher({ branchId }: { branchId: string }) {
  const [supabase] = useState(createClient);
  const [muted] = useMuted();
  const [live, setLive] = useState<Live[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [askNotify, setAskNotify] = useState(false);
  const offset = useRef(0);
  const warned = useRef(new Set<string>());
  const alerted = useRef(new Set<string>());

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id, station_id, planned_end_at, paused_at, customer_name")
      .eq("branch_id", branchId)
      .eq("mode", "prepaid")
      .neq("status", "ended");
    setLive((data ?? []) as Live[]);
  }, [supabase, branchId]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("server_time").then(({ data }) => {
      if (!cancelled && data) offset.current = Date.parse(data) - Date.now();
    });
    void supabase
      .from("stations")
      .select("id, name")
      .eq("branch_id", branchId)
      .then(({ data }) => {
        if (!cancelled) setNames(Object.fromEntries((data ?? []).map((s) => [s.id, s.name])));
      });
    // First load runs after the current render (as the realtime refreshes do).
    void Promise.resolve().then(load);

    const channel = supabase
      .channel(`timeup:${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `branch_id=eq.${branchId}` }, () =>
        void load(),
      )
      .subscribe();

    // Offer system notifications once, a moment after the app opens.
    const ask = window.setTimeout(() => {
      try {
        if ("Notification" in window && Notification.permission === "default" && !localStorage.getItem(ASKED_KEY)) {
          setAskNotify(true);
        }
      } catch {
        // storage or Notification unavailable; in-page alerts still work
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearTimeout(ask);
      void supabase.removeChannel(channel);
    };
  }, [supabase, branchId, load]);

  // Check every 2 seconds against the database clock.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now() + offset.current;
      for (const s of live) {
        if (!s.planned_end_at || s.paused_at) continue;
        const left = (Date.parse(s.planned_end_at) - now) / 1000;
        const station = names[s.station_id] ?? "A station";
        const who = s.customer_name ? ` · ${s.customer_name}` : "";

        if (left <= 0 && !alerted.current.has(s.id)) {
          alerted.current.add(s.id);
          setToasts((t) => [...t.filter((x) => x.id !== s.id), { id: s.id, kind: "up", title: `${station}: time's up`, body: `Fixed time ended${who}.` }]);
          if (!muted) beep();
          try {
            if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
              new Notification(`${station}: time's up`, { body: `Fixed time ended${who}.`, tag: s.id });
            }
          } catch {
            // some browsers only allow notifications from a service worker
          }
        } else if (left > 0 && left <= SOON_SECONDS && !warned.current.has(s.id)) {
          warned.current.add(s.id);
          const mins = Math.max(1, Math.ceil(left / 60));
          const toast: Toast = { id: s.id, kind: "soon", title: `${station}: ${mins} min left`, body: `Fixed time ends soon${who}.` };
          setToasts((t) => [...t.filter((x) => x.id !== s.id), toast]);
          window.setTimeout(() => setToasts((t) => t.filter((x) => x !== toast)), 15_000);
        }
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [live, names, muted]);

  // Sessions that were extended or ended drop their toast.
  useEffect(() => {
    const now = Date.now() + offset.current;
    setToasts((t) =>
      t.filter((x) => {
        const s = live.find((l) => l.id === x.id);
        if (!s || !s.planned_end_at) return false;
        const left = (Date.parse(s.planned_end_at) - now) / 1000;
        if (left > SOON_SECONDS) {
          warned.current.delete(s.id);
          alerted.current.delete(s.id);
          return false;
        }
        if (left > 0 && x.kind === "up") {
          alerted.current.delete(s.id);
          return false;
        }
        return true;
      }),
    );
  }, [live]);

  if (toasts.length === 0 && !askNotify) return null;

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2 md:inset-x-auto md:right-4 md:bottom-4 print:hidden"
    >
      {askNotify && (
        <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm shadow-pop">
          <BellRing className="size-4 shrink-0 text-accent-ink" />
          <span className="flex-1 text-muted">Get “time&apos;s up” alerts even when this tab is in the background.</span>
          <button
            type="button"
            className="font-medium text-accent-ink hover:underline"
            onClick={() => {
              void Notification.requestPermission().finally(() => setAskNotify(false));
              try {
                localStorage.setItem(ASKED_KEY, "1");
              } catch {
                // ignore
              }
            }}
          >
            Allow
          </button>
          <button
            type="button"
            aria-label="Not now"
            className="text-muted hover:text-fg"
            onClick={() => {
              setAskNotify(false);
              try {
                localStorage.setItem(ASKED_KEY, "1");
              } catch {
                // ignore
              }
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id + t.kind}
          role="alert"
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm shadow-pop ${
            t.kind === "up" ? "border-over/50 bg-panel" : "border-ending/50 bg-panel"
          }`}
        >
          <Clock className={`mt-0.5 size-4 shrink-0 ${t.kind === "up" ? "text-over" : "text-ending"}`} />
          <div className="min-w-0 flex-1">
            <p className={`font-semibold ${t.kind === "up" ? "text-over" : "text-ending"}`}>{t.title}</p>
            <p className="text-muted">
              {t.body}{" "}
              <Link href="/dashboard" className="font-medium text-fg underline-offset-4 hover:underline">
                Open floor
              </Link>
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted hover:text-fg"
            onClick={() => setToasts((all) => all.filter((x) => x !== t))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
