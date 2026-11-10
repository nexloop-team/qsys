import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { OwnerOnlyNote } from "../owner-only-note";
import { PcSettingsForm } from "../pc-settings-form";

export const metadata: Metadata = { title: "PC app settings" };

export default function PcSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PcSettings />
    </Suspense>
  );
}

async function PcSettings() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("branch_settings")
    .select("blocked_apps, lock_message, pc_player_login, pc_games, pc_restrictions")
    .eq("branch_id", branch.id)
    .single();
  if (!settings) return <p className="text-sm text-danger">Couldn&apos;t load PC app settings.</p>;

  const owner = isOwner(role);
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <PcSettingsForm
        blockedApps={settings.blocked_apps ?? []}
        lockMessage={settings.lock_message ?? ""}
        playerLogin={settings.pc_player_login ?? true}
        games={(Array.isArray(settings.pc_games) ? settings.pc_games : []) as { id: string; name: string; target: string }[]}
        restrictions={settings.pc_restrictions ?? []}
        branchName={branch.name}
        disabled={!owner}
      />
    </>
  );
}
