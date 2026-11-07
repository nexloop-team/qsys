"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, LayoutGrid, Map as MapIcon, MonitorOff, Pause, PencilRuler, Play, ShoppingBag, WifiOff } from "lucide-react";
import { isOnline } from "@/lib/devices";
import { estimateCharge, prepaidRemainingSeconds, type Charge } from "@/lib/pricing";
import { STATION_TYPE_LABEL, STATION_TYPES, type StationType } from "@/lib/constants";
import { formatClock, formatINR } from "@/lib/format";
import { Empty, PageHeader, Panel } from "@/components/card";
import { Button, Segmented, buttonClass, cx } from "@/components/ui";
import { useDevices, useFloorSessions, useLocalPref, useMuted, useServerClock } from "./use-floor";
import { FloorMap, LayoutEditor, initialPlacements } from "./floor-map";
import { StationSheet } from "./station-sheet";
import { CheckoutDialog } from "./checkout-dialog";
import { QuickSaleDialog } from "./quick-sale-dialog";
import {
  ENDING_SOON_SECONDS,
  type FloorData,
  type FloorPlan,
  type FloorStation,
  type LiveSession,
  type TileState,
} from "./types";
import { friendlyError } from "@/lib/errors";

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

  const timeCharge = plan
    ? estimateCharge(
        { ...session, pauses: session.session_pauses },
        plan,
        plan.rate_rules,
        { timeZone, graceMinutes, earlyEndPolicy, nowMs, cache },
      )
    : null;
  // While a session is live, charge_amount holds the snacks added so far (time is fixed at the end).
  const snacks = Number(session.charge_amount ?? 0);
  const charge = timeCharge ? { ...timeCharge, total: timeCharge.total + snacks } : null;

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

// White tiles; colour lives only in the dot, the top edge and (when it matters) the clock.
const TILE_STYLE: Record<TileState, string> = {
  free: "border-line hover:border-line-strong",
  busy: "border-line hover:border-line-strong",
  ending: "border-ending/40",
  over: "border-over/45",
  paused: "border-dashed border-line-strong",
  off: "border-dashed border-line opacity-55",
};

// Top edge colour per state, so a glance across the floor reads at once.
const EDGE: Record<TileState, string> = {
  free: "bg-transparent",
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
  busy: "text-fg",
  ending: "text-ending",
  over: "text-over",
  paused: "text-paused",
  off: "text-faint",
};

