import { Suspense } from "react";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { formatDateTime, formatINR } from "@/lib/format";
import { PageSkeleton, Notice } from "@/components/card";
import { SettingsSection } from "../section";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Activity />
    </Suspense>
  );
}

const ENTITY: Record<string, string> = {
  stations: "station",
  rate_plans: "rate",
  rate_rules: "time-based rate",
  packages: "time package",
  branch_settings: "settings",
  memberships: "team member",
  expenses: "expense",
  invoices: "bill",
};
const VERB: Record<string, string> = { insert: "added", update: "changed", delete: "removed", void: "cancelled" };
const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "org_id", "branch_id", "id", "sort_order", "_label"]);
// Where a station sits on the floor map: summarised as "moved on the floor map", never as numbers.
const LAYOUT_FIELDS = new Set(["layout_x", "layout_y", "layout_rot"]);
// Plain words for the columns people change most.
const FIELD_LABEL: Record<string, string> = {
  per_hour: "price per hour",
  is_active: "on/off",
  status: "status",
  min_minutes: "minimum time",
  rounding_minutes: "rounding",
  extra_player_per_hour: "extra player price",
  included_players: "players included",
  gst_enabled: "GST",
  gst_rate: "GST rate",
  gst_rate_override: "GST rate",
  prices_include_tax: "prices include GST",
  invoice_prefix: "bill prefix",
  overtime_grace_minutes: "free overtime",
  staff_max_discount_pct: "staff discount limit",
  early_end_policy: "early end rule",
  blocked_apps: "blocked apps",
  lock_message: "lock screen message",
  pc_player_login: "player login on PCs",
  pc_games: "PC games menu",
  pc_restrictions: "PC restrictions",
  spend_bonus_pct: "bonus on spending",
  station_types: "station types",
  allowed_modes_by_type: "timer modes",
  default_mode_by_type: "default timer mode",
  opening_time: "opening time",
  closing_time: "closing time",
  player_choices: "player choices",
  per_frame: "price per frame",
  credit_limit: "pay-later limit",
  qr_enabled: "player QR page",
  qr_orders: "snack orders (QR page and PCs)",
  booking_enabled: "online bookings",
  booking_slug: "booking page address",
  booking_days: "days bookable ahead",
  booking_note: "booking page note",
  public_code: "QR code",
};

type Details = Record<string, Json>;

function describe(entity: string, action: string, details: Details) {
  const label = typeof details._label === "string" ? details._label : typeof details.name === "string" ? details.name : "";
  const name = label ? ` ${label}` : "";
  const thing = `${ENTITY[entity] ?? entity}${name}`;
  if (action === "void" && typeof details.reason === "string") return `cancelled ${thing}: “${details.reason}”`;
  if (action !== "update") return `${VERB[action] ?? action} ${thing}`;

  const fields = Object.keys(details).filter((k) => !HIDDEN_FIELDS.has(k));
  const moved = fields.some((k) => LAYOUT_FIELDS.has(k));
  const changes = fields
    .filter((k) => !LAYOUT_FIELDS.has(k))
    .map((k) => {
      const c = details[k] as { from?: Json; to?: Json };
      const show = (x: Json | undefined) =>
        x === null || x === undefined ? "empty" : typeof x === "boolean" ? (x ? "on" : "off") : typeof x === "object" ? "…" : String(x);
      const label = FIELD_LABEL[k] ?? k.replaceAll("_", " ");
      // Long or structured values (lists, messages): just say it changed.
      return typeof c?.to === "object" || String(c?.to ?? "").length > 24
        ? label
        : `${label} ${show(c?.from)} → ${show(c?.to)}`;
    });
  if (moved && changes.length === 0) return `moved ${thing} on the floor map`;
  if (moved) changes.push("position on the floor map");
  return `changed ${thing}${changes.length ? ` (${changes.slice(0, 3).join(", ")}${changes.length > 3 ? ", …" : ""})` : ""}`;
}

type Item = { key: string; at: string; actor: string; text: string; alert: boolean };

