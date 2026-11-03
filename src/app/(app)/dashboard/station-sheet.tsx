"use client";

import { useMemo, useState, useTransition } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRightLeft, Pause, Play, Plus, Square, Users } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { SESSION_MODE_HINT, SESSION_MODE_LABEL, STATION_TYPE_LABEL, type SessionMode } from "@/lib/constants";
import { formatClock, formatINR, formatMinutes, formatTime } from "@/lib/format";
import { computeBill } from "@/lib/bill";
import { Sheet } from "@/components/overlay";
import { Badge } from "@/components/card";
import { Button, ErrorText, Field, Input, Segmented, Select } from "@/components/ui";
import { PaymentFields, type PaymentRow } from "./payment-fields";
import { PlayerField, type PlayerValue } from "./player-field";
import type { TileInfo } from "./floor-board";
import type { FloorData, FloorPackage, FloorPlan, FloorStation, LiveSession } from "./types";

type Supa = SupabaseClient<Database>;

const MULTIPLAYER = new Set(["ps5", "xbox", "pool", "snooker", "other"]);
const CONSOLES = new Set(["ps5", "xbox"]);

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
}) {
  const plan = useMemo(() => resolvePlan(data.plans, station, session), [data.plans, station, session]);
  const packages = data.packages.filter(
    (p) => p.station_type === station.type && (p.tier === null || p.tier === station.tier),
  );

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
      description={
        plan ? `${formatINR(plan.per_hour)}/hr${plan.rate_rules.length ? " · time-based rates apply" : ""}` : "No price set"
      }
    >
      {station.status !== "active" && !session ? (
        <p className="text-sm text-muted">
          This station is in <strong className="text-fg">{station.status}</strong>. Change it under Stations to use it.
        </p>
      ) : !plan ? (
        <p className="text-sm text-muted">Set a price for {STATION_TYPE_LABEL[station.type]} under Pricing first.</p>
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
        />
      )}
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
}: {
  station: FloorStation;
  plan: FloorPlan;
  packages: FloorPackage[];
  data: FloorData;
  supabase: Supa;
  onStarted: () => Promise<void>;
}) {
  const allowed = data.settings.allowed[station.type] ?? ["open", "prepaid"];
  const [mode, setMode] = useState<SessionMode>(
    allowed.includes(data.settings.defaults[station.type]) ? data.settings.defaults[station.type] : allowed[0],
  );
  const [players, setPlayers] = useState(1);
  const [player, setPlayer] = useState<PlayerValue>({ phone: "", name: "", isNew: false, ready: false });
  const [choice, setChoice] = useState<string>(packages[0]?.id ?? "custom");
  const [customMinutes, setCustomMinutes] = useState("60");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [collectNow, setCollectNow] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const pkg = packages.find((p) => p.id === choice);
  const minutes = pkg ? pkg.minutes : Math.max(0, Math.floor(Number(customMinutes) || 0));
  const price = pkg ? Number(pkg.price) : Math.round((Number(plan.per_hour) * minutes) / 60);
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
      if (error) return setError(error.message);
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
                className={`rounded-md border px-3 py-2 text-left ${choice === p.id ? "border-fg bg-subtle" : "border-line-strong hover:bg-hover"}`}
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
              className={`rounded-md border px-3 py-2 text-left ${choice === "custom" ? "border-fg bg-subtle" : "border-line-strong hover:bg-hover"}`}
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

      {MULTIPLAYER.has(station.type) && Number(plan.extra_player_per_hour) > 0 && (
        <div>
          <Field
            label={CONSOLES.has(station.type) ? "Controllers" : "Players"}
            hint={`${plan.included_players} included, +${formatINR(plan.extra_player_per_hour)}/hr each extra`}
          >
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPlayers(Math.max(1, players - 1))} aria-label="Fewer players">
                −
              </Button>
              <span className="num inline-flex w-10 items-center justify-center gap-1 text-sm">
                <Users className="size-3.5 text-muted" />
                {players}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setPlayers(Math.min(16, players + 1))} aria-label="More players">
                +
              </Button>
            </div>
          </Field>
        </div>
      )}

      {mode === "prepaid" && minutes > 0 && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Bill for {formatMinutes(minutes)}</span>
            <span className="num text-2xl font-semibold">{formatINR(bill.total)}</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={collectNow}
              onChange={(e) => setCollectNow(e.target.checked)}
              className="size-4 accent-current"
            />
            Collect payment now
            <span className="text-muted">(otherwise at the end)</span>
          </label>
          {collectNow && (
            <PaymentFields total={bill.total} onChange={setPayments} />
          )}
        </div>
      )}

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
              : `Start ${station.name}`}
      </Button>
      {!player.ready && (
        <p className="-mt-3 text-center text-xs text-muted">Pick a player, or add a new one with their mobile number.</p>
      )}
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
}) {
  const [panel, setPanel] = useState<"none" | "extend" | "transfer">("none");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const tz = data.branch.timezone;

  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>) =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await fn();
      if (error) return setError(error.message);
      await onChanged();
    });

  const end = () =>
    startTransition(async () => {
      setError(undefined);
      const { data: charge, error } = await supabase.rpc("end_session", { p_session_id: session.id });
      if (error) return setError(error.message);
      await onChanged();
      const outstanding = Number((charge as { outstanding?: number } | null)?.outstanding ?? 0);
      if (outstanding > 0) onCheckout([session.id]);
    });

  const elapsed = formatClock(info.charge?.activeSeconds ?? 0);
  void nowMs; // re-render each tick via parent

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line">
        <Cell label={info.clockLabel} value={info.clock ?? "—"} strong />
        <Cell label="Charge so far" value={formatINR(info.charge?.total ?? 0)} strong />
        <Cell label="Started" value={formatTime(session.started_at, tz)} />
        <Cell
          label={session.mode === "prepaid" ? "Ends" : "Played"}
          value={session.mode === "prepaid" && session.planned_end_at ? formatTime(session.planned_end_at, tz) : elapsed}
        />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted">Mode</dt>
        <dd>
          {SESSION_MODE_LABEL[session.mode]}
          {session.mode === "prepaid" &&
            ` · ${formatMinutes(session.prepaid_minutes)} booked (${formatINR(session.prepaid_amount)})`}
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
        {session.players > 1 && (
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
      </div>

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
          onDone={async () => {
            setPanel("none");
            await onChanged();
          }}
        />
      )}

      <Button size="lg" className="w-full" disabled={pending} onClick={end}>
        <Square />
        {pending ? "Working…" : `End & bill ${formatINR(info.charge?.total ?? 0)}`}
      </Button>
      {session.mode === "prepaid" && Number(session.billed_amount) > 0 && (
        <p className="-mt-3 text-center text-xs text-muted">
          {formatINR(session.billed_amount)} already collected. Only the rest gets billed.
        </p>
      )}
    </div>
  );
}

function Cell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border-b border-r border-line px-3 py-2.5 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num mt-0.5 ${strong ? "text-xl font-semibold" : "text-sm"}`}>{value}</p>
    </div>
  );
}

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
  const price = pkg ? Number(pkg.price) : Math.round((Number(plan.per_hour) * minutes) / 60);
  const bill = computeBill([{ amount: price, gstRate: gstRateFor(plan, data) }], 0, {
    gstEnabled: data.settings.gstEnabled,
    pricesIncludeTax: data.settings.pricesIncludeTax,
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
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
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={collectNow}
          onChange={(e) => setCollectNow(e.target.checked)}
          className="size-4 accent-current"
        />
        Collect payment now
      </label>
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
            if (error) return setError(error.message);
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
  onDone: () => Promise<void>;
}) {
  const [to, setTo] = useState(freeStations[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
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
            if (error) return setError(error.message);
            await onDone();
          })
        }
      >
        {pending ? "Moving…" : "Move session"}
      </Button>
    </div>
  );
}
