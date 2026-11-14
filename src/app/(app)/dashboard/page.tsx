import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_SELECT } from "@/lib/devices";
import { hoursFromNow } from "@/lib/format";
import type { SessionMode, StationType } from "@/lib/constants";
import { PageSkeleton } from "@/components/card";
import { FloorBoard } from "./floor-board";
import {
  ALERT_SELECT,
  BOOKING_SELECT,
  REQUEST_SELECT,
  SESSION_SELECT,
  type FloorBooking,
  type FloorData,
  type LiveSession,
  type PcAlert,
  type StationRequest,
} from "./types";

export const metadata: Metadata = { title: "Floor" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Floor />
    </Suspense>
  );
}

async function Floor() {
  const { branch, org, role } = await getAppContext();
  const supabase = await createClient();

  const [stations, sessions, unpaid, plans, packages, settings, now, devices, requests, bookings, alerts] = await Promise.all([
    supabase
      .from("stations")
      .select("id, name, type, tier, status, zone, layout_x, layout_y, layout_rot")
      .eq("branch_id", branch.id)
      .order("sort_order"),
    supabase.from("sessions").select(SESSION_SELECT).eq("branch_id", branch.id).neq("status", "ended"),
    supabase
      .from("sessions")
      .select(SESSION_SELECT)
      .eq("branch_id", branch.id)
      .eq("status", "ended")
      .eq("written_off", false)
      .gt("outstanding", 0),
    supabase
      .from("rate_plans")
      .select(
        "id, station_type, tier, is_active, per_hour, min_minutes, rounding_minutes, included_players, extra_player_per_hour, player_choices, per_frame, gst_rate_override, rate_rules(days_of_week, start_time, end_time, per_hour, priority)",
      )
      .eq("branch_id", branch.id),
    supabase
      .from("packages")
      .select("id, name, station_type, tier, minutes, price")
      .eq("branch_id", branch.id)
      .eq("is_active", true)
      .order("minutes"),
    supabase.from("branch_settings").select("*").eq("branch_id", branch.id).single(),
    supabase.rpc("server_time"),
    supabase.from("devices").select(DEVICE_SELECT).eq("branch_id", branch.id),
    supabase
      .from("station_requests")
      .select(REQUEST_SELECT)
      .eq("branch_id", branch.id)
      .eq("status", "pending")
      .order("created_at"),
    supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("branch_id", branch.id)
      .in("status", ["requested", "confirmed"])
      .gte("starts_at", hoursFromNow(-2))
      .lte("starts_at", hoursFromNow(36))
      .order("starts_at"),
    supabase
      .from("pc_alerts")
      .select(ALERT_SELECT)
      .eq("branch_id", branch.id)
      .is("dismissed_at", null)
      .gte("created_at", hoursFromNow(-48))
      .order("created_at", { ascending: false }),
  ]);

  const s = settings.data;
  const data: FloorData = {
    branch,
    orgId: org.id,
    orgName: org.name,
    role,
    serverNow: now.data ?? new Date().toISOString(),
    stations: stations.data ?? [],
    sessions: [...(sessions.data ?? []), ...(unpaid.data ?? [])] as LiveSession[],
    plans: plans.data ?? [],
    packages: packages.data ?? [],
    settings: {
      allowed: (s?.allowed_modes_by_type ?? {}) as Record<StationType, SessionMode[]>,
      defaults: (s?.default_mode_by_type ?? {}) as Record<StationType, SessionMode>,
      graceMinutes: s?.overtime_grace_minutes ?? 2,
      earlyEndPolicy: s?.early_end_policy === "played" ? "played" : "full",
      gstEnabled: s?.gst_enabled ?? false,
      gstRate: Number(s?.gst_rate ?? 18),
      pricesIncludeTax: s?.prices_include_tax ?? false,
      staffMaxDiscountPct: s?.staff_max_discount_pct ?? 10,
      creditLimit: s?.credit_limit == null ? null : Number(s.credit_limit),
    },
    devices: devices.data ?? [],
    requests: (requests.data ?? []) as StationRequest[],
    bookings: (bookings.data ?? []) as FloorBooking[],
    alerts: (alerts.data ?? []) as PcAlert[],
  };

  // Keyed by branch so switching branch starts from that branch's data, never the previous one's.
  return <FloorBoard key={branch.id} initial={data} />;
}
