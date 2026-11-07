import { Fragment, type ReactNode } from "react";
import { DAY_LABELS } from "@/lib/constants";
import { cx } from "@/components/styles";

// Report figures, server-rendered (no client JS). Hover tooltips are CSS-only.
// Marks wear --chart-ink / --series-*; all text stays in text tokens.

// Clean axis: 3-5 ticks on 1/2/2.5/5 × 10^n steps.
function niceTicks(max: number) {
  if (max <= 0) return [0];
  const raw = max / 4;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * base).find((s) => max / s <= 4) ?? base * 10;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export function compact(n: number) {
  if (n >= 100_000) return `${+(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type Bar = { key: string; label: string; value: number; display: string };

// Single-series column chart with a recessive grid, a labelled peak and per-column hover.
export function ColumnChart({
  bars,
  labelEvery = 1,
  axisPrefix = "",
  empty = "Nothing in this period yet.",
}: {
  bars: Bar[];
  labelEvery?: number;
  axisPrefix?: string;
  empty?: string;
}) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  if (max === 0) return <p className="py-10 text-center text-sm text-muted">{empty}</p>;

  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const peak = bars.reduce((a, b) => (b.value > a.value ? b : a), bars[0]);

  return (
    <figure className="mt-5 grid grid-cols-[auto_1fr] gap-x-3">
      {/* Y axis */}
      <div className="relative h-52 w-9 text-right">
        {ticks.map((t) => (
          <span
            key={t}
            className="num absolute right-0 -translate-y-1/2 text-[11px] text-faint"
            style={{ bottom: `${(t / top) * 100}%` }}
          >
            {axisPrefix}
            {compact(t)}
          </span>
        ))}
      </div>

      {/* Plot */}
      <div className="relative h-52">
        {ticks.map((t) => (
          <div
            key={t}
            aria-hidden
            className={cx("absolute inset-x-0 h-px", t === 0 ? "bg-line-strong" : "bg-line/70")}
            style={{ bottom: `${(t / top) * 100}%` }}
          />
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {bars.map((b) => {
            const h = (b.value / top) * 100;
            const isPeak = b.key === peak.key;
            return (
              <div key={b.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                {/* Hover band, wider than the mark. */}
                <div aria-hidden className="absolute inset-0 rounded-md bg-fg/0 transition-colors group-hover:bg-fg/[0.04]" />
                <div
                  className={cx(
                    "relative w-full max-w-6 rounded-t-[4px] transition-[filter] group-hover:brightness-110",
                    b.value > 0 ? "bg-chart" : "",
                  )}
                  style={{ height: `${Math.max(h, b.value > 0 ? 1.5 : 0)}%` }}
                >
                  {isPeak && (
                    <span className="num absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-fg group-hover:invisible">
                      {b.display}
                    </span>
                  )}
                </div>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-pop group-hover:block"
                  style={{ bottom: `${Math.min(h, 88)}%` }}
                >
                  <span className="block text-[11px] text-muted">{b.label}</span>
                  <span className="num font-semibold">{b.display}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* X labels */}
      <span />
      <div className="mt-1.5 flex gap-[2px]">
        {bars.map((b, i) => (
          <span key={b.key} className="relative h-3.5 min-w-0 flex-1">
            {i % labelEvery === 0 && (
              <span className="num absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-faint">
                {b.label}
              </span>
            )}
          </span>
        ))}
      </div>
    </figure>
  );
}

// 12-point trend line for a KPI tile: 2px line, 10% wash, end dot.
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2 || Math.max(...values) === 0) return null;
  const W = 100;
  const H = 32;
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  const [ex, ey] = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className={cx("h-8 w-full overflow-visible", className)}>
      <path d={`${line}L${W},${H}L0,${H}Z`} className="fill-chart/10" />
      <path d={line} className="fill-none stroke-chart" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ex} cy={ey} r={3.5} className="fill-chart stroke-panel" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Horizontal meter: accent fill on a lighter track of the same hue.
export function Meter({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-chart/15", className)}>
      <div className="h-full rounded-full bg-chart" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
  );
}

// One whole split into parts (payment mix). 2px surface gap between segments.
export function SegmentBar({ parts }: { parts: { key: string; value: number; color: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <div className="h-2.5 rounded-full bg-subtle" />;
  return (
    <div className="flex h-2.5 gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }}
          />
        ))}
    </div>
  );
}

const DAYS_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const hh = (h: number) => String(h).padStart(2, "0");

// Weekday × hour grid. One hue, light → dark, with a scale legend and the busiest slot called out.
export function Heatmap({ cells }: { cells: { dow: number; hour: number; sessions: number }[] }) {
  const max = Math.max(...cells.map((c) => c.sessions), 0);
  if (max === 0) return <p className="py-10 text-center text-sm text-muted">Nothing in this period yet.</p>;
  const at = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.sessions ?? 0;
  const fill = (n: number) =>
    n ? { backgroundColor: `color-mix(in oklab, var(--chart-ink) ${18 + (n / max) * 82}%, var(--subtle))` } : undefined;
  const busiest = cells.reduce((a, b) => (b.sessions > a.sessions ? b : a), cells[0]);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-[30px_repeat(24,minmax(0,1fr))] gap-[2px] text-[9px] sm:min-w-[620px] sm:grid-cols-[36px_repeat(24,minmax(0,1fr))] sm:gap-[3px] sm:text-[10px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="num text-center text-faint">
              {h % 3 === 0 ? hh(h) : ""}
            </span>
          ))}
          {DAYS_MON_FIRST.map((dow) => (
            <Fragment key={dow}>
              <span className="self-center text-[11px] text-muted">{DAY_LABELS[dow]}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const n = at(dow, h);
                return (
                  <span
                    key={h}
                    title={`${DAY_LABELS[dow]} ${hh(h)}:00–${hh((h + 1) % 24)}:00 · ${n} session${n === 1 ? "" : "s"}`}
                    className="aspect-square rounded-[2px] bg-subtle transition-transform hover:scale-125 hover:ring-2 hover:ring-panel sm:rounded-[4px]"
                    style={fill(n)}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          Busiest:{" "}
          <span className="font-medium text-fg">
            {DAY_LABELS[busiest.dow]} {hh(busiest.hour)}:00–{hh((busiest.hour + 1) % 24)}:00
          </span>{" "}
          · {busiest.sessions} session{busiest.sessions === 1 ? "" : "s"} started
        </span>
        <span className="inline-flex items-center gap-1.5">
          Fewer
          {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
            <span key={f} className="size-3 rounded-[3px]" style={fill(f * max)} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: ReactNode; value: ReactNode; share?: string }[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2.5 border-b border-line py-2.5 text-sm last:border-0">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: it.color }} aria-hidden />
          <span className="flex-1">{it.label}</span>
          {it.share && <span className="num text-xs text-muted">{it.share}</span>}
          <span className="num w-24 text-right font-medium">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
