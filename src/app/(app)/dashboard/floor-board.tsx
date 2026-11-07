"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  LayoutGrid,
  Map as MapIcon,
  Pause,
  PencilRuler,
  Play,
  WifiOff,
} from "lucide-react";
import { estimateCharge, prepaidRemainingSeconds, type Charge } from "@/lib/pricing";
import { STATION_TYPE_LABEL, STATION_TYPES, type StationType } from "@/lib/constants";
import { formatClock, formatINR, formatMinutes, formatTime } from "@/lib/format";
import { Empty, PageHeader, Panel } from "@/components/card";
import { Button, Segmented, buttonClass, cx } from "@/components/ui";
import { Modal } from "@/components/overlay";
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

// Tile look per state. Only states that need action get a tint; colour otherwise sits in the pill.
const TILE: Record<TileState, string> = {
  free: "border-line bg-panel hover:border-free/50",
  busy: "border-line bg-panel hover:border-line-strong",
  ending: "border-ending/40 bg-ending/[0.05]",
  over: "border-over/45 bg-over/[0.05]",
  paused: "border-dashed border-line-strong bg-panel",
  off: "border-dashed border-line bg-subtle/50 text-muted",
};

const PILL: Record<TileState, string> = {
  free: "bg-free/10 text-free",
  busy: "bg-busy/10 text-busy",
  ending: "bg-ending/12 text-ending",
  over: "bg-over/12 text-over",
  paused: "bg-subtle text-paused",
  off: "bg-subtle text-muted",
};

const STATE_LABEL: Record<TileState, string> = {
  free: "Free",
  busy: "In use",
  ending: "Ending soon",
  over: "Overtime",
  paused: "Paused",
  off: "Off",
};

const CLOCK: Record<TileState, string> = {
  free: "text-free",
  busy: "text-fg",
  ending: "text-ending",
  over: "text-over",
  paused: "text-paused",
  off: "text-muted",
};

const BAR: Record<TileState, string> = {
  free: "bg-free",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over",
  paused: "bg-paused",
  off: "bg-faint",
};

const DOT: Record<TileState, string> = {
  free: "bg-free",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over",
  paused: "bg-paused",
  off: "bg-faint",
};

type StatusFilter = "all" | "free" | "busy" | "ending" | "over" | "paused";

const STATUS_FILTERS: { key: StatusFilter; label: string; tone?: "ending" | "over" }[] = [
  { key: "all", label: "All" },
  { key: "free", label: "Free" },
  { key: "busy", label: "In use" },
  { key: "ending", label: "Ending soon", tone: "ending" },
  { key: "over", label: "Overtime", tone: "over" },
  { key: "paused", label: "Paused" },
];

type Tile = { station: FloorStation; session: LiveSession | undefined; info: TileInfo };

