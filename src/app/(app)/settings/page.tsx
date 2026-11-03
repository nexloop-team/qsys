import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { BranchForm } from "./branch-form";
import { StationTypesForm } from "./station-types-form";
import { OwnerOnlyNote } from "./owner-only-note";

export const metadata: Metadata = { title: "Settings" };

export default function GeneralSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <General />
    </Suspense>
  );
}

async function General() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();
  const [{ data: details }, { data: settings }] = await Promise.all([
    supabase.from("branches").select("*").eq("id", branch.id).single(),
    supabase.from("branch_settings").select("station_types").eq("branch_id", branch.id).single(),
  ]);
  if (!details || !settings) return <p className="text-sm text-danger">Couldn&apos;t load this branch.</p>;

  const owner = isOwner(role);
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <BranchForm branch={details} disabled={!owner} />
      <StationTypesForm types={settings.station_types} disabled={!owner} />
    </>
  );
}
