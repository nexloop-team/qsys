"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRightLeft, Coffee, Pause, Play, Plus, Square, Users } from "lucide-react";
import type { Database } from "@/lib/database.types";
import {
  FRAME_TYPES,
  MULTIPLAYER_TYPES,
  SESSION_MODE_HINT,
  SESSION_MODE_LABEL,
  STATION_TYPE_LABEL,
  playersWord,
  type SessionMode,
  type StationType,
} from "@/lib/constants";
import { formatINR, formatMinutes, formatTime } from "@/lib/format";
import { planChoices, playerExtra, priceFor } from "@/lib/pricing";
import { computeBill } from "@/lib/bill";
import { Sheet, StickyActions } from "@/components/overlay";
import { Badge } from "@/components/card";
import { Button, ErrorText, Field, Input, Segmented, Select, Toggle, cx } from "@/components/ui";
import { PaymentFields, type PaymentRow } from "./payment-fields";
import { PlayerField, type PlayerValue } from "./player-field";
import { SessionSnacksForm } from "./session-snacks";
import { PcControls } from "./pc-controls";
import type { DeviceStatus } from "@/lib/devices";
import type { TileInfo } from "./floor-board";
import type { FloorData, FloorPackage, FloorPlan, FloorStation, LiveSession } from "./types";
import { friendlyError } from "@/lib/errors";

type Supa = SupabaseClient<Database>;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "₹200/hr" or, with choices, "₹200–₹300/hr by players"; plus the frame price when there is one.
function planSummary(plan: FloorPlan, type: StationType) {
  const choices = MULTIPLAYER_TYPES.has(type) ? planChoices(plan) : [];
  const hourly =
    choices.length > 1
      ? `${formatINR(choices[0].per_hour)}–${formatINR(choices[choices.length - 1].per_hour)}/hr by ${playersWord(type)}`
      : `${formatINR(plan.per_hour)}/hr`;
  const frame = plan.per_frame != null && FRAME_TYPES.has(type) ? ` · ${formatINR(plan.per_frame)}/frame` : "";
  return `${hourly}${frame}${plan.rate_rules.length ? " · time-based rates apply" : ""}`;
}

export function StationSheet({
  open,
  onOpenChange,
  station,
  session,
  info,
  data,
  nowMs,
  freeStations,
  supabase,
  onChanged,
  onCheckout,
  onMoved,
  device,
  deviceOnline,
  onDeviceCommand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: FloorStation;
  session: LiveSession | undefined;
  info: TileInfo;
  data: FloorData;
  nowMs: number;
  freeStations: FloorStation[];
  supabase: Supa;
  onChanged: () => Promise<void>;
  onCheckout: (sessionIds: string[]) => void;
  /** The session moved to another station: follow it there. */
  onMoved: (stationId: string) => void;
  /** PC stations: the paired PC app, if any. */
  device: DeviceStatus | undefined;
  deviceOnline: boolean;
  onDeviceCommand: () => void;
}) {
  const plan = useMemo(() => resolvePlan(data.plans, station, session), [data.plans, station, session]);
  const packages = data.packages.filter(
    (p) => p.station_type === station.type && (p.tier === null || p.tier === station.tier),
  );
  // Shown above the main button, so the button can stay pinned at the bottom.
  const pc =
    station.type === "pc" ? (
      <PcControls
        stationId={station.id}
        stationName={station.name}
        device={device}
        online={deviceOnline}
        nowMs={nowMs}
        sessionLive={Boolean(session && session.status !== "ended")}
        isOwner={data.role === "owner"}
        supabase={supabase}
        onSent={onDeviceCommand}
      />
    ) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          {station.name}
          <Badge>{STATION_TYPE_LABEL[station.type]}</Badge>
          {station.tier !== "standard" && <Badge>{station.tier}</Badge>}
        </span>
      }
      description={plan ? planSummary(plan, station.type) : "No price set"}
    >
      <>
        {station.status !== "active" && !session ? (
          <>
            <p className="text-sm text-muted">
              This station is in <strong className="text-fg">{station.status}</strong>. Change it under Stations to use it.
            </p>
            {pc}
          </>
        ) : !plan ? (
          <>
            <p className="text-sm text-muted">Set a price for {STATION_TYPE_LABEL[station.type]} under Pricing first.</p>
            {pc}
          </>
        ) : session ? (
          <LiveView
            station={station}
            session={session}
            info={info}
            plan={plan}
            packages={packages}
            data={data}
            nowMs={nowMs}
            freeStations={freeStations.filter((s) => s.id !== station.id)}
            supabase={supabase}
            onChanged={onChanged}
            onCheckout={onCheckout}
            onMoved={onMoved}
            onClose={() => onOpenChange(false)}
            extra={pc}
          />
        ) : (
          <StartForm
            station={station}
            plan={plan}
            packages={packages}
            data={data}
            supabase={supabase}
            onStarted={async () => {
              await onChanged();
              onOpenChange(false);
            }}
            extra={pc}
          />
        )}
      </>
    </Sheet>
  );
}

