import { Suspense } from "react";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { formatDateTime, formatINR } from "@/lib/format";
import { PageSkeleton } from "@/components/card";
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
};
const VERB: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };
const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "org_id", "branch_id", "id", "sort_order", "_label"]);

type Details = Record<string, Json>;

function describe(entity: string, action: string, details: Details) {
  const label = typeof details._label === "string" ? details._label : typeof details.name === "string" ? details.name : "";
  const name = label ? ` ${label}` : "";
  const thing = `${ENTITY[entity] ?? entity}${name}`;
  if (action !== "update") return `${VERB[action] ?? action} ${thing}`;

  const changes = Object.entries(details)
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]) => {
      const c = v as { from?: Json; to?: Json };
      const show = (x: Json | undefined) => (x === null || x === undefined ? "—" : typeof x === "object" ? "…" : String(x));
      return `${k.replaceAll("_", " ")}: ${show(c.from)} → ${show(c.to)}`;
    });
  return `changed ${thing}${changes.length ? ` (${changes.slice(0, 3).join(", ")}${changes.length > 3 ? ", …" : ""})` : ""}`;
}

async function Activity() {
  const { org, role, branch } = await getAppContext();
  if (!isOwner(role)) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
        <Lock className="size-4" /> Activity is visible to the owner.
      </p>
    );
  }

  const supabase = await createClient();
  const [{ data: changes }, { data: writeOffs }] = await Promise.all([
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
  ]);

  const actorIds = [...new Set([...(changes ?? []), ...(writeOffs ?? [])].map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const who = (id: string | null) => (id && profiles?.find((p) => p.id === id)?.full_name) || "System";

  const items = [
    ...(changes ?? []).map((c) => ({
      key: `a${c.id}`,
      at: c.created_at,
      actor: who(c.actor_id),
      text: describe(c.entity, c.action, (c.details ?? {}) as Details),
      alert: false,
    })),
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
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <SettingsSection title="Activity" description="Who changed what: stations, prices, settings, team and write-offs." flush>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-3">
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
