"use client";

import { useState } from "react";
import { estimateCharge, type PricingPlan, type PricingRule } from "@/lib/pricing";
import { DAY_LABELS } from "@/lib/constants";
import { formatINR, formatMinutes, nextDay, zonedStart } from "@/lib/format";
import { Field, Input, Select } from "@/components/ui";

// A Monday to count weekdays from; only the weekday and time matter for pricing.
const REF_MONDAY = "2026-11-02";
const DAYS_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

// "What would this cost?" for one rate, using the same pricing code as the floor.
export function PriceCheck({
  plan,
  rules,
  timeZone,
  canHaveExtraPlayers,
}: {
  plan: PricingPlan;
  rules: PricingRule[];
  timeZone: string;
  canHaveExtraPlayers: boolean;
}) {
  const [dow, setDow] = useState(6); // Saturday
  const [time, setTime] = useState("19:00");
  const [minutes, setMinutes] = useState("90");
  const [players, setPlayers] = useState(String(plan.included_players));

  const mins = Math.min(Math.max(Math.floor(Number(minutes) || 0), 0), 24 * 60);
  const date = nextDay(REF_MONDAY, (dow + 6) % 7);
  const [h, m] = time.split(":").map(Number);
  const start = Date.parse(zonedStart(date, timeZone)) + ((h || 0) * 60 + (m || 0)) * 60_000;
  const charge =
    mins > 0
      ? estimateCharge(
          {
            mode: "open",
            started_at: new Date(start).toISOString(),
            ended_at: new Date(start + mins * 60_000).toISOString(),
            players: Math.max(1, Number(players) || 1),
            prepaid_minutes: 0,
            prepaid_amount: 0,
            pauses: [],
          },
          plan,
          rules,
          { timeZone, graceMinutes: 0, nowMs: start + mins * 60_000 },
        )
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Field label="Day">
          <Select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
            {DAYS_MON_FIRST.map((d) => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Starts">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Minutes">
          <Input type="number" min={1} max={1440} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        {canHaveExtraPlayers && (
          <Field label="Players">
            <Input type="number" min={1} max={16} inputMode="numeric" value={players} onChange={(e) => setPlayers(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
        <span className="text-sm text-muted">
          {charge ? `Billed as ${formatMinutes(charge.billableMinutes)}` : "Enter how long they play"}
        </span>
        <span className="num text-2xl font-semibold">{charge ? formatINR(charge.total) : "—"}</span>
      </div>
      <p className="text-xs text-muted">Open time, before GST and discounts. Uses this rate&apos;s rounding, minimum and time-based rates.</p>
    </div>
  );
}
