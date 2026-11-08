import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { todayIn, zonedStart } from "@/lib/format";
import { STATION_TYPES } from "@/lib/constants";
import { PageSkeleton } from "@/components/card";
import { BookingsView, type BookingRow } from "./bookings-view";

export const metadata: Metadata = { title: "Bookings" };

export default function BookingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Bookings />
    </Suspense>
  );
}

async function Bookings() {
  const { branch, org } = await getAppContext();
  const supabase = await createClient();
  const today = todayIn(branch.timezone);
  const from = zonedStart(today, branch.timezone);

  const [{ data: bookings }, { data: stations }, { data: settings }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, station_type, station_id, name, phone, starts_at, minutes, players, note, status, source")
      .eq("branch_id", branch.id)
      .gte("starts_at", from)
      .order("starts_at")
      .limit(300),
    supabase
      .from("stations")
      .select("id, name, type")
      .eq("branch_id", branch.id)
      .eq("status", "active")
      .order("sort_order"),
    supabase
      .from("branch_settings")
      .select("station_types, booking_enabled, booking_slug")
      .eq("branch_id", branch.id)
      .single(),
  ]);

  return (
    <BookingsView
      orgId={org.id}
      branch={branch}
      venueName={org.name}
      today={today}
      bookings={(bookings ?? []) as BookingRow[]}
      stations={stations ?? []}
      types={STATION_TYPES.filter((t) => (settings?.station_types ?? STATION_TYPES).includes(t))}
      bookingPage={settings?.booking_enabled && settings.booking_slug ? `/book/${settings.booking_slug}` : null}
    />
  );
}
