"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, LayoutGrid, Map as MapIcon, Pause, PencilRuler, WifiOff } from "lucide-react";
import { estimateCharge, prepaidRemainingSeconds, type Charge } from "@/lib/pricing";
import { STATION_TYPE_LABEL, STATION_TYPES, type StationType } from "@/lib/constants";
import { formatClock, formatINR } from "@/lib/format";
import { Empty, PageHeader, Panel } from "@/components/card";
import { Button, Segmented, buttonClass, cx } from "@/components/ui";
import { beep, useFloorSessions, useLocalPref, useMuted, useServerClock } from "./use-floor";
import { FloorMap, LayoutEditor, initialPlacements } from "./floor-map";
import { StationSheet } from "./station-sheet";
import { CheckoutDialog } from "./checkout-dialog";
import {
  ENDING_SOON_SECONDS,
  type FloorData,
  type FloorPlan,
  type FloorStation,
  type LiveSession,
  type TileState,
} from "./types";

export type TileInfo = {
  state: TileState;
  clock: string | null; // elapsed (open time) or remaining (fixed time)
  clockLabel: string;
  charge: Charge | null;
  remaining: number | null;
};

export function deriveTile(
  station: FloorStation,
  session: LiveSession | undefined,
  plan: FloorPlan | undefined,
  nowMs: number,
  rules: { graceMinutes: number; earlyEndPolicy: "full" | "played"; timeZone: string },
  cache: Map<number, number>,
): TileInfo {
  const { graceMinutes, earlyEndPolicy, timeZone } = rules;
  if (station.status !== "active" && !session) {
    return { state: "off", clock: null, clockLabel: station.status, charge: null, remaining: null };
  }
  if (!session) return { state: "free", clock: null, clockLabel: "Free", charge: null, remaining: null };

  const charge = plan
    ? estimateCharge(
        { ...session, pauses: session.session_pauses },
        plan,
        plan.rate_rules,
        { timeZone, graceMinutes, earlyEndPolicy, nowMs, cache },
      )
    : null;

  if (session.mode === "prepaid") {
    const remaining = prepaidRemainingSeconds(session.planned_end_at, session.paused_at, nowMs) ?? 0;
    const state: TileState =
      session.status === "paused" ? "paused" : remaining <= 0 ? "over" : remaining <= ENDING_SOON_SECONDS ? "ending" : "busy";
    return {
      state,
      clock: formatClock(remaining),
      clockLabel: remaining <= 0 ? "Overtime" : "Left",
      charge,
      remaining,
    };
  }

  return {
    state: session.status === "paused" ? "paused" : "busy",
    clock: formatClock(charge?.activeSeconds ?? 0),
    clockLabel: "Elapsed",
    charge,
    remaining: null,
  };
}

const TILE_STYLE: Record<TileState, string> = {
  free: "border-line hover:border-free/50",
  busy: "border-busy/35 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--busy)_7%,var(--panel)),var(--panel)_70%)]",
  ending:
    "border-ending/50 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ending)_10%,var(--panel)),var(--panel)_70%)]",
  over: "border-over/60 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--over)_11%,var(--panel)),var(--panel)_70%)] ring-1 ring-over/20",
  paused: "border-dashed border-line-strong",
  off: "border-dashed border-line opacity-55",
};

// Top edge colour per state, so a glance across the floor reads at once.
const EDGE: Record<TileState, string> = {
  free: "bg-free/60",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over",
  paused: "bg-paused/50",
  off: "bg-transparent",
};

const DOT: Record<TileState, string> = {
  free: "bg-free",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over blink",
  paused: "bg-paused",
  off: "bg-faint",
};

const STATE_TEXT: Record<TileState, string> = {
  free: "text-free",
  busy: "text-busy",
  ending: "text-ending",
  over: "text-over",
  paused: "text-paused",
  off: "text-faint",
};

