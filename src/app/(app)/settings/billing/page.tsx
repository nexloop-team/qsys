import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { BillingForm } from "../billing-form";
import { OwnerOnlyNote } from "../owner-only-note";

export const metadata: Metadata = { title: "Billing settings" };

export default function BillingSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Billing />
    </Suspense>
  );
}

async function Billing() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();
  const { data: settings } = await supabase.from("branch_settings").select("*").eq("branch_id", branch.id).single();
  if (!settings) return <p className="text-sm text-danger">Couldn&apos;t load billing settings.</p>;

  const owner = isOwner(role);
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <BillingForm settings={settings} disabled={!owner} />
    </>
  );
}
