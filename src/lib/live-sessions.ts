"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// One Realtime channel per branch for changes to its sessions, shared by everything that listens
// (the Floor and the time's-up alerts on every page). Before this, each opened its own channel,
// so the server checked every change twice and each one triggered two reloads.

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
type Listener = { onChange: () => void; onStatus?: (status: Status) => void };

// A fresh topic each time: a channel still closing must never be handed back and reused.
let seq = 0;
const shared = new Map<string, { channel: RealtimeChannel; listeners: Set<Listener>; status?: Status }>();

/** Calls `onChange` on any insert, update or delete of the branch's sessions. Returns the unsubscribe. */
export function subscribeSessionChanges(
  supabase: SupabaseClient<Database>,
  branchId: string,
  listener: Listener,
): () => void {
  let entry = shared.get(branchId);
  if (!entry) {
    const listeners = new Set<Listener>();
    const created = {
      listeners,
      status: undefined as Status | undefined,
      channel: supabase
        .channel(`sessions:${branchId}:${++seq}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `branch_id=eq.${branchId}` }, () =>
          listeners.forEach((l) => l.onChange()),
        )
        .subscribe((status) => {
          created.status = status as Status;
          listeners.forEach((l) => l.onStatus?.(status as Status));
        }),
    };
    entry = created;
    shared.set(branchId, entry);
  }
  entry.listeners.add(listener);
  // Joined late: tell it the channel is already up, so it catches up like a fresh subscriber.
  if (entry.status) {
    const status = entry.status;
    queueMicrotask(() => listener.onStatus?.(status));
  }

  return () => {
    const e = shared.get(branchId);
    if (!e) return;
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      shared.delete(branchId);
      void supabase.removeChannel(e.channel);
    }
  };
}
