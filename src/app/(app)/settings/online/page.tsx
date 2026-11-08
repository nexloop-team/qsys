import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { toTimeInput } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";
import { PageSkeleton } from "@/components/card";
import { OwnerOnlyNote } from "../owner-only-note";
import { OnlineForm } from "../online-form";

export const metadata: Metadata = { title: "Online settings" };

export default function OnlineSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Online />
    </Suspense>
  );
}

async function Online() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();
  const [{ data: settings }, { data: details }] = await Promise.all([
    supabase
      .from("branch_settings")
      .select("qr_enabled, qr_orders, booking_enabled, booking_slug, booking_days, booking_note")
      .eq("branch_id", branch.id)
      .single(),
    supabase.from("branches").select("opening_time, closing_time").eq("id", branch.id).single(),
  ]);
  if (!settings) return <p className="text-sm text-danger">Couldn&apos;t load these settings.</p>;

  const owner = isOwner(role);
  const hours = `${toTimeInput(details?.opening_time) || "10:00"}–${toTimeInput(details?.closing_time) || "23:00"}`;
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <OnlineForm settings={settings} hours={hours} siteUrl={await siteUrl()} disabled={!owner} />
    </>
  );
}
