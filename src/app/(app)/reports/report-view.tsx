import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus } from "lucide-react";
import { STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { formatINR, formatMinutes, nextDay } from "@/lib/format";
import { Empty, Panel } from "@/components/card";
import { cx } from "@/components/styles";
import { ColumnChart, Heatmap, Legend, Meter, SegmentBar, Sparkline } from "./charts";

type Method = "cash" | "upi";

export type Report = {
  revenue: number;
  tax: number;
  bills: number;
  sessions: number;
  written_off: number;
  by_day: { day: string; total: number }[];
  by_method: Partial<Record<Method, number>>;
  by_type: { type: StationType; revenue: number; minutes: number }[];
};

export type Insights = {
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
};

const METHODS: { key: Method; label: string; color: string }[] = [
  { key: "upi", label: "UPI", color: "var(--series-1)" },
  { key: "cash", label: "Cash", color: "var(--series-2)" },
];

export type ReportRange = { key: string; label: string; days: number };

// Pure view: everything the Reports page shows, from the two report RPCs.
export function ReportView({
  header,
  range,
  from,
  r,
  x,
  costs,
}: {
  header: ReactNode;
  range: ReportRange;
  from: string;
  r: Report;
  x: Insights;
  /** Expenses logged for this period and the one before it. */
  costs: { total: number; previous: number };
}) {
  const single = range.days === 1;
  const isToday = range.key === "today";
  const vsLabel = single ? (isToday ? "yesterday" : "the day before") : `previous ${range.days} days`;

  // Revenue per day, with a slot for every day of the range.
  const days = Array.from({ length: range.days }, (_, i) => nextDay(from, i));
  const dayTotals = days.map((d) => ({ day: d, total: Number(r.by_day.find((v) => v.day === d)?.total ?? 0) }));

  // Today: sessions started per hour (all heatmap cells fall on today).
  const hourly = Array.from({ length: 24 }, (_, h) =>
    x.heatmap.filter((c) => c.hour === h).reduce((s, c) => s + c.sessions, 0),
  );

  // Floor utilisation across every active station (each station has the same open hours).
  const stationCount = x.utilisation_by_type.reduce((s, u) => s + u.stations, 0);
  const utilisation = stationCount
    ? x.utilisation_by_type.reduce((s, u) => s + Number(u.pct) * u.stations, 0) / stationCount
    : 0;

  // Station kinds: utilisation and revenue side by side.
  const types = Array.from(
    new Set([...x.utilisation_by_type.map((u) => u.type), ...r.by_type.map((t) => t.type)]),
  ).map((type) => {
    const u = x.utilisation_by_type.find((v) => v.type === type);
    const t = r.by_type.find((v) => v.type === type);
    return {
      type,
      stations: u?.stations ?? 0,
      pct: Number(u?.pct ?? 0),
      minutes: Number(u?.minutes ?? t?.minutes ?? 0),
      revenue: Number(t?.revenue ?? 0),
    };
  });
  types.sort((a, b) => b.revenue - a.revenue || b.pct - a.pct);
  const typeRevenue = types.reduce((s, t) => s + t.revenue, 0);

  // Net profit: revenue from bills minus expenses logged for the same days.
  const net = Number(r.revenue) - costs.total;
  const prevNet = Number(x.previous.revenue) - costs.previous;
  const margin = Number(r.revenue) > 0 ? Math.round((net / Number(r.revenue)) * 100) : null;

  const collected = METHODS.reduce((s, m) => s + Number(r.by_method[m.key] ?? 0), 0);
  const quiet = Number(r.revenue) === 0 && r.sessions === 0;

  return (
    <>
      {header}

      <div className="flex flex-col gap-5">
        {/* Four numbers that drive decisions. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi
            label="Revenue"
            value={formatINR(r.revenue)}
            delta={<Delta now={Number(r.revenue)} before={Number(x.previous.revenue)} vs={vsLabel} />}
            trend={single ? undefined : dayTotals.map((d) => d.total)}
          />
          <Kpi
            label="Floor utilisation"
            value={`${round1(utilisation)}%`}
            delta={<span>{formatHours(Number(x.played_minutes))} played on {stationCount} stations</span>}
            footer={<Meter pct={utilisation} className="mt-3" />}
          />
          <Kpi
            label="Sessions"
            value={r.sessions.toLocaleString("en-IN")}
            delta={<Delta now={r.sessions} before={Number(x.previous.sessions)} vs={vsLabel} />}
            sub={x.avg_session_minutes ? `Average ${formatMinutes(Number(x.avg_session_minutes))} each` : undefined}
          />
          <Kpi
            label="Net profit"
            value={<span className={cx(net < 0 && "text-over")}>{formatINR(Math.round(net))}</span>}
            delta={
              costs.total || costs.previous ? (
                <Delta now={net} before={prevNet} vs={vsLabel} />
              ) : (
                <span>
                  No expenses logged.{" "}
                  <Link href="/expenses" className="font-medium text-accent-ink hover:underline">
                    Add them
                  </Link>
                </span>
              )
            }
            sub={
              <span>
                <span className="num">{formatINR(costs.total)}</span> expenses
                {margin !== null && costs.total > 0 ? ` · ${margin}% margin` : ""}
              </span>
            }
          />
        </div>

        {quiet ? (
          <Panel>
            <Empty icon={<BarChart3 />} title={isToday ? "No activity yet today" : single ? "No activity on this day" : "No activity in this period"}>
              Numbers appear here as soon as a session is billed. Try a longer period above.
            </Empty>
          </Panel>
        ) : (
          <>
            {single ? (
              <Panel
                title="Sessions by hour"
                description={`When ${isToday ? "today's" : "the day's"} sessions started. Plan staff and happy hours around the peaks.`}
              >
                <ColumnChart
                  bars={hourly.map((n, h) => ({
                    key: String(h),
                    value: n,
                    label: `${String(h).padStart(2, "0")}:00`,
                    display: `${n} session${n === 1 ? "" : "s"}`,
                  }))}
                  labelEvery={3}
                  empty={isToday ? "No sessions started yet today." : "No sessions started this day."}
                />
              </Panel>
            ) : (
              <Panel
                title="Revenue per day"
                description={bestDay(dayTotals)}
                action={<span className="num text-sm font-semibold">{formatINR(r.revenue)}</span>}
              >
                <ColumnChart
                  bars={dayTotals.map((d) => ({
                    key: d.day,
                    value: d.total,
                    label: dayLabel(d.day),
                    display: formatINR(d.total),
                  }))}
                  labelEvery={Math.max(1, Math.ceil(range.days / 10))}
                  axisPrefix="₹"
                />
              </Panel>
            )}

            <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
              <Panel
                title="Station types"
                description="How busy each kind of station is, and what it earns."
                flush
              >
                {types.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted">No active stations.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs text-muted">
                          <th className="px-4 py-2.5 text-left font-medium">Type</th>
                          <th className="px-4 py-2.5 text-left font-medium">In use</th>
                          <th className="px-4 py-2.5 text-right font-medium">Played</th>
                          <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {types.map((t) => (
                          <tr key={t.type} className="border-b border-line last:border-0 hover:bg-subtle/60">
                            <td className="px-4 py-3">
                              <span className="font-medium">{STATION_TYPE_LABEL[t.type]}</span>
                              {t.stations > 0 && <span className="ml-1.5 text-xs text-muted">×{t.stations}</span>}
                            </td>
                            <td className="w-[38%] px-4 py-3">
                              <div className="flex items-center gap-3">
                                <Meter pct={t.pct} />
                                <span className="num w-12 shrink-0 text-right text-[13px]">{round1(t.pct)}%</span>
                              </div>
                            </td>
                            <td className="num px-4 py-3 text-right text-muted">{formatHours(t.minutes)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className="num font-medium">{formatINR(t.revenue)}</span>
                              {typeRevenue > 0 && (
                                <span className="num block text-[11px] text-muted">
                                  {Math.round((t.revenue / typeRevenue) * 100)}% of total
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                  In use = share of opening hours a station was running
                  {" "}(24 h a day until opening hours are set in{" "}
                  <Link href="/settings" className="text-accent-ink hover:underline">
                    Settings
                  </Link>
                  ).
                </p>
              </Panel>

              <Panel
                title="Payments"
                description="How the money came in."
                action={<span className="num text-sm font-semibold">{formatINR(collected)}</span>}
              >
                <SegmentBar
                  parts={METHODS.map((m) => ({
                    key: m.key,
                    label: m.label,
                    value: Number(r.by_method[m.key] ?? 0),
                    color: m.color,
                  }))}
                />
                <div className="mt-2">
                  <Legend
                    items={METHODS.map((m) => {
                      const v = Number(r.by_method[m.key] ?? 0);
                      return {
                        color: m.color,
                        label: m.label,
                        value: formatINR(v),
                        share: collected ? `${Math.round((v / collected) * 100)}%` : undefined,
                      };
                    })}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {Number(r.tax) > 0 && <MiniStat label="GST in revenue" value={formatINR(r.tax)} />}
                  <MiniStat label="Discounts given" value={formatINR(x.discounts)} />
                  <MiniStat
                    label="Written off"
                    value={formatINR(r.written_off)}
                    warn={Number(r.written_off) > 0}
                  />
                </dl>
              </Panel>
            </div>

            {!single && (
              <Panel title="Peak times" description="Sessions started by weekday and hour. Darker is busier.">
                <Heatmap cells={x.heatmap} />
              </Panel>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Top stations" description="By revenue in this period." flush>
                <RankTable
                  empty="No sessions yet."
                  head={["Station", "Sessions", "In use", "Revenue"]}
                  rows={x.top_stations.map((t) => [
                    <span key="n">
                      <span className="font-medium">{t.name}</span>
                      <span className="ml-1.5 text-xs text-muted">{STATION_TYPE_LABEL[t.type]}</span>
                    </span>,
                    t.sessions,
                    `${round1(Number(t.pct))}%`,
                    formatINR(t.revenue),
                  ])}
                />
              </Panel>

              <Panel
                title="Top players"
                description={
                  x.players.total
                    ? `${x.players.total} named player${x.players.total === 1 ? "" : "s"} · ${x.players.new} new`
                    : "Players you add at the counter show up here."
                }
                flush
              >
                <RankTable
                  empty="No player sessions yet."
                  head={["Player", "Visits", "Played", "Spent"]}
                  rows={x.top_players.map((p) => [
                    <Link key="n" href={`/players/${p.id}`} className="font-medium hover:text-accent-ink hover:underline">
                      {p.name}
                    </Link>,
                    p.visits,
                    formatHours(Number(p.minutes)),
                    formatINR(p.spent),
                  ])}
                />
              </Panel>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  delta,
  sub,
  trend,
  footer,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  sub?: ReactNode;
  trend?: number[];
  footer?: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel p-4 shadow-card">
      <h2 className="text-[13px] font-medium text-muted">{label}</h2>
      <p className="num mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{value}</p>
      {delta && <div className="mt-1 text-xs text-muted">{delta}</div>}
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
      {trend && <Sparkline values={trend} className="mt-3" />}
      {footer}
    </section>
  );
}

// Signed change vs the previous period. Up is good for revenue and sessions.
function Delta({ now, before, vs }: { now: number; before: number; vs: string }) {
  if (!before) return <span>No data for {vs}</span>;
  // abs() keeps the direction right when the previous figure was negative (a loss).
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={cx(
          "inline-flex items-center gap-0.5 rounded-md px-1 py-px font-medium",
          pct > 0 ? "bg-ok/10 text-ok" : pct < 0 ? "bg-over/10 text-over" : "bg-subtle text-muted",
        )}
      >
        <Icon className="size-3" strokeWidth={2.5} />
        <span className="num">{Math.abs(pct)}%</span>
      </span>
      vs {vs}
    </span>
  );
}

function MiniStat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-subtle px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("num mt-0.5 text-[13px] font-medium", warn && "text-over")}>{value}</dd>
    </div>
  );
}

function RankTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="w-10 py-2.5 pl-4 text-left font-medium">#</th>
            {head.map((h, i) => (
              <th key={h} className={cx("px-4 py-2.5 font-medium", i === 0 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0 hover:bg-subtle/60">
              <td className="num py-2.5 pl-4 text-xs text-faint">{i + 1}</td>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cx(
                    "px-4 py-2.5",
                    j === 0 ? "text-left" : "num text-right",
                    j === row.length - 1 && "font-medium",
                    j > 0 && j < row.length - 1 && "text-muted",
                  )}
                >
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

const round1 = (n: number) => Math.round(n * 10) / 10;

function formatHours(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h >= 100 ? Math.round(h).toLocaleString("en-IN") : round1(h)} h`;
}

function dayLabel(day: string, weekday = false) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function rangeText(from: string, to: string, days: number, today?: string) {
  if (days === 1) return to === today ? `Today, ${dayLabel(to, true)}` : dayLabel(to, true);
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

function bestDay(days: { day: string; total: number }[]) {
  const best = days.reduce((a, b) => (b.total > a.total ? b : a), days[0]);
  const active = days.filter((d) => d.total > 0).length;
  if (!best || best.total === 0) return "No bills in this period.";
  return `Best day ${dayLabel(best.day, true)} (${formatINR(best.total)}) · ${active} of ${days.length} days with sales`;
}
