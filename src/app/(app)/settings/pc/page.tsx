import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { seenAgo } from "@/lib/devices";
import { PageSkeleton } from "@/components/card";
import { cx } from "@/components/styles";
import { OwnerOnlyNote } from "../owner-only-note";
import { PcSettingsForm } from "../pc-settings-form";
import { SettingsSection } from "../section";
import { UpdateAllButton } from "../pc-updates";

export const metadata: Metadata = { title: "PC app settings" };

// Where the PC app looks for updates (pc-agent/src-tauri/tauri.conf.json).
const LATEST_URL =
  "https://github.com/nexloop-team/qsys/releases/latest/download/latest.json";

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
  const [{ data: settings }, { data: devices }, { data: stations }, latest] =
    await Promise.all([
      supabase
        .from("branch_settings")
        .select(
          "blocked_apps, lock_message, pc_player_login, pc_games, pc_restrictions",
        )
        .eq("branch_id", branch.id)
        .single(),
      supabase
        .from("devices")
        .select("station_id, agent_version, last_seen_at")
        .eq("branch_id", branch.id),
      supabase
        .from("stations")
        .select("id, name, sort_order")
        .eq("branch_id", branch.id),
      latestVersion(),
    ]);
  if (!settings)
    return (
      <p className="text-sm text-danger">Couldn&apos;t load PC app settings.</p>
    );

  const owner = isOwner(role);
  const nameOf = new Map((stations ?? []).map((s) => [s.id, s]));
  const pcs = (devices ?? [])
    .map((d) => ({ ...d, station: nameOf.get(d.station_id) }))
    .sort(
      (a, b) => (a.station?.sort_order ?? 0) - (b.station?.sort_order ?? 0),
    );
  const upToDate = latest
    ? pcs.filter((d) => d.agent_version === latest).length
    : null;
  // Rendered per request (inside Suspense, after the session is read).
  const nowMs = new Date().getTime();

  return (
    <>
      {!owner && <OwnerOnlyNote />}

      {/* Shown once the first signed release is out (auto-update is set up in pc-agent/README.md). */}
      {latest && (
        <SettingsSection
          title="App updates"
          description={
            <>
              Each PC updates itself from the latest QueSys release, only while
              nobody is playing on it: no session and no staff unlock. It checks
              a few minutes after starting and every 6 hours.
              {latest
                ? ` The latest is ${latest}.`
                : " No release has been published yet."}
            </>
          }
          action={
            owner && pcs.length > 0 ? (
              <UpdateAllButton branchId={branch.id} count={pcs.length} />
            ) : undefined
          }
          flush
        >
          {pcs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No PCs paired yet. Pair them under Stations.
            </p>
          ) : (
            <>
              {upToDate !== null && (
                <p className="border-b border-line px-4 py-2.5 text-sm">
                  <span className="font-semibold">
                    {upToDate} of {pcs.length}
                  </span>{" "}
                  <span className="text-muted">PCs are on {latest}.</span>
                </p>
              )}
              <ul className="divide-y divide-line text-sm">
                {pcs.map((d) => {
                  const current = latest !== null && d.agent_version === latest;
                  return (
                    <li
                      key={d.station_id}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {d.station?.name ?? "PC"}
                      </span>
                      <span className="text-xs text-muted">
                        {seenAgo(d.last_seen_at, nowMs)}
                      </span>
                      <span
                        className={cx(
                          "num inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold",
                          current
                            ? "bg-subtle text-fg"
                            : latest
                              ? "bg-ending/15 text-ending"
                              : "bg-subtle text-muted",
                        )}
                      >
                        {d.agent_version ?? "unknown"}
                        {latest && !current ? " · update waiting" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </SettingsSection>
      )}

      <PcSettingsForm
        blockedApps={settings.blocked_apps ?? []}
        lockMessage={settings.lock_message ?? ""}
        playerLogin={settings.pc_player_login ?? true}
        games={
          (Array.isArray(settings.pc_games) ? settings.pc_games : []) as {
            id: string;
            name: string;
            target: string;
          }[]
        }
        restrictions={settings.pc_restrictions ?? []}
        branchName={branch.name}
        disabled={!owner}
      />
    </>
  );
}

// The version in the latest release's update file, or null when there's none yet.
async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(LATEST_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version?.replace(/^v/, "") ?? null;
  } catch {
    return null;
  }
}