function resolvePlan(plans: FloorPlan[], station: FloorStation, session?: LiveSession) {
  if (session) return plans.find((p) => p.id === session.rate_plan_id);
  const candidates = plans.filter(
    (p) => p.is_active && p.station_type === station.type && (p.tier === station.tier || p.tier === null),
  );
  return candidates.find((p) => p.tier === station.tier) ?? candidates[0];
}

function gstRateFor(plan: FloorPlan, data: FloorData) {
  return plan.gst_rate_override ?? data.settings.gstRate;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function StartForm({
  station,
  plan,
  packages,
  data,
  supabase,
  onStarted,
  extra,
}: {
  station: FloorStation;
  plan: FloorPlan;
  packages: FloorPackage[];
  data: FloorData;
  supabase: Supa;
  onStarted: () => Promise<void>;
  extra?: React.ReactNode;
}) {
  // Frames only where the venue allows it and this rate has a frame price.
  const allowed = (data.settings.allowed[station.type] ?? ["open", "prepaid"]).filter(
    (m) => m !== "frames" || (FRAME_TYPES.has(station.type) && plan.per_frame != null),
  );
  if (allowed.length === 0) allowed.push("open");
  const [mode, setMode] = useState<SessionMode>(
    allowed.includes(data.settings.defaults[station.type]) ? data.settings.defaults[station.type] : allowed[0],
  );
  const choices = MULTIPLAYER_TYPES.has(station.type) ? planChoices(plan) : [];
  const [players, setPlayers] = useState(choices[0]?.players ?? 1);
  const [player, setPlayer] = useState<PlayerValue>({ phone: "", name: "", isNew: false, ready: false });
  const [choice, setChoice] = useState<string>(packages[0]?.id ?? "custom");
  const [customMinutes, setCustomMinutes] = useState("60");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [collectNow, setCollectNow] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const pkg = packages.find((p) => p.id === choice);
  const minutes = pkg ? pkg.minutes : Math.max(0, Math.floor(Number(customMinutes) || 0));
  const basePrice = pkg ? Number(pkg.price) : Math.round((Number(plan.per_hour) * minutes) / 60);
  // Plus what the player choice adds for that time (the database charges the same).
  const price = Math.max(Math.round(basePrice + (playerExtra(plan, players, "hour") * minutes) / 60), 0);
  const bill = computeBill([{ amount: price, gstRate: gstRateFor(plan, data) }], 0, {
    gstEnabled: data.settings.gstEnabled,
    pricesIncludeTax: data.settings.pricesIncludeTax,
  });

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await supabase.rpc("start_session", {
        p_station_id: station.id,
        p_mode: mode,
        p_phone: player.phone,
        p_name: player.isNew ? player.name : undefined,
        p_players: players,
        ...(mode === "prepaid"
          ? {
              p_package_id: pkg?.id,
              p_minutes: pkg ? undefined : minutes,
              p_payments: collectNow ? payments : [],
            }
          : {}),
      });
      if (error) return setError(friendlyError(error));
      await onStarted();
    });

  return (
    <div className="flex flex-col gap-5">
      <PlayerField orgId={data.orgId} supabase={supabase} onChange={setPlayer} />

      {allowed.length > 1 && (
        <Segmented
          value={mode}
          onChange={setMode}
          className="w-full"
          options={allowed.map((m) => ({ value: m, label: SESSION_MODE_LABEL[m] }))}
        />
      )}
      <p className="-mt-2 text-[13px] text-muted">
        {SESSION_MODE_HINT[mode]}
        {mode === "prepaid" &&
          (data.settings.earlyEndPolicy === "played"
            ? " Stops early? They pay only for the time played."
            : " Stops early? They still pay for the full booking.")}
      </p>

      {mode === "prepaid" && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">How long?</span>
          <div className="grid grid-cols-2 gap-2">
            {packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setChoice(p.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${choice === p.id ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-hover"}`}
              >
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="num text-[13px] text-muted">
                  {formatMinutes(p.minutes)} · {formatINR(p.price)}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setChoice("custom")}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${choice === "custom" ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-hover"}`}
            >
              <span className="block text-sm font-medium">Custom</span>
              <span className="text-[13px] text-muted">At {formatINR(plan.per_hour)}/hr</span>
            </button>
          </div>
          {choice === "custom" && (
            <Field label="Minutes">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      {MULTIPLAYER_TYPES.has(station.type) && (
        <PlayersPicker plan={plan} type={station.type} mode={mode} value={players} onChange={setPlayers} />
      )}

      {mode === "frames" && (
        <p className="-mt-2 text-[13px] text-muted">
          {formatINR(priceFor(plan, players, "frame"))} per frame. The first frame starts now.
        </p>
      )}

      {mode === "prepaid" && minutes > 0 && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Bill for {formatMinutes(minutes)}</span>
            <span className="num text-2xl font-semibold">{formatINR(bill.total)}</span>
          </div>
          <Toggle
            name="collect_now"
            checked={collectNow}
            onChange={setCollectNow}
            label="Collect payment now"
            description="Otherwise they pay at the end."
          />
          {collectNow && (
            <PaymentFields total={bill.total} onChange={setPayments} />
          )}
        </div>
      )}

      {extra}

      <StickyActions>
        <ErrorText>{error}</ErrorText>
        <Button
          size="lg"
          onClick={submit}
          disabled={pending || !player.ready || (mode === "prepaid" && minutes <= 0)}
          className="w-full"
        >
          <Play />
          {pending
            ? "Starting…"
            : mode === "prepaid" && collectNow
              ? `Collect ${formatINR(bill.total)} & start`
              : mode === "prepaid"
                ? `Start ${formatMinutes(minutes)}`
                : mode === "frames"
                  ? "Start frame 1"
                  : `Start ${station.name}`}
        </Button>
        {!player.ready && (
          <p className="mt-2 text-center text-xs text-muted">Pick a player, or add a new one with their mobile number.</p>
        )}
      </StickyActions>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running / paused session
// ---------------------------------------------------------------------------
function LiveView({
  station,
  session,
  info,
  plan,
  packages,
  data,
  nowMs,
  freeStations,
  supabase,
  onChanged,
  onCheckout,
  onMoved,
  onClose,
  extra,
}: {
  station: FloorStation;
  session: LiveSession;
  info: TileInfo;
  plan: FloorPlan;
  packages: FloorPackage[];
  data: FloorData;
  nowMs: number;
  freeStations: FloorStation[];
  supabase: Supa;
  onChanged: () => Promise<void>;
  onCheckout: (ids: string[]) => void;
  onMoved: (stationId: string) => void;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  const [panel, setPanel] = useState<"none" | "extend" | "transfer" | "snack">("none");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const tz = data.branch.timezone;

  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>) =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await fn();
      if (error) return setError(friendlyError(error));
      await onChanged();
    });

  // Ending is final, so it takes two taps: the first arms the button for a few seconds.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const end = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    startTransition(async () => {
      setError(undefined);
      const { data: charge, error } = await supabase.rpc("end_session", { p_session_id: session.id });
      if (error) return setError(friendlyError(error));
      await onChanged();
      const outstanding = Number((charge as { outstanding?: number } | null)?.outstanding ?? 0);
      // Something left to pay: go to checkout. Fully paid up front: nothing more to do here.
      if (outstanding > 0) onCheckout([session.id]);
      else onClose();
    });
  };

  void nowMs; // re-render each tick via parent

  return (
    <div className="flex flex-col gap-5">
      {/* The clock is the point of this panel: big, in the station's status colour. */}
      <div className={cx("flex flex-col gap-3 rounded-xl border p-4", CLOCK_BOX[info.state])}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cx("num text-[40px] font-semibold leading-none tracking-tight", CLOCK_TEXT[info.state])}>
            {info.clock ?? "0:00"}
          </span>
          <span className={cx("text-[13px] font-medium", CLOCK_TEXT[info.state])}>
            {info.clockLabel}
            {session.mode === "prepaid" && session.planned_end_at && session.status === "running"
              ? ` · ends ${formatTime(session.planned_end_at, tz)}`
              : ""}
          </span>
        </div>
        {session.mode === "prepaid" && session.prepaid_minutes > 0 && info.remaining !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div
              className={cx("h-full rounded-full", BAR[info.state])}
              style={{ width: `${Math.min(100, Math.max(0, 100 - (info.remaining / (session.prepaid_minutes * 60)) * 100))}%` }}
            />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Cell label="Started" value={formatTime(session.started_at, tz)} />
          {session.mode === "prepaid" ? (
            <Cell label="Booked" value={formatMinutes(session.prepaid_minutes)} />
          ) : session.mode === "frames" ? (
            <Cell label="Frames" value={String(session.frames)} />
          ) : (
            // Elapsed is the big clock; this is what the rounding rules bill for.
            <Cell label="Billed as" value={formatMinutes(info.charge?.billableMinutes ?? 0)} />
          )}
          <Cell label="Charge so far" value={formatINR(info.charge?.total ?? 0)} />
        </div>
      </div>

      {session.mode === "frames" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">Frames</p>
            <p className="num text-2xl font-semibold leading-tight">
              {session.frames}
              <span className="ml-1.5 text-sm font-normal text-muted">
                × {formatINR(priceFor(plan, session.players, "frame"))}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="lg"
              aria-label="Remove a frame"
              disabled={pending || session.frames <= 0}
              onClick={() => run(() => supabase.rpc("change_session_frames", { p_session_id: session.id, p_delta: -1 }))}
            >
              −
            </Button>
            <Button
              size="lg"
              disabled={pending}
              onClick={() => run(() => supabase.rpc("change_session_frames", { p_session_id: session.id, p_delta: 1 }))}
            >
              <Plus /> Frame
            </Button>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted">Mode</dt>
        <dd>
          {SESSION_MODE_LABEL[session.mode]}
          {session.mode === "prepaid" &&
            ` · ${formatMinutes(session.prepaid_minutes)} booked (${formatINR(session.prepaid_amount)})`}
          {session.mode === "frames" && ` · ${formatINR(priceFor(plan, session.players, "frame"))} per frame`}
        </dd>
        {session.customer_name && (
          <>
            <dt className="text-muted">Player</dt>
            <dd>
              {session.customer_name}
              {session.customer_phone && <span className="text-muted"> · {session.customer_phone}</span>}
            </dd>
          </>
        )}
        {!MULTIPLAYER_TYPES.has(station.type) && session.players > 1 && (
          <>
            <dt className="text-muted">Players</dt>
            <dd>{session.players}</dd>
          </>
        )}
        {session.status === "paused" && (
          <>
            <dt className="text-muted">Status</dt>
            <dd>Paused since {formatTime(session.paused_at!, tz)}. The clock is stopped.</dd>
          </>
        )}
      </dl>

      {MULTIPLAYER_TYPES.has(station.type) && (
        <PlayersPicker
          plan={plan}
          type={station.type}
          mode={session.mode}
          value={session.players}
          disabled={pending}
          live
          onChange={(n) => run(() => supabase.rpc("set_session_players", { p_session_id: session.id, p_players: n }))}
        />
      )}

      <ErrorText>{error}</ErrorText>

      <div className="grid grid-cols-2 gap-2">
        {session.status === "running" ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => supabase.rpc("pause_session", { p_session_id: session.id }))}>
            <Pause /> Pause
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => supabase.rpc("resume_session", { p_session_id: session.id }))}>
            <Play /> Resume
          </Button>
        )}
        {session.mode === "prepaid" ? (
          <Button variant="secondary" disabled={pending} onClick={() => setPanel(panel === "extend" ? "none" : "extend")}>
            <Plus /> Add time
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={pending || freeStations.length === 0}
            onClick={() => setPanel(panel === "transfer" ? "none" : "transfer")}
          >
            <ArrowRightLeft /> Move
          </Button>
        )}
        {session.mode === "prepaid" && (
          <Button
            variant="secondary"
            className="col-span-2"
            disabled={pending || freeStations.length === 0}
            onClick={() => setPanel(panel === "transfer" ? "none" : "transfer")}
          >
            <ArrowRightLeft /> Move to another {STATION_TYPE_LABEL[station.type]}
          </Button>
        )}
        <Button
          variant="secondary"
          className="col-span-2"
          onClick={() => setPanel(panel === "snack" ? "none" : "snack")}
        >
          <Coffee /> {panel === "snack" ? "Hide snacks & drinks" : "Add snacks & drinks"}
        </Button>
      </div>

      {panel === "snack" && (
        <SessionSnacksForm
          sessionId={session.id}
          branchId={data.branch.id}
          supabase={supabase}
          onDone={onChanged}
        />
      )}

      {panel === "extend" && (
        <ExtendForm
          session={session}
          plan={plan}
          packages={packages}
          data={data}
          supabase={supabase}
          onDone={async () => {
            setPanel("none");
            await onChanged();
          }}
        />
      )}
      {panel === "transfer" && (
        <TransferForm
          session={session}
          freeStations={freeStations}
          supabase={supabase}
          onDone={async (toId) => {
            setPanel("none");
            await onChanged();
            onMoved(toId);
          }}
        />
      )}

      {extra}

      <StickyActions>
        <Button size="lg" variant={armed ? "danger" : "primary"} className="w-full" disabled={pending} onClick={end}>
          <Square />
          {pending
            ? "Working…"
            : armed
              ? `Tap again to end & bill ${formatINR(info.charge?.total ?? 0)}`
              : `End & bill ${formatINR(info.charge?.total ?? 0)}`}
        </Button>
        {session.mode === "prepaid" && Number(session.billed_amount) > 0 && (
          <p className="mt-2 text-center text-xs text-muted">
            {formatINR(session.billed_amount)} already collected. Only the rest gets billed.
          </p>
        )}
      </StickyActions>
    </div>
  );
}

