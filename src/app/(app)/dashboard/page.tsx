import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { SessionMode, StationType } from "@/lib/constants";
import { PageSkeleton } from "@/components/card";
import { FloorBoard } from "./floor-board";
import { SESSION_SELECT, type FloorData, type LiveSession } from "./types";

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

  const [stations, sessions, unpaid, plans, packages, settings, now, hours] = await Promise.all([
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
        "id, station_type, tier, is_active, per_hour, min_minutes, rounding_minutes, included_players, extra_player_per_hour, gst_rate_override, rate_rules(days_of_week, start_time, end_time, per_hour, priority)",
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
    supabase.from("branches").select("closing_time").eq("id", branch.id).maybeSingle(),
  ]);

  const s = settings.data;
  const data: FloorData = {
    branch,
    closingTime: hours.data?.closing_time ?? null,
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
      upi: s?.upi_vpa ? { vpa: s.upi_vpa, name: s.upi_payee_name || org.name } : null,
    },
  };

  // Keyed by branch so switching branch starts from that branch's data, never the previous one's.
  return <FloorBoard key={branch.id} initial={data} />;
}
