import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { OwnerOnlyNote } from "../owner-only-note";
import { OnlineForm } from "../online-form";

export const metadata: Metadata = { title: "Table QR settings" };

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
  const { data: settings } = await supabase
    .from("branch_settings")
    .select("qr_enabled, qr_orders")
    .eq("branch_id", branch.id)
    .single();
  if (!settings) return <p className="text-sm text-danger">Couldn&apos;t load these settings.</p>;

  const owner = isOwner(role);
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <OnlineForm settings={settings} disabled={!owner} />
    </>
  );
}