// Players / controllers. With choices on the rate: one button per choice, with its price.
// Without: a count (same price for any number, or the older "extra per player" rate).
function PlayersPicker({
  plan,
  type,
  mode,
  value,
  onChange,
  disabled,
  live = false,
}: {
  plan: FloorPlan;
  type: StationType;
  mode: SessionMode;
  value: number;
  onChange: (players: number) => void;
  disabled?: boolean;
  live?: boolean;
}) {
  const choices = planChoices(plan);
  const label = capitalize(playersWord(type));

  if (choices.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">{label}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {choices.map((c) => (
            <button
              key={c.players}
              type="button"
              disabled={disabled}
              aria-pressed={value === c.players}
              onClick={() => value !== c.players && onChange(c.players)}
              className={cx(
                "rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 pointer-coarse:py-2.5",
                value === c.players ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-hover",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Users className="size-3.5 text-muted" />
                {c.players} {playersWord(type, c.players)}
              </span>
              <span className="num text-[13px] text-muted">
                {mode === "frames"
                  ? `${formatINR(priceFor(plan, c.players, "frame"))}/frame`
                  : `${formatINR(c.per_hour)}/hr`}
              </span>
            </button>
          ))}
        </div>
        {live && mode !== "frames" && <span className="text-xs text-muted">A change re-prices the whole session.</span>}
      </div>
    );
  }

  const legacy = Number(plan.extra_player_per_hour) > 0;
  return (
    <Field
      label={label}
      hint={
        legacy
          ? `${plan.included_players} included, +${formatINR(plan.extra_player_per_hour)}/hr each extra${live ? ", charged for the whole session" : ""}`
          : "Same price for any number."
      }
    >
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || value <= 1}
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label={`Fewer ${playersWord(type)}`}
        >
          −
        </Button>
        <span className="num inline-flex w-10 items-center justify-center gap-1 text-sm">
          <Users className="size-3.5 text-muted" />
          {value}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || value >= 16}
          onClick={() => onChange(Math.min(16, value + 1))}
          aria-label={`More ${playersWord(type)}`}
        >
          +
        </Button>
      </div>
    </Field>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