export function FloorBoard({ initial }: { initial: FloorData }) {
  const { branch, stations, plans, settings } = initial;
  const { sessions, connected, refetch, supabase } = useFloorSessions(branch.id, initial.sessions);
  const now = useServerClock(initial.serverNow, supabase);
  const { devices, refetchDevices } = useDevices(
    supabase,
    branch.id,
    initial.devices,
    stations.some((s) => s.type === "pc"),
  );
  const deviceByStation = useMemo(() => new Map(devices.map((d) => [d.station_id, d])), [devices]);

  const [filter, setFilter] = useState<StationType | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkoutIds, setCheckoutIds] = useState<string[] | null>(null);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [muted, setMuted] = useMuted();
  const [view, setView] = useLocalPref<"grid" | "map">("qs_floor_view", "grid");
  const [editingLayout, setEditingLayout] = useState(false);
  const [placements, setPlacements] = useState(() => initialPlacements(stations));
  const [batchPending, setBatchPending] = useState(false);
  const canEditLayout = initial.role === "owner";

  const runningSessions = sessions.filter((s) => s.status === "running");
  const pausedSessions = sessions.filter((s) => s.status === "paused");

  const [batchError, setBatchError] = useState<string | null>(null);

  // Pause / resume every session at once (e.g. a power cut). Each call stands alone, so one
  // failure doesn't stop the rest; failures are counted and shown.
  const runBatch = async (list: LiveSession[], fn: "pause_session" | "resume_session") => {
    if (!list.length || batchPending) return;
    setBatchPending(true);
    setBatchError(null);
    try {
      const results = await Promise.allSettled(list.map((s) => supabase.rpc(fn, { p_session_id: s.id })));
      const failed = results.filter((r) => r.status === "rejected" || r.value.error).length;
      if (failed) {
        setBatchError(
          `${failed} of ${list.length} couldn't be ${fn === "pause_session" ? "paused" : "resumed"}. Check the internet and try again.`,
        );
      }
    } finally {
      await refetch();
      setBatchPending(false);
    }
  };
  const pauseAll = () => runBatch(runningSessions, "pause_session");
  const resumeAll = () => runBatch(pausedSessions, "resume_session");

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

  // The time's-up sound and toast come from TimeUpWatcher in the app layout (every page, not
  // only this one); the mute button here controls it.

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
                "inline-flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium",
                connected ? "text-muted" : "text-ending",
              )}
            >
              <span className={cx("size-1.5 rounded-full", connected ? "bg-free" : "bg-ending blink")} />
              {connected ? "Live" : "Reconnecting"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setQuickSaleOpen(true)}
              title="Sell snacks & drinks to walk-in or waiting customers"
              className="gap-1.5"
            >
              <ShoppingBag className="size-3.5" /> Quick Sale
            </Button>
            {pausedSessions.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={resumeAll}
                disabled={batchPending}
                title="Resume all paused sessions"
              >
                <Play /> Resume all ({pausedSessions.length})
              </Button>
            )}
            {runningSessions.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={pauseAll}
                disabled={batchPending}
                title="Pause all running sessions (e.g. power cut)"
              >
                <Pause /> Pause all ({runningSessions.length})
              </Button>
            )}
            {view === "map" && canEditLayout && !editingLayout && (
              <span className="hidden sm:contents">
                <Button size="sm" variant="secondary" onClick={() => setEditingLayout(true)}>
                  <PencilRuler /> Edit layout
                </Button>
              </span>
            )}
            {/* The map needs width: phones always get the grid. */}
            <span className="hidden sm:contents">
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
            </span>
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
      {batchError && (
        <div className="flex items-center gap-2 rounded-xl border border-over/30 bg-over/8 px-3.5 py-2.5 text-sm text-over">
          <AlertTriangle className="size-4 shrink-0" />
          {batchError}
          <button type="button" className="ml-auto text-xs font-medium underline" onClick={() => setBatchError(null)}>
            Dismiss
          </button>
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

      {/* At a glance: one line. Ending / overtime only show when there is something to act on. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <Count dot="bg-free" label="free" value={counts.free} />
        <Count dot="bg-busy" label="in use" value={counts.busy} />
        {counts.ending > 0 && <Count dot="bg-ending" label="ending soon" value={counts.ending} tone="ending" />}
        {counts.over > 0 && <Count dot="bg-over blink" label="overtime" value={counts.over} tone="over" />}
        {runningTotal > 0 && (
          <span className="ml-auto text-muted">
            Running <span className="num font-semibold text-fg">{formatINR(runningTotal)}</span>
          </span>
        )}
      </div>

      {typesPresent.length > 1 && (
        <div className={cx("-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0", view !== "grid" && "sm:hidden")}>
          {(["all", ...typesPresent] as const).map((t) => {
            const n = t === "all" ? tiles.length : tiles.filter((x) => x.station.type === t).length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                aria-pressed={filter === t}
                className={cx(
                  "inline-flex h-8 pointer-coarse:h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 pointer-coarse:px-3.5 text-xs pointer-coarse:text-[13px] font-medium transition-colors",
                  filter === t
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line bg-panel text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t === "all" ? "All" : STATION_TYPE_LABEL[t]}
                <span className="num text-[11px] opacity-70">{n}</span>
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

      {view === "map" && (
        <div className="hidden sm:block">
        {editingLayout ? (
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
              if (error) return friendlyError(error);
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
        )}
        </div>
      )}

      {/* Station grid */}
      {visibleTypes.map((type) => (
        <section key={type} className={cx(view !== "grid" && "sm:hidden")}>
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
                    "group relative flex min-h-[116px] flex-col overflow-hidden rounded-xl border bg-panel p-3 pt-3.5 text-left transition-colors active:bg-subtle",
                    TILE_STYLE[info.state],
                  )}
                >
                  <span aria-hidden className={cx("absolute inset-x-0 top-0 h-[3px]", EDGE[info.state])} />
                  <div className="flex items-center gap-2">
                    <span className={cx("size-2 shrink-0 rounded-full", DOT[info.state])} />
                    <span className="truncate text-sm font-semibold tracking-tight">{station.name}</span>
                    {deviceByStation.has(station.id) && !isOnline(deviceByStation.get(station.id), now) && (
                      <MonitorOff className="size-3.5 shrink-0 text-faint" aria-label="PC app offline" />
                    )}
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
                        // Always visible on touch screens; fades in on hover with a mouse.
                        <span className="text-xs font-medium normal-case text-muted [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-hover:opacity-100">
                          Start
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
          device={deviceByStation.get(selected.station.id)}
          deviceOnline={isOnline(deviceByStation.get(selected.station.id), now)}
          onDeviceCommand={() => void refetchDevices()}
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
          venueName={initial.orgName}
          supabase={supabase}
          onDone={() => {
            setCheckoutIds(null);
            void refetch();
          }}
        />
      )}

      <QuickSaleDialog
        open={quickSaleOpen}
        onOpenChange={setQuickSaleOpen}
        branchId={branch.id}
        branchName={branch.name}
        supabase={supabase}
        gst={{ enabled: settings.gstEnabled, rate: settings.gstRate, inclusive: settings.pricesIncludeTax }}
        discountLimit={initial.role === "owner" ? null : settings.staffMaxDiscountPct}
        onDone={() => void refetch()}
      />
    </div>
  );
}

function Count({
  dot,
  label,
  value,
  tone,
}: {
  dot: string;
  label: string;
  value: number;
  tone?: "ending" | "over";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5",
        tone === "ending" && "font-medium text-ending",
        tone === "over" && "font-medium text-over",
        !tone && "text-muted",
      )}
    >
      <span className={cx("size-2 rounded-full", dot)} />
      <span className={cx("num font-semibold", !tone && "text-fg")}>{value}</span>
      {label}
    </span>
  );
}