export function FloorBoard({ initial }: { initial: FloorData }) {
  const { branch, stations, plans, settings } = initial;
  const { sessions, connected, refetch, supabase } = useFloorSessions(branch.id, initial.sessions);
  const now = useServerClock(initial.serverNow);

  // ?station=<id> (from search) opens that station's panel, also when it changes later.
  const searchParams = useSearchParams();
  const stationParam = searchParams.get("station");
  const [selectedId, setSelectedId] = useState<string | null>(stationParam);
  const [seenParam, setSeenParam] = useState(stationParam);
  if (stationParam !== seenParam) {
    setSeenParam(stationParam);
    if (stationParam) setSelectedId(stationParam);
  }

  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<StationType | "all">("all");
  const [checkoutIds, setCheckoutIds] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);
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

  const tiles: Tile[] = stations.map((st) => {
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

  const count = (s: StatusFilter) => (s === "all" ? tiles.length : tiles.filter((t) => t.info.state === s).length);
  const typesPresent = STATION_TYPES.filter((t) => stations.some((s) => s.type === t));
  const typesWithoutPrice = typesPresent.filter((t) => !plans.some((p) => p.station_type === t && p.is_active));
  const visible = tiles.filter(
    (t) => (status === "all" || t.info.state === status) && (type === "all" || t.station.type === type),
  );
  const visibleTypes = typesPresent.filter((ty) => visible.some((t) => t.station.type === ty));

  const selected = tiles.find((t) => t.station.id === selectedId);
  const infos = Object.fromEntries(tiles.map((t) => [t.station.id, t.info]));
  const free = tiles.filter((t) => t.info.state === "free");
  const attention = [
    ...tiles.filter((t) => t.info.state === "over"),
    ...tiles.filter((t) => t.info.state === "ending"),
  ];
  const endingNext = tiles
    .filter((t) => t.session?.mode === "prepaid" && t.info.remaining !== null && t.info.remaining > 0 && t.session.status === "running")
    .sort((a, b) => (a.info.remaining ?? 0) - (b.info.remaining ?? 0))
    .slice(0, 5);

  if (stations.length === 0) {
    return (
      <>
        <PageHeader title="Floor" />
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
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Floor"
        description={[
          branch.name,
          `${stations.length} station${stations.length === 1 ? "" : "s"}`,
          initial.closingTime ? `open till ${formatClosing(initial.closingTime)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <span
              className={cx(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium",
                connected ? "border-line text-free" : "border-ending/40 bg-ending/10 text-ending",
              )}
            >
              <span className={cx("size-1.5 rounded-full", connected ? "bg-free" : "bg-ending blink")} />
              {connected ? "Live" : "Reconnecting"}
            </span>
            <Button
              variant="secondary"
              aria-label={muted ? "Turn alert sound on" : "Mute alert sound"}
              title={muted ? "Alert sound off" : "Alert sound on"}
              onClick={() => setMuted(!muted)}
              className="w-9 px-0"
            >
              {muted ? <BellOff /> : <Bell />}
            </Button>
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
            {view === "map" && canEditLayout && !editingLayout && (
              <Button variant="secondary" onClick={() => setEditingLayout(true)}>
                <PencilRuler /> Edit layout
              </Button>
            )}
            <Button onClick={() => setPicking(true)} disabled={free.length === 0}>
              <Play /> Start session
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

      {/* One status bar that is also the filter. */}
      {view === "grid" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-1.5 shadow-xs">
          <div role="radiogroup" aria-label="Show stations" className="flex flex-1 flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => {
              const n = count(f.key);
              const on = status === f.key;
              if (f.key !== "all" && f.key !== "free" && f.key !== "busy" && n === 0) return null;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStatus(f.key)}
                  className={cx(
                    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                    on
                      ? "bg-accent text-accent-fg"
                      : f.tone === "over"
                        ? "bg-over/10 text-over hover:bg-over/15"
                        : f.tone === "ending"
                          ? "bg-ending/10 text-ending hover:bg-ending/15"
                          : "text-fg hover:bg-hover",
                  )}
                >
                  {f.key !== "all" && <span className={cx("size-2 rounded-full", DOT[f.key as TileState])} />}
                  {f.label}
                  <span className={cx("num text-xs", on ? "opacity-70" : "text-muted")}>{n}</span>
                </button>
              );
            })}
          </div>
          {typesPresent.length > 1 && (
            <select
              aria-label="Station type"
              value={type}
              onChange={(e) => setType(e.target.value as StationType | "all")}
              className="h-9 rounded-lg border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-accent"
            >
              <option value="all">All types</option>
              {typesPresent.map((t) => (
                <option key={t} value={t}>
                  {STATION_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Stations */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
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
              <FloorMap stations={stations} infos={infos} placements={placements} editing={false} onSelect={setSelectedId} />
            ))}

          {view === "grid" &&
            (visible.length === 0 ? (
              <Panel>
                <Empty icon={<LayoutGrid />} title="No stations match">
                  <button type="button" className="underline underline-offset-4" onClick={() => setStatus("all")}>
                    Show all stations
                  </button>
                </Empty>
              </Panel>
            ) : (
              visibleTypes.map((ty) => {
                const ofType = tiles.filter((t) => t.station.type === ty);
                const inUse = ofType.filter((t) => t.session).length;
                return (
                  <section key={ty}>
                    <h2 className="mb-2.5 flex items-center gap-2.5 text-xs font-semibold text-muted">
                      {STATION_TYPE_LABEL[ty]}
                      <span className="num font-medium text-faint">
                        {inUse} of {ofType.length} in use
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </h2>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
                      {visible
                        .filter((t) => t.station.type === ty)
                        .map((t) => (
                          <StationTile key={t.station.id} tile={t} onOpen={() => setSelectedId(t.station.id)} />
                        ))}
                    </div>
                  </section>
                );
              })
            ))}
        </div>

        {/* What to do next. On phones it comes first. */}
        <aside aria-label="Needs attention" className="order-first flex w-full flex-col gap-3.5 lg:order-none lg:w-[340px] lg:shrink-0">
          <AttentionPanel
            attention={attention}
            unpaid={unpaid}
            stations={stations}
            supabase={supabase}
            onChanged={refetch}
            onCheckout={setCheckoutIds}
          />

          {endingNext.length > 0 && (
            <section className="hidden rounded-2xl border border-line bg-panel shadow-xs lg:block">
              <header className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">Ending next</h2>
                <p className="mt-0.5 text-xs text-muted">Fixed-time sessions, soonest first</p>
              </header>
              <ol className="px-4 py-1.5">
                {endingNext.map((t) => (
                  <li key={t.station.id} className="border-b border-line/60 last:border-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.station.id)}
                      className="flex w-full items-center gap-2.5 py-2 text-left text-sm"
                    >
                      <span className="num w-16 text-xs text-muted">
                        {t.session?.planned_end_at ? formatTime(t.session.planned_end_at, branch.timezone) : "—"}
                      </span>
                      <span className="font-medium">{t.station.name}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{t.session?.customer_name}</span>
                      <span className={cx("num text-[13px]", t.info.state === "ending" ? "text-ending" : "")}>
                        {t.info.clock}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {free.length > 0 && (
            <section className="hidden rounded-2xl border border-line bg-panel p-4 shadow-xs lg:block">
              <h2 className="text-sm font-semibold">Free now</h2>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {free.map((t) => (
                  <button
                    key={t.station.id}
                    type="button"
                    onClick={() => setSelectedId(t.station.id)}
                    className="h-8 rounded-lg border border-free/30 bg-free/8 px-2.5 text-[13px] font-semibold text-free transition-colors hover:bg-free/15"
                  >
                    {t.station.name}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-muted">Tap one to start a session there.</p>
            </section>
          )}
        </aside>
      </div>

      <Modal open={picking} onOpenChange={setPicking} title="Start a session" description="Pick a free station.">
        <div className="flex flex-col gap-4">
          {typesPresent.map((ty) => {
            const list = free.filter((t) => t.station.type === ty);
            if (!list.length) return null;
            return (
              <div key={ty}>
                <p className="mb-2 text-xs font-semibold text-muted">{STATION_TYPE_LABEL[ty]}</p>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((t) => (
                    <button
                      key={t.station.id}
                      type="button"
                      onClick={() => {
                        setPicking(false);
                        setSelectedId(t.station.id);
                      }}
                      className="h-11 rounded-lg border border-line-strong text-sm font-semibold transition-colors hover:border-accent hover:bg-accent-soft"
                    >
                      {t.station.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

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

function StationTile({ tile, onOpen }: { tile: Tile; onOpen: () => void }) {
  const { station, session, info } = tile;
  const prepaid = session?.mode === "prepaid" && session.prepaid_minutes > 0 && info.remaining !== null;
  const done = prepaid ? Math.min(100, Math.max(0, 100 - (info.remaining! / (session!.prepaid_minutes * 60)) * 100)) : 0;
  const idle = info.state === "free" || info.state === "off";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "flex min-h-[132px] flex-col gap-2.5 rounded-2xl border p-3.5 text-left shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-card",
        TILE[info.state],
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold tracking-tight">{station.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {station.tier !== "standard" && (
            <span className="rounded-md bg-subtle px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">
              {station.tier}
            </span>
          )}
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", PILL[info.state])}>
            {info.state === "off" ? (station.status === "maintenance" ? "Maintenance" : "Disabled") : STATE_LABEL[info.state]}
          </span>
        </span>
      </span>

      {!idle && (
        <span className={cx("num flex items-baseline justify-between text-[28px] font-semibold leading-none tracking-tight", CLOCK[info.state])}>
          {info.clock}
          {info.state === "paused" && <Pause className="size-4" />}
        </span>
      )}
      {prepaid && (
        <span className="block h-1 overflow-hidden rounded-full bg-subtle">
          <span className={cx("block h-full rounded-full", BAR[info.state])} style={{ width: `${done}%` }} />
        </span>
      )}

      <span className="mt-auto flex items-center justify-between gap-2 text-xs text-muted">
        {idle ? (
          <span className={info.state === "free" ? "font-medium text-free" : ""}>
            {info.state === "free" ? "Ready · tap to start" : "Not available"}
          </span>
        ) : (
          <>
            <span className="truncate">
              {[
                session?.customer_name,
                session?.mode === "prepaid" ? `${formatMinutes(session.prepaid_minutes)} booked` : "open time",
                session && session.players > 1 ? `${session.players} players` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="num shrink-0 font-semibold text-fg">{formatINR(info.charge?.total ?? 0)}</span>
          </>
        )}
      </span>
    </button>
  );
}

// Overtime and ending-soon sessions, plus ended-but-unpaid ones, with the action each needs.
function AttentionPanel({
  attention,
  unpaid,
  stations,
  supabase,
  onChanged,
  onCheckout,
}: {
  attention: Tile[];
  unpaid: LiveSession[];
  stations: FloorStation[];
  supabase: ReturnType<typeof useFloorSessions>["supabase"];
  onChanged: () => Promise<void>;
  onCheckout: (ids: string[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const extend = (sessionId: string, minutes: number) =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await supabase.rpc("extend_session", { p_session_id: sessionId, p_minutes: minutes, p_payments: [] });
      if (error) return setError(error.message);
      await onChanged();
    });

  // Two taps, like the station panel: the first arms the button for a few seconds.
  const end = (sessionId: string) => {
    if (armed !== sessionId) return setArmed(sessionId);
    setArmed(null);
    startTransition(async () => {
      setError(undefined);
      const { data, error } = await supabase.rpc("end_session", { p_session_id: sessionId });
      if (error) return setError(error.message);
      await onChanged();
      if (Number((data as { outstanding?: number } | null)?.outstanding ?? 0) > 0) onCheckout([sessionId]);
    });
  };

  const total = attention.length + unpaid.length;
  if (total === 0) {
    return (
      <section className="hidden items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 shadow-xs lg:flex">
        <CheckCircle2 className="size-5 text-free" />
        <div>
          <h2 className="text-sm font-semibold">All clear</h2>
          <p className="text-xs text-muted">No overtime, nothing ending soon, nothing unpaid.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-xs">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <span className="num rounded-full bg-over/10 px-1.5 text-xs text-over">{total}</span>
      </header>
      <ul>
        {attention.map(({ station, session, info }) => (
          <li key={station.id} className="flex flex-col gap-2 border-b border-line/60 px-4 py-3 last:border-0">
            <span className="flex items-center gap-2 text-sm">
              <span className={cx("size-2 shrink-0 rounded-full", DOT[info.state])} />
              <span className="font-semibold">{station.name}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                {session?.customer_name ?? ""} · {info.state === "over" ? "over booking" : "ending soon"}
              </span>
              <span className={cx("num font-semibold", CLOCK[info.state])}>{info.clock}</span>
            </span>
            {session && (
              <span className="grid grid-cols-2 gap-1.5">
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => extend(session.id, 30)}>
                  +30 min
                </Button>
                {info.state === "over" ? (
                  <Button
                    size="sm"
                    variant={armed === session.id ? "danger" : "primary"}
                    disabled={pending}
                    onClick={() => end(session.id)}
                  >
                    {armed === session.id ? "Tap again to end" : "End and bill"}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => extend(session.id, 60)}>
                    +1 hour
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
        {unpaid.map((s) => (
          <li key={s.id} className="flex items-center gap-2 border-b border-line/60 px-4 py-3 text-sm last:border-0">
            <span className="size-2 shrink-0 rounded-full bg-over" />
            <span className="font-semibold">{stations.find((x) => x.id === s.station_id)?.name ?? "Station"}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              {s.customer_name ? `${s.customer_name} · ` : ""}ended, not paid
            </span>
            <span className="num font-semibold">{formatINR(s.outstanding)}</span>
            <Button size="sm" onClick={() => onCheckout([s.id])}>
              Collect
            </Button>
          </li>
        ))}
      </ul>
      {unpaid.length > 1 && (
        <div className="border-t border-line px-4 py-2.5">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => onCheckout(unpaid.map((s) => s.id))}>
            Bill all {unpaid.length} together
          </Button>
        </div>
      )}
      {error && <p className="border-t border-line px-4 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

// "23:30:00" → "11:30 pm".
function formatClosing(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${suffix}`;
}