const CLOCK_BOX: Record<TileInfo["state"], string> = {
  free: "border-line",
  busy: "border-line",
  ending: "border-ending/40",
  over: "border-over/45",
  paused: "border-dashed border-line-strong",
  off: "border-line",
};
const CLOCK_TEXT: Record<TileInfo["state"], string> = {
  free: "text-fg",
  busy: "text-fg",
  ending: "text-ending",
  over: "text-over",
  paused: "text-paused",
  off: "text-muted",
};
const BAR: Record<TileInfo["state"], string> = {
  free: "bg-free",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over",
  paused: "bg-paused",
  off: "bg-faint",
};

function ExtendForm({
  session,
  plan,
  packages,
  data,
  supabase,
  onDone,
}: {
  session: LiveSession;
  plan: FloorPlan;
  packages: FloorPackage[];
  data: FloorData;
  supabase: Supa;
  onDone: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>(packages[0]?.id ?? "custom");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [collectNow, setCollectNow] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const pkg = packages.find((p) => p.id === choice);
  const minutes = pkg ? pkg.minutes : Math.max(0, Math.floor(Number(customMinutes) || 0));
  const basePrice = pkg ? Number(pkg.price) : Math.round((Number(plan.per_hour) * minutes) / 60);
  const price = Math.max(Math.round(basePrice + (playerExtra(plan, session.players, "hour") * minutes) / 60), 0);
  const bill = computeBill([{ amount: price, gstRate: gstRateFor(plan, data) }], 0, {
    gstEnabled: data.settings.gstEnabled,
    pricesIncludeTax: data.settings.pricesIncludeTax,
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-subtle/40 p-3">
      <Field label="Add time">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatMinutes(p.minutes)} · {formatINR(p.price)}
            </option>
          ))}
          <option value="custom">Custom minutes at {formatINR(plan.per_hour)}/hr</option>
        </Select>
      </Field>
      {choice === "custom" && (
        <Field label="Minutes">
          <Input type="number" min={1} max={1440} value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} />
        </Field>
      )}
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">Adds to the bill</span>
        <span className="num text-lg font-semibold">{formatINR(bill.total)}</span>
      </div>
      <Toggle
        name="collect_now"
        checked={collectNow}
        onChange={setCollectNow}
        label="Collect payment now"
        description="Otherwise it's added to the bill at the end."
      />
      {collectNow && (
        <PaymentFields total={bill.total} onChange={setPayments} />
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        disabled={pending || minutes <= 0}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const { error } = await supabase.rpc("extend_session", {
              p_session_id: session.id,
              p_package_id: pkg?.id,
              p_minutes: pkg ? undefined : minutes,
              p_payments: collectNow ? payments : [],
            });
            if (error) return setError(friendlyError(error));
            await onDone();
          })
        }
      >
        {pending
          ? "Adding…"
          : collectNow
            ? `Collect ${formatINR(bill.total)} & add ${formatMinutes(minutes)}`
            : `Add ${formatMinutes(minutes)}`}
      </Button>
    </div>
  );
}

function TransferForm({
  session,
  freeStations,
  supabase,
  onDone,
}: {
  session: LiveSession;
  freeStations: FloorStation[];
  supabase: Supa;
  onDone: (toStationId: string) => Promise<void>;
}) {
  const [to, setTo] = useState(freeStations[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-subtle/40 p-3">
      <Field label="Move this session to" hint="The timer and charges carry over.">
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          {freeStations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button
        variant="secondary"
        disabled={pending || !to}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const { error } = await supabase.rpc("transfer_session", { p_session_id: session.id, p_to_station_id: to });
            if (error) return setError(friendlyError(error));
            await onDone(to);
          })
        }
      >
        {pending ? "Moving…" : "Move session"}
      </Button>
    </div>
  );
}
