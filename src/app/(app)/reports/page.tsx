import { Fragment, Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { DAY_LABELS, STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { formatINR, formatMinutes, nextDay, todayIn } from "@/lib/format";
import { PageHeader, PageSkeleton, Panel, Stat } from "@/components/card";
import { cx } from "@/components/styles";

export const metadata: Metadata = { title: "Reports" };

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
] as const;

type Report = {
  revenue: number;
  tax: number;
  bills: number;
  sessions: number;
  written_off: number;
  by_day: { day: string; total: number }[];
  by_method: Partial<Record<"cash" | "upi" | "card", number>>;
  by_type: { type: StationType; revenue: number; minutes: number }[];
};

type Insights = {
  previous: { revenue: number; sessions: number };
  avg_session_minutes: number | null;
  avg_bill: number | null;
  discounts: number;
  played_minutes: number;
  utilisation_by_type: { type: StationType; stations: number; minutes: number; pct: number }[];
  top_stations: { name: string; type: StationType; sessions: number; minutes: number; revenue: number; pct: number }[];
  top_players: { id: string; name: string; phone: string; visits: number; spent: number; minutes: number }[];
  players: { total: number; new: number };
  heatmap: { dow: number; hour: number; sessions: number }[];
  by_mode: Partial<Record<"open" | "prepaid", number>>;
};

export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reports searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const { branch, role } = await getAppContext();
  if (!isOwner(role)) {
    return (
      <>
        <PageHeader title="Reports" />
        <p className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
          <Lock className="size-4" /> Reports are visible to the owner.
        </p>
      </>
    );
  }

  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[0];
  const to = todayIn(branch.timezone);
  const from = nextDay(to, -(range.days - 1));

  const supabase = await createClient();
  const args = { p_branch_id: branch.id, p_from: from, p_to: to };
  const [summary, insights] = await Promise.all([
    supabase.rpc("report_summary", args),
    supabase.rpc("report_insights", args),
  ]);
  const r = summary.data as Report | null;
  const x = insights.data as Insights | null;
  const error = summary.error ?? insights.error;

  // Fill missing days so the chart has a bar slot per day.
  const days = Array.from({ length: range.days }, (_, i) => nextDay(from, i));
  const dayTotals = days.map((d) => ({ day: d, total: Number(r?.by_day.find((v) => v.day === d)?.total ?? 0) }));
  const periodLabel = range.days === 1 ? "yesterday" : `previous ${range.days} days`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${branch.name} · ${range.days === 1 ? "today" : `last ${range.days} days`}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/bills/export?from=${from}&to=${to}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] font-medium hover:bg-hover"
            >
              <Download className="size-4" /> Bills CSV
            </a>
            <div className="inline-flex rounded-md border border-line-strong bg-subtle p-0.5">
              {RANGES.map((v) => (
                <Link
                  key={v.key}
                  href={`/reports?range=${v.key}`}
                  className={cx(
                    "rounded-[5px] px-3 py-1 text-[13px] font-medium",
                    v.key === range.key ? "bg-panel text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg",
                  )}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          </div>
        }
      />

      {error || !r || !x ? (
        <Panel>
          <p className="text-sm text-danger">Couldn&apos;t load the report. {error?.message}</p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <Panel flush>
            <div className="grid grid-cols-2 sm:grid-cols-4 [&>*]:border-line [&>*:nth-child(-n+4)]:border-b sm:[&>*:not(:nth-child(4n))]:border-r">
              <Stat
                label="Revenue"
                value={formatINR(r.revenue)}
                sub={<Change now={Number(r.revenue)} before={Number(x.previous.revenue)} label={periodLabel} />}
              />
              <Stat
                label="Sessions"
                value={r.sessions}
                sub={<Change now={r.sessions} before={Number(x.previous.sessions)} label={periodLabel} />}
              />
              <Stat label="Average bill" value={formatINR(x.avg_bill ?? 0)} sub={`${r.bills} bills`} />
              <Stat
                label="Average session"
                value={x.avg_session_minutes ? formatMinutes(Number(x.avg_session_minutes)) : "—"}
                sub={`${formatMinutes(Number(x.played_minutes))} played in total`}
              />
              <Stat
                label="Players"
                value={x.players.total}
                sub={`${x.players.new} new · ${x.players.total - x.players.new} returning`}
              />
              <Stat
                label="Open / fixed time"
                value={`${x.by_mode.open ?? 0} / ${x.by_mode.prepaid ?? 0}`}
                sub="sessions by timer mode"
              />
              <Stat label="Discounts given" value={formatINR(x.discounts)} />
              <Stat
                label="Written off"
                value={formatINR(r.written_off)}
                sub={r.tax > 0 ? `GST collected ${formatINR(r.tax)}` : undefined}
              />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            {range.days > 1 && (
              <Panel title="Revenue per day" className="lg:col-span-2">
                <BarChart
                  bars={dayTotals.map((d) => ({
                    key: d.day,
                    value: d.total,
                    label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                    }),
                    display: formatINR(d.total),
                  }))}
                  labelEvery={range.days > 10 ? 5 : 1}
                />
              </Panel>
            )}

            <Panel
              title="How busy are your stations?"
              description="Share of opening hours in use (24 h a day if opening hours aren't set in Settings)."
              flush
            >
              {x.utilisation_by_type.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">No active stations.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {x.utilisation_by_type.map((u) => (
                      <tr key={u.type} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 font-medium">
                          {STATION_TYPE_LABEL[u.type]}
                          <span className="ml-1 text-xs font-normal text-muted">×{u.stations}</span>
                        </td>
                        <td className="w-2/5 px-4 py-2.5">
                          <div className="h-2 rounded-full bg-subtle">
                            <div
                              className="h-2 rounded-full bg-fg/70"
                              style={{ width: `${Math.min(Number(u.pct), 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="num px-4 py-2.5 text-right">{Number(u.pct)}%</td>
                        <td className="num px-4 py-2.5 text-right text-muted">{formatMinutes(Number(u.minutes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Revenue by station type" flush>
              {r.by_type.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">No sessions billed yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {r.by_type.map((t) => {
                      const max = Math.max(...r.by_type.map((v) => Number(v.revenue)), 1);
                      return (
                        <tr key={t.type} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5 font-medium">{STATION_TYPE_LABEL[t.type]}</td>
                          <td className="w-2/5 px-4 py-2.5">
                            <div
                              className="h-2 rounded-r-[4px] bg-fg/70"
                              style={{ width: `${(Number(t.revenue) / max) * 100}%` }}
                            />
                          </td>
                          <td className="num px-4 py-2.5 text-right">{formatINR(t.revenue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Top stations" flush>
              <SimpleTable
                empty="No sessions yet."
                head={["Station", "Sessions", "Played", "In use", "Revenue"]}
                rows={x.top_stations.map((t) => [
                  <span key="n" className="font-medium">
                    {t.name}
                  </span>,
                  t.sessions,
                  formatMinutes(Number(t.minutes)),
                  `${Number(t.pct)}%`,
                  formatINR(t.revenue),
                ])}
              />
            </Panel>

            <Panel title="Top players" flush>
              <SimpleTable
                empty="No player sessions yet."
                head={["Player", "Visits", "Played", "Spent"]}
                rows={x.top_players.map((p) => [
                  <Link key="n" href={`/players/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                    {p.name}
                  </Link>,
                  p.visits,
                  formatMinutes(Number(p.minutes)),
                  formatINR(p.spent),
                ])}
              />
            </Panel>

            <Panel
              title="Peak times"
              description="Sessions started, by weekday and hour. Darker is busier."
              className="lg:col-span-2"
            >
              <Heatmap cells={x.heatmap} />
            </Panel>

            <Panel title="Payments" flush>
              <table className="w-full text-sm">
                <tbody>
                  {(["cash", "upi", "card"] as const).map((m) => (
                    <tr key={m} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">{m === "upi" ? "UPI" : m[0].toUpperCase() + m.slice(1)}</td>
                      <td className="num px-4 py-2.5 text-right">{formatINR(r.by_method[m] ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function Change({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <span>no data for {label}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <span>
      <span className={pct >= 0 ? "text-ok" : "text-over"}>
        {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
      </span>{" "}
      vs {label}
    </span>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={h} className={cx("px-4 py-2 font-medium", i === 0 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {row.map((cell, j) => (
                <td key={j} className={cx("px-4 py-2", j === 0 ? "text-left" : "num text-right")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DAYS_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

// Weekday × hour grid. Single-hue sequential scale (ink opacity), value on hover.
function Heatmap({ cells }: { cells: { dow: number; hour: number; sessions: number }[] }) {
  const max = Math.max(...cells.map((c) => c.sessions), 0);
  if (max === 0) return <p className="py-6 text-sm text-muted">Nothing in this period yet.</p>;
  const at = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.sessions ?? 0;

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px]">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="num text-center text-faint">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
        {DAYS_MON_FIRST.map((dow) => (
          <Fragment key={dow}>
            <span className="self-center text-muted">{DAY_LABELS[dow]}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const n = at(dow, h);
              return (
                <span
                  key={h}
                  title={`${DAY_LABELS[dow]} ${String(h).padStart(2, "0")}:00 · ${n} session${n === 1 ? "" : "s"}`}
                  className="aspect-square rounded-[3px] bg-subtle"
                  style={
                    n ? { backgroundColor: `color-mix(in oklab, var(--fg) ${15 + (n / max) * 70}%, transparent)` } : undefined
                  }
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// Single-series column chart. One neutral ink (no legend needed: the panel title names it),
// 2px gaps, 4px rounded tops on the baseline, hover shows the value.
function BarChart({
  bars,
  labelEvery = 1,
}: {
  bars: { key: string; value: number; label: string; display: string }[];
  labelEvery?: number;
}) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  if (max === 0) return <p className="py-6 text-sm text-muted">Nothing in this period yet.</p>;

  return (
    <div>
      <div className="flex h-40 items-end gap-[2px] border-b border-line">
        {bars.map((b) => (
          <div key={b.key} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-[4px] bg-fg/70 transition-colors group-hover:bg-fg"
              style={{ height: `${Math.max((b.value / max) * 100, b.value > 0 ? 2 : 0)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-line bg-panel px-2 py-1 text-xs group-hover:block">
              <span className="text-muted">{b.label}</span> <span className="num font-medium">{b.display}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {bars.map((b, i) => (
          <span key={b.key} className="num flex-1 truncate text-center text-[10px] text-faint">
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
