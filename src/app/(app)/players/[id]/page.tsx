import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { SESSION_MODE_LABEL, STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { formatDateTime, formatINR, formatMinutes } from "@/lib/format";
import { Badge, Metric, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";

export const metadata: Metadata = { title: "Player" };

export default function PlayerPage(props: PageProps<"/players/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Player params={props.params} />
    </Suspense>
  );
}

function playedMinutes(s: {
  started_at: string;
  ended_at: string | null;
  session_pauses: { started_at: string; ended_at: string | null }[];
}) {
  const end = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  const paused = s.session_pauses.reduce(
    (sum, p) => sum + ((p.ended_at ? Date.parse(p.ended_at) : end) - Date.parse(p.started_at)),
    0,
  );
  return Math.max(0, Math.round((end - Date.parse(s.started_at) - paused) / 60000));
}

async function Player({ params }: { params: PageProps<"/players/[id]">["params"] }) {
  const { id } = await params;
  const { branch } = await getAppContext();
  const supabase = await createClient();

  const [{ data: player }, { data: sessions }] = await Promise.all([
    supabase.from("customers").select("id, name, phone, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("sessions")
      .select(
        "id, mode, status, started_at, ended_at, charge_amount, billed_amount, outstanding, written_off, stations(name, type), session_pauses(started_at, ended_at)",
      )
      .eq("customer_id", id)
      .order("started_at", { ascending: false })
      .limit(100),
  ]);
  if (!player) notFound();

  const list = sessions ?? [];
  const minutes = list.reduce((sum, s) => sum + playedMinutes(s), 0);
  const spent = list.reduce((sum, s) => sum + Number(s.billed_amount), 0);
  const owed = list.reduce((sum, s) => sum + (s.written_off ? 0 : Number(s.outstanding)), 0);
  const favourite = Object.entries(
    list.reduce<Record<string, number>>((acc, s) => {
      const t = s.stations?.type;
      if (t) acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1])[0]?.[0] as StationType | undefined;

  return (
    <>
      <Link href="/players" className={buttonClass("ghost", "sm", "mb-3")}>
        <ArrowLeft /> Players
      </Link>
      <PageHeader
        title={player.name}
        description={`${player.phone.slice(0, 5)} ${player.phone.slice(5)} · player since ${new Date(player.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: branch.timezone })}`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
        <Metric label="Visits" value={list.length} />
        <Metric label="Played" value={formatMinutes(minutes)} />
        <Metric label="Paid" value={formatINR(spent)} />
        <Metric label="Owes" value={formatINR(owed)} tone={owed > 0 ? "over" : undefined} />
        <Metric label="Plays most" value={favourite ? STATION_TYPE_LABEL[favourite] : "—"} />
      </div>

      <Panel title="Visit history" flush>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Started</th>
                  <th className="px-4 py-2.5 font-medium">Station</th>
                  <th className="px-4 py-2.5 font-medium">Timer</th>
                  <th className="px-4 py-2.5 text-right font-medium">Played</th>
                  <th className="px-4 py-2.5 text-right font-medium">Charge</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{formatDateTime(s.started_at, branch.timezone)}</td>
                    <td className="px-4 py-2.5 font-medium">{s.stations?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{SESSION_MODE_LABEL[s.mode]}</td>
                    <td className="num px-4 py-2.5 text-right">{formatMinutes(playedMinutes(s))}</td>
                    <td className="num px-4 py-2.5 text-right">
                      {s.charge_amount != null ? formatINR(s.charge_amount) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {s.status !== "ended" ? (
                        <Badge tone="busy">Playing</Badge>
                      ) : s.written_off ? (
                        <Badge tone="danger">Written off</Badge>
                      ) : Number(s.outstanding) > 0 ? (
                        <Badge tone="over">Unpaid</Badge>
                      ) : (
                        <Badge tone="ok">Paid</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
