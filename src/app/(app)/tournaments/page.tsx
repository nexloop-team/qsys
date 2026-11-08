import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Trophy } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { STATION_TYPES, STATION_TYPE_LABEL } from "@/lib/constants";
import { Badge, Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { NewTournamentButton } from "./new-tournament";
import { entryWord, teamLabel } from "./labels";

export const metadata: Metadata = { title: "Tournaments" };

const STATUS = {
  open: { label: "Taking players", tone: "free" },
  running: { label: "In progress", tone: "ending" },
  finished: { label: "Finished", tone: "neutral" },
} as const;

export default function TournamentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Tournaments />
    </Suspense>
  );
}

async function Tournaments() {
  const { branch } = await getAppContext();
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id, name, game, entry_fee, prize, starts_at, status, created_at, team_size, station_type, tournament_players(count)")
      .eq("branch_id", branch.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("branch_settings").select("station_types").eq("branch_id", branch.id).single(),
  ]);
  const list = data ?? [];
  const types = STATION_TYPES.filter((t) => (settings?.station_types ?? STATION_TYPES).includes(t));

  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Knockout tournaments for singles or teams, on tables, PCs or consoles."
        actions={<NewTournamentButton branchId={branch.id} timezone={branch.timezone} types={types} />}
      />
      {list.length === 0 ? (
        <Panel>
          <Empty icon={<Trophy />} title="No tournaments yet">
            Run a snooker, pool, FIFA or Valorant knockout, for single players or teams. Lose once and you&apos;re out. The
            draw is random, and odd numbers are handled for you.
          </Empty>
        </Panel>
      ) : (
        <Panel flush>
          <ul className="divide-y divide-line">
            {list.map((t) => {
              const players = (t.tournament_players as unknown as { count: number }[])[0]?.count ?? 0;
              const st = STATUS[t.status];
              return (
                <li key={t.id}>
                  <Link href={`/tournaments/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                    <Trophy className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {t.game}
                        {t.station_type ? ` on ${STATION_TYPE_LABEL[t.station_type]}` : ""}
                        {t.team_size > 1 ? ` · ${teamLabel(t.team_size)}` : ""} · {players} {entryWord(t.team_size, players)}
                        {Number(t.entry_fee) > 0 && ` · ${formatINR(t.entry_fee)} entry`}
                        {t.starts_at && ` · ${formatDateTime(t.starts_at, branch.timezone)}`}
                      </span>
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <ChevronRight className="size-4 shrink-0 text-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