// Saving the floor map logs one change per station: show it as one line.
function groupMapMoves(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    const m = /^moved station (.+) on the floor map$/.exec(item.text);
    const pm = prev && /^moved (?:station (.+)|(\d+) stations) on the floor map/.exec(prev.text);
    if (
      m &&
      prev &&
      pm &&
      prev.actor === item.actor &&
      Math.abs(Date.parse(prev.at) - Date.parse(item.at)) < 2 * 60_000
    ) {
      const count = pm[2] ? Number(pm[2]) + 1 : 2;
      out[out.length - 1] = { ...prev, text: `moved ${count} stations on the floor map` };
    } else {
      out.push(item);
    }
  }
  return out;
}

async function Activity() {
  const { org, role, branch } = await getAppContext();
  if (!isOwner(role)) {
    return (
      <Notice icon={<Lock />}>Activity is visible to the owner.</Notice>
    );
  }

  const supabase = await createClient();
  const [{ data: changes }, { data: writeOffs }, { data: discounts }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, actor_id, action, entity, details, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("session_events")
      .select("id, actor_id, details, created_at")
      .eq("org_id", org.id)
      .eq("kind", "write_off")
      .order("created_at", { ascending: false })
      .limit(50),
    // Every discount, with who gave it and why.
    supabase
      .from("invoices")
      .select("id, number, discount, discount_reason, created_by, created_at")
      .eq("org_id", org.id)
      .gt("discount", 0)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const actorIds = [
    ...new Set([
      ...[...(changes ?? []), ...(writeOffs ?? [])].map((r) => r.actor_id),
      ...(discounts ?? []).map((d) => d.created_by),
    ].filter(Boolean)),
  ] as string[];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const who = (id: string | null) => (id && profiles?.find((p) => p.id === id)?.full_name) || "System";

  const items = [
    ...(changes ?? []).map((c) => {
      const details = (c.details ?? {}) as Details;
      // Reported by the PC app itself: "PC-04 closed blocked app taskmgr.exe".
      if (c.action === "blocked_app" || c.action === "staff_unlock" || c.action === "staff_pin_locked" || c.action === "usb_drive") {
        return {
          key: `a${c.id}`,
          at: c.created_at,
          actor: typeof details.name === "string" ? details.name : "A PC",
          text:
            c.action === "staff_unlock"
              ? "was unlocked with the staff PIN on the PC"
              : c.action === "staff_pin_locked"
                ? "locked staff unlock after 5 wrong PINs on the PC"
                : c.action === "usb_drive"
                  ? `had a USB drive plugged in during a player's time${details.blocked === true ? " (blocked)" : ""}`
                  : `closed blocked app ${typeof details.app === "string" ? details.app : ""}`.trim(),
          alert: true,
        };
      }
      return {
        key: `a${c.id}`,
        at: c.created_at,
        actor: who(c.actor_id),
        text: describe(c.entity, c.action, details),
        alert: false,
      };
    }),
    ...(writeOffs ?? []).map((w) => {
      const d = (w.details ?? {}) as { reason?: string; amount?: number };
      return {
        key: `w${w.id}`,
        at: w.created_at,
        actor: who(w.actor_id),
        text: `wrote off ${formatINR(d.amount ?? 0)}${d.reason ? `: “${d.reason}”` : ""}`,
        alert: true,
      };
    }),
    ...(discounts ?? []).map((d) => ({
      key: `d${d.id}`,
      at: d.created_at,
      actor: who(d.created_by),
      text: `gave ${formatINR(d.discount)} discount on ${d.number}${d.discount_reason ? `: “${d.discount_reason}”` : ""}`,
      alert: false,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = groupMapMoves(items);

  return (
    <SettingsSection title="Activity" description="Who changed what: stations, prices, settings, team, write-offs and apps closed by the PC app." flush>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((i) => (
            <li key={i.key} className="flex flex-col gap-0.5 px-5 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-3 sm:px-4 sm:py-2.5">
              <span className="num shrink-0 text-xs text-muted sm:w-32">{formatDateTime(i.at, branch.timezone)}</span>
              <span className="min-w-0">
                <span className="font-medium">{i.actor}</span>{" "}
                <span className={i.alert ? "text-over" : "text-muted"}>{i.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
