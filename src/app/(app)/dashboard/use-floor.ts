"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEVICE_SELECT, type DeviceStatus } from "@/lib/devices";
import type { Database } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_SELECT, type LiveSession } from "./types";

// Live sessions for a branch: initial server data, then Supabase Realtime.
// Any change to the branch's sessions triggers a refetch (cheap: only live + unpaid rows).
export function useFloorSessions(branchId: string, initial: LiveSession[]) {
  const [sessions, setSessions] = useState(initial);
  const [connected, setConnected] = useState(true);
  const [supabase] = useState(createClient);
  // Replies can arrive out of order (a burst of changes, a slow network): only the newest wins.
  const latest = useRef(0);

  const refetch = useCallback(async () => {
    const ticket = ++latest.current;
    const [live, unpaid] = await Promise.all([
      supabase.from("sessions").select(SESSION_SELECT).eq("branch_id", branchId).neq("status", "ended"),
      supabase
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("branch_id", branchId)
        .eq("status", "ended")
        .eq("written_off", false)
        .gt("outstanding", 0),
    ]);
    if (live.error || unpaid.error || ticket !== latest.current) return;
    setSessions([...(live.data ?? []), ...(unpaid.data ?? [])] as LiveSession[]);
  }, [branchId, supabase]);

  useEffect(() => {
    // "Pause all" or a checkout changes many rows at once: refetch once for the burst.
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refetch(), 150);
    };
    const channel = supabase
      .channel(`floor:${branchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `branch_id=eq.${branchId}` },
        soon,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          void refetch(); // catch anything missed while disconnected
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
        }
      });

    const goOffline = () => setConnected(false);
    const goOnline = () => void refetch().then(() => setConnected(true));
    // Tablets and phones at the counter sleep: catch up the moment the screen is back.
    const onVisible = () => {
      if (!document.hidden) void refetch();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [branchId, refetch, supabase]);

  return { sessions, connected, refetch, supabase };
}

// PC apps in the branch: online status, hostname, lock state. They check in every 15 s, so a
// 20 s refresh is enough to show a PC going offline within about a minute.
export function useDevices(
  supabase: SupabaseClient<Database>,
  branchId: string,
  initial: DeviceStatus[],
  hasPcs: boolean,
) {
  const [devices, setDevices] = useState(initial);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase.from("devices").select(DEVICE_SELECT).eq("branch_id", branchId);
    if (!error) setDevices(data ?? []);
  }, [supabase, branchId]);

  useEffect(() => {
    if (!hasPcs) return; // no PC stations here: nothing to watch
    const id = window.setInterval(() => {
      if (!document.hidden) void refetch();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refetch, hasPcs]);

  return { devices, refetchDevices: refetch };
}

// Per-device preferences (mute, grid/map view), persisted in localStorage.
const PREF_EVENT = "qs-pref-change";

function subscribePref(cb: () => void) {
  window.addEventListener(PREF_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PREF_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLocalPref<T extends string>(key: string, fallback: T) {
  const value = useSyncExternalStore(
    subscribePref,
    () => {
      try {
        return (localStorage.getItem(key) as T | null) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const setValue = (next: T) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // storage blocked; preference won't persist
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  };
  return [value, setValue] as const;
}

export function useMuted() {
  const [value, setValue] = useLocalPref<"0" | "1">("qs_floor_muted", "0");
  return [value === "1", (muted: boolean) => setValue(muted ? "1" : "0")] as const;
}

// Wall clock aligned to the database clock, ticking every second.
// The page's server time is a first guess (it includes the page-load delay); one round trip
// on mount, timed at its midpoint, corrects it.
export function useServerClock(serverNowIso: string, supabase?: SupabaseClient<Database>) {
  const [offset, setOffset] = useState(() => Date.parse(serverNowIso) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const sent = Date.now();
    void supabase.rpc("server_time").then(({ data }) => {
      if (cancelled || !data) return;
      const received = Date.now();
      setOffset(Date.parse(data) - (sent + received) / 2);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);

  return now;
}

// Short two-tone beep for "time's up". Browsers allow audio after any user click.
export function beep() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.22);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // Audio unavailable; the visual alert still shows.
  }
}