export function FloorBoard({ initial }: { initial: FloorData }) {
  const { branch, stations, plans, settings } = initial;
  const { sessions, connected, refetch, supabase } = useFloorSessions(branch.id, initial.sessions);
  const now = useServerClock(initial.serverNow);

  const [filter, setFilter] = useState<StationType | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkoutIds, setCheckoutIds] = useState<string[] | null>(null);
  const [muted, setMuted] = useMuted();
  const [view, setView] = useLocalPref<"grid" | "map">("qs_floor_view", "grid");
  const [editingLayout, setEditingLayout] = useState(false);
  const [placements, setPlacements] = useState(() => initialPlacements(stations));
  const canEditLayout = initial.role === "owner";

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  // Rate lookups per plan per minute never change, so cache them across ticks.
  const [rateCaches] = useState(() => new Map<string, Map<number, number>>());
  const cacheFor = (planId: string) => {
    let c = rateCaches.get(planId);
    if (!c) rateCaches.set(planId, (c = new Map()));
    return c;
  };

  const liveByStation = useMemo(() => {
    const m = new Map<string, LiveSession>();
    for (const s of sessions) if (s.status !== "ended") m.set(s.station_id, s);
    return m;
  }, [sessions]);
  const unpaid = sessions.filter((s) => s.status === "ended" && Number(s.outstanding) > 0);

  const tiles = stations.map((st) => {
    const session = liveByStation.get(st.id);
    const plan = session ? planById.get(session.rate_plan_id) : undefined;
    return {
      station: st,
      session,
      info: deriveTile(
        st,
        session,
        plan,
        now,
        { graceMinutes: settings.graceMinutes, earlyEndPolicy: settings.earlyEndPolicy, timeZone: branch.timezone },
        cacheFor(plan?.id ?? "-"),
      ),
    };
  });

  // Beep once when a fixed-time session runs out.
  const alerted = useRef(new Set<string>());
  const overIds = tiles.filter((t) => t.info.state === "over" && t.session).map((t) => t.session!.id);
  useEffect(() => {
    const fresh = overIds.filter((id) => !alerted.current.has(id));
    fresh.forEach((id) => alerted.current.add(id));
    if (fresh.length && !muted) beep();
  }, [overIds.join(","), muted]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    free: tiles.filter((t) => t.info.state === "free").length,
    busy: tiles.filter((t) => ["busy", "paused"].includes(t.info.state)).length,
    ending: tiles.filter((t) => t.info.state === "ending").length,
    over: tiles.filter((t) => t.info.state === "over").length,
  };
  const runningTotal = tiles.reduce((sum, t) => sum + (t.info.charge?.total ?? 0), 0);

  const typesPresent = STATION_TYPES.filter((t) => stations.some((s) => s.type === t));
  const typesWithoutPrice = typesPresent.filter(
    (t) => !plans.some((p) => p.station_type === t && p.is_active),
  );
  const visibleTypes = filter === "all" ? typesPresent : [filter];

  const selected = tiles.find((t) => t.station.id === selectedId);
  const infos = Object.fromEntries(tiles.map((t) => [t.station.id, t.info]));

  if (stations.length === 0) {
    return (
      <Panel>
        <Empty icon={<LayoutGrid />} title="No stations yet">
          Add your PCs, consoles and tables to see them here.
          <div className="mt-4">
            <Link href="/stations" className={buttonClass("primary")}>
              Add stations
            </Link>
          </div>
        </Empty>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Floor"
        description={`${branch.name} · ${stations.length} station${stations.length === 1 ? "" : "s"}`}
        actions={
          <>
            <span
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                connected ? "border-free/30 bg-free/8 text-free" : "border-ending/40 bg-ending/10 text-ending",
              )}
            >
              <span className={cx("size-1.5 rounded-full", connected ? "bg-free blink" : "bg-ending")} />
              {connected ? "Live" : "Reconnecting"}
            </span>
            {view === "map" && canEditLayout && !editingLayout && (
              <Button size="sm" variant="secondary" onClick={() => setEditingLayout(true)}>
                <PencilRuler /> Edit layout
              </Button>
            )}
            <Segmented
              value={view}
              onChange={(v) => {
                setEditingLayout(false);
                setView(v);
              }}
              options={[
                { value: "grid", label: <><LayoutGrid /> Grid</> },
                { value: "map", label: <><MapIcon /> Map</> },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              aria-label={muted ? "Unmute alerts" : "Mute alerts"}
              title={muted ? "Alerts muted" : "Alert sound on"}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <BellOff /> : <Bell />}
            </Button>
          </>
        }
      />

      {!connected && (
        <div className="flex items-center gap-2 rounded-xl border border-ending/40 bg-ending/10 px-3.5 py-2.5 text-sm text-ending">
          <WifiOff className="size-4 shrink-0" />
          Internet down. Reconnecting… Timers keep running; changes sync when you&apos;re back.
        </div>
      )}
      {typesWithoutPrice.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ending/30 bg-ending/8 px-3.5 py-2.5 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-ending" />
          No price set for {typesWithoutPrice.map((t) => STATION_TYPE_LABEL[t]).join(", ")}. Sessions can&apos;t start
          there yet.
          <Link href="/pricing" className={buttonClass("secondary", "sm", "ml-auto")}>
            Set prices
          </Link>
        </div>
      )}

      {/* At a glance */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Count dot="bg-free" label="Free" value={counts.free} total={tiles.length} />
        <Count dot="bg-busy" label="In use" value={counts.busy} total={tiles.length} />
        <Count dot="bg-ending" label="Ending soon" value={counts.ending} highlight={counts.ending > 0} tone="ending" />
        <Count dot="bg-over" label="Overtime" value={counts.over} highlight={counts.over > 0} tone="over" />
        <div className="col-span-2 flex flex-col justify-center rounded-xl border border-line bg-panel px-3.5 py-2.5 shadow-xs sm:col-span-1">
          <span className="text-xs font-medium text-muted">Running now</span>
          <span className="num text-lg font-semibold tracking-tight">{formatINR(runningTotal)}</span>
        </div>
      </div>

      {view === "grid" && typesPresent.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {(["all", ...typesPresent] as const).map((t) => {
            const n = t === "all" ? tiles.length : tiles.filter((x) => x.station.type === t).length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                aria-pressed={filter === t}
                className={cx(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  filter === t
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line bg-panel text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t === "all" ? "All" : STATION_TYPE_LABEL[t]}
                <span className={cx("num text-[11px]", filter === t ? "text-accent-ink" : "text-faint")}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {unpaid.length > 0 && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-over blink" /> Ended, not paid
              <span className="num rounded-full bg-over/10 px-1.5 text-xs text-over">{unpaid.length}</span>
            </span>
          }
          flush
        >
          <ul className="divide-y divide-line">
            {unpaid.map((s) => {
              const st = stations.find((x) => x.id === s.station_id);
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{st?.name ?? "Station"}</span>
                  {s.customer_name && <span className="text-muted">{s.customer_name}</span>}
                  <span className="num ml-auto font-semibold">{formatINR(s.outstanding)}</span>
                  <Button size="sm" onClick={() => setCheckoutIds([s.id])}>
                    Collect
                  </Button>
                </li>
              );
            })}
          </ul>
          {unpaid.length > 1 && (
            <div className="border-t border-line px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => setCheckoutIds(unpaid.map((s) => s.id))}>
                Bill all together
              </Button>
            </div>
          )}
        </Panel>
      )}

      {view === "map" &&
        (editingLayout ? (
          <LayoutEditor
            stations={stations}
            infos={infos}
            initial={placements}
            onCancel={() => setEditingLayout(false)}
            onSave={async (next) => {
              const { error } = await supabase.rpc("save_station_layout", {
                p_branch_id: branch.id,
                p_layout: Object.entries(next).map(([id, p]) => ({ id, x: p.x, y: p.y, rot: p.rot })),
              });
              if (error) return error.message;
              setPlacements(next);
              setEditingLayout(false);
              return null;
            }}
          />
        ) : (
          <FloorMap
            stations={stations}
            infos={infos}
            placements={placements}
            editing={false}
            onSelect={setSelectedId}
          />
        ))}

      {/* Station grid */}
      {view === "grid" && visibleTypes.map((type) => (
        <section key={type}>
          {filter === "all" && (
            <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {STATION_TYPE_LABEL[type]}
              <span className="h-px flex-1 bg-line" />
            </h2>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {tiles
              .filter((t) => t.station.type === type)
              .map(({ station, session, info }) => (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => setSelectedId(station.id)}
                  className={cx(
                    "group relative flex min-h-[116px] flex-col overflow-hidden rounded-xl border bg-panel p-3 pt-3.5 text-left shadow-xs transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-card active:translate-y-0",
                    TILE_STYLE[info.state],
                  )}
                >
                  <span aria-hidden className={cx("absolute inset-x-0 top-0 h-[3px]", EDGE[info.state])} />
                  <div className="flex items-center gap-2">
                    <span className={cx("size-2 shrink-0 rounded-full", DOT[info.state])} />
                    <span className="truncate text-sm font-semibold tracking-tight">{station.name}</span>
                    {station.tier !== "standard" && (
                      <span className="ml-auto shrink-0 rounded-md bg-subtle px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {station.tier}
                      </span>
                    )}
                  </div>

                  {info.state === "free" || info.state === "off" ? (
                    <span className={cx("mt-auto flex items-center justify-between text-[13px] font-medium capitalize", STATE_TEXT[info.state])}>
                      {info.clockLabel}
                      {info.state === "free" && (
                        <span className="text-xs font-medium normal-case text-faint opacity-0 transition-opacity group-hover:opacity-100">
                          Start →
                        </span>
                      )}
                    </span>
                  ) : (
                    <div className="mt-auto">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cx("num text-[24px] font-semibold leading-none tracking-tight", STATE_TEXT[info.state])}>
                          {info.clock}
                        </span>
                        {info.state === "paused" && <Pause className="size-3.5 text-paused" />}
                      </div>
                      {session?.mode === "prepaid" && session.prepaid_minutes > 0 && info.remaining !== null && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
                          <div
                            className={cx("h-full rounded-full", DOT[info.state].replace(" blink", ""))}
                            style={{
                              width: `${Math.min(100, Math.max(0, 100 - (info.remaining / (session.prepaid_minutes * 60)) * 100))}%`,
                            }}
                          />
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">
                          {session?.customer_name || (session?.mode === "prepaid" ? info.clockLabel : "Open time")}
                        </span>
                        <span className="num shrink-0 font-medium text-fg">{formatINR(info.charge?.total ?? 0)}</span>
                      </div>
                    </div>
                  )}
                </button>
              ))}
          </div>
        </section>
      ))}

      {selected && (
        <StationSheet
          open={Boolean(selected)}
          onOpenChange={(o) => !o && setSelectedId(null)}
          station={selected.station}
          session={selected.session}
          info={selected.info}
          data={initial}
          nowMs={now}
          freeStations={tiles
            .filter((t) => t.info.state === "free" && t.station.type === selected.station.type)
            .map((t) => t.station)}
          supabase={supabase}
          onChanged={refetch}
          onMoved={(toId) => setSelectedId(toId)}
          onCheckout={(ids) => {
            setSelectedId(null);
            setCheckoutIds(ids);
          }}
        />
      )}

      {checkoutIds && (
        <CheckoutDialog
          open
          onOpenChange={(o) => !o && setCheckoutIds(null)}
          sessions={sessions.filter((s) => checkoutIds.includes(s.id))}
          stations={stations}
          plans={plans}
          settings={settings}
          canWriteOff={initial.role === "owner"}
          supabase={supabase}
          onDone={() => {
            setCheckoutIds(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function Count({
  dot,
  label,
  value,
  total,
  highlight = false,
  tone,
}: {
  dot: string;
  label: string;
  value: number;
  total?: number;
  highlight?: boolean;
  tone?: "ending" | "over";
}) {
  return (
    <div
      className={cx(
        "flex flex-col justify-center rounded-xl border bg-panel px-3.5 py-2.5 shadow-xs",
        highlight && tone === "ending" && "border-ending/40 bg-ending/8",
        highlight && tone === "over" && "border-over/40 bg-over/8",
        !highlight && "border-line",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className={cx("size-1.5 rounded-full", dot, highlight && tone === "over" && "blink")} />
        {label}
      </span>
      <span className="num text-lg font-semibold tracking-tight">
        {value}
        {total !== undefined && <span className="text-sm font-normal text-faint"> / {total}</span>}
      </span>
    </div>
  );
}
