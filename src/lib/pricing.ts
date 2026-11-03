// Live estimate of a session's charge, for the ticking amount on the floor.
// Mirrors private.session_charge in supabase/migrations; the database value is
// always the one that gets billed.

export type PricingPlan = {
  id: string;
  per_hour: number;
  min_minutes: number;
  rounding_minutes: number;
  included_players: number;
  extra_player_per_hour: number;
};

export type PricingRule = {
  days_of_week: number[];
  start_time: string; // "HH:MM:SS"
  end_time: string;
  per_hour: number;
  priority: number;
};

export type PricingSession = {
  mode: "open" | "prepaid";
  started_at: string;
  ended_at: string | null;
  players: number;
  prepaid_minutes: number;
  prepaid_amount: number;
  billed_amount?: number;
  pauses: { started_at: string; ended_at: string | null }[];
};

export type Charge = {
  activeSeconds: number;
  billableMinutes: number;
  total: number;
};

const MINUTE = 60_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(ms: number, timeZone: string) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    dow: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Same matching as private.rate_at: a rule with end < start runs past midnight.
function rateAt(ms: number, plan: PricingPlan, rules: PricingRule[], timeZone: string, cache: Map<number, number>) {
  const cached = cache.get(ms);
  if (cached !== undefined) return cached;

  let rate = Number(plan.per_hour);
  if (rules.length) {
    const { dow, minutes } = localParts(ms, timeZone);
    const prevDow = (dow + 6) % 7;
    const matches = rules
      .filter((r) => {
        const start = toMinutes(r.start_time);
        const end = toMinutes(r.end_time);
        if (start < end) return minutes >= start && minutes < end && r.days_of_week.includes(dow);
        return (
          (minutes >= start && r.days_of_week.includes(dow)) ||
          (minutes < end && r.days_of_week.includes(prevDow))
        );
      })
      .sort((a, b) => b.priority - a.priority || Number(a.per_hour) - Number(b.per_hour));
    if (matches[0]) rate = Number(matches[0].per_hour);
  }
  cache.set(ms, rate);
  return rate;
}

export function estimateCharge(
  session: PricingSession,
  plan: PricingPlan,
  rules: PricingRule[],
  opts: {
    timeZone: string;
    graceMinutes: number;
    nowMs: number;
    earlyEndPolicy?: "full" | "played";
    cache?: Map<number, number>;
  },
): Charge {
  const start = Date.parse(session.started_at);
  const end = session.ended_at ? Date.parse(session.ended_at) : opts.nowMs;
  const pauses = session.pauses.map((p) => ({
    start: Date.parse(p.started_at),
    end: p.ended_at ? Date.parse(p.ended_at) : end,
  }));

  const pausedMs = pauses.reduce(
    (sum, p) => sum + Math.max(0, Math.min(p.end, end) - Math.max(p.start, start)),
    0,
  );
  const activeSeconds = Math.max(0, (end - start - pausedMs) / 1000);

  // Rate at each active wall-clock minute.
  const cache = opts.cache ?? new Map<number, number>();
  const rates: number[] = [];
  for (let m = start; m < end; m += MINUTE) {
    if (pauses.some((p) => m >= p.start && m < p.end)) continue;
    rates.push(rateAt(m, plan, rules, opts.timeZone, cache));
  }

  const block = plan.rounding_minutes;
  let base = 0;
  let skip = 0;
  let billable = 0;
  let playerMinutes = 0;
  const extraPerMinute =
    (Math.max(session.players - plan.included_players, 0) * Number(plan.extra_player_per_hour)) / 60;

  // Fixed time stopped (or stopping) early under the "charge time played" rule:
  // played minutes like open time, capped at the booking. Not when paid up front.
  if (
    session.mode === "prepaid" &&
    opts.earlyEndPolicy === "played" &&
    Number(session.billed_amount ?? 0) === 0 &&
    activeSeconds < session.prepaid_minutes * 60
  ) {
    const played = activeSeconds > 0 ? Math.max(plan.min_minutes, Math.ceil(activeSeconds / 60 / block) * block) : 0;
    let r = rates.at(-1) ?? Number(plan.per_hour);
    let t = 0;
    for (let i = 1; i <= played; i++) {
      if (i <= rates.length) r = rates[i - 1];
      t += r / 60;
    }
    const playedTotal = t + extraPerMinute * played;
    const bookedTotal = Number(session.prepaid_amount) + extraPerMinute * session.prepaid_minutes;
    return {
      activeSeconds: Math.floor(activeSeconds),
      billableMinutes: played,
      total: Math.round(Math.min(playedTotal, bookedTotal)),
    };
  }

  if (session.mode === "prepaid") {
    base = Number(session.prepaid_amount);
    const overSeconds = activeSeconds - session.prepaid_minutes * 60;
    if (overSeconds > opts.graceMinutes * 60) {
      billable = Math.ceil(overSeconds / 60 / block) * block;
      skip = session.prepaid_minutes;
    }
    playerMinutes = session.prepaid_minutes + billable;
  } else if (activeSeconds > 0) {
    billable = Math.max(plan.min_minutes, Math.ceil(activeSeconds / 60 / block) * block);
    playerMinutes = billable;
  }

  let rate = rates.at(-1) ?? Number(plan.per_hour);
  let time = 0;
  for (let i = 1; i <= billable; i++) {
    if (skip + i <= rates.length) rate = rates[skip + i - 1];
    time += rate / 60;
  }

  const extra = extraPerMinute * playerMinutes;

  return {
    activeSeconds: Math.floor(activeSeconds),
    billableMinutes: billable,
    total: Math.round(base + time + extra),
  };
}

// Seconds of prepaid time left (negative = overtime). Frozen while paused.
export function prepaidRemainingSeconds(
  plannedEndAt: string | null,
  pausedAt: string | null,
  nowMs: number,
) {
  if (!plannedEndAt) return null;
  const ref = pausedAt ? Date.parse(pausedAt) : nowMs;
  return Math.floor((Date.parse(plannedEndAt) - ref) / 1000);
}
