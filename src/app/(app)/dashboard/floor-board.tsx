"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, LayoutGrid, Map as MapIcon, Pause, PencilRuler, WifiOff } from "lucide-react";
import { estimateCharge, prepaidRemainingSeconds, type Charge } from "@/lib/pricing";
import { STATION_TYPE_LABEL, STATION_TYPES, type StationType } from "@/lib/constants";
import { formatClock, formatINR } from "@/lib/format";
import { Empty, Panel } from "@/components/card";
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
  free: "border-line hover:border-free/60",
  busy: "border-busy/45 bg-busy/[0.04]",
  ending: "border-ending/60 bg-ending/[0.06]",
  over: "border-over/70 bg-over/[0.07]",
  paused: "border-dashed border-line-strong",
  off: "border-dashed border-line opacity-55",
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
      {!connected && (
        <div className="flex items-center gap-2 rounded-md border border-ending/50 bg-ending/10 px-3 py-2 text-sm text-ending">
          <WifiOff className="size-4" />
          Internet down. Reconnecting… Timers keep running; changes sync when you&apos;re back.
        </div>
      )}
      {typesWithoutPrice.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm">
          <AlertTriangle className="size-4 text-ending" />
          No price set for {typesWithoutPrice.map((t) => STATION_TYPE_LABEL[t]).join(", ")}. Sessions can&apos;t start
          there yet.
          <Link href="/pricing" className="ml-auto font-medium underline underline-offset-4">
            Set prices
          </Link>
        </div>
      )}

      {/* Status strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Count dot="bg-free" label="Free" value={counts.free} />
          <Count dot="bg-busy" label="In use" value={counts.busy} />
          <Count dot="bg-ending" label="Ending" value={counts.ending} />
          <Count dot="bg-over" label="Overtime" value={counts.over} />
          <span className="text-muted">
            Running <span className="num font-medium text-fg">{formatINR(runningTotal)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <div className={cx("flex max-w-[calc(100vw-80px)] gap-1 overflow-x-auto", view === "map" && "hidden")}>
            {(["all", ...typesPresent] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={cx(
                  "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium",
                  filter === t ? "bg-invert text-invert-fg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                {t === "all" ? "All" : STATION_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={muted ? "Unmute alerts" : "Mute alerts"}
            title={muted ? "Alerts muted" : "Alert sound on"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <BellOff /> : <Bell />}
          </Button>
        </div>
      </div>

      {unpaid.length > 0 && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-over" /> Ended, not paid
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
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              {STATION_TYPE_LABEL[type]}
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
                    "group flex min-h-[104px] flex-col rounded-lg border bg-panel p-3 text-left transition-colors",
                    TILE_STYLE[info.state],
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cx("size-2 shrink-0 rounded-full", DOT[info.state])} />
                    <span className="truncate text-sm font-semibold">{station.name}</span>
                    {station.tier !== "standard" && (
                      <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {station.tier}
                      </span>
                    )}
                  </div>

                  {info.state === "free" || info.state === "off" ? (
                    <span className={cx("mt-auto text-[13px] capitalize", STATE_TEXT[info.state])}>
                      {info.clockLabel}
                    </span>
                  ) : (
                    <div className="mt-auto">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cx("num text-[22px] font-semibold leading-none", STATE_TEXT[info.state])}>
                          {info.clock}
                        </span>
                        {info.state === "paused" && <Pause className="size-3.5 text-paused" />}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">
                          {session?.customer_name || (session?.mode === "prepaid" ? info.clockLabel : "Open time")}
                        </span>
                        <span className="num shrink-0 text-fg">{formatINR(info.charge?.total ?? 0)}</span>
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

function Count({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("size-1.5 rounded-full", dot)} />
      <span className="text-muted">{label}</span>
      <span className="num font-medium">{value}</span>
    </span>
  );
}
