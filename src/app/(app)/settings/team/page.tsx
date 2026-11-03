import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { Badge, PageSkeleton } from "@/components/card";
import { SettingsSection } from "../section";
import { DeleteInviteButton, InviteForm, MemberActions } from "./team-forms";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Team />
    </Suspense>
  );
}

const ROLE_HELP = [
  ["Staff", "Runs the floor: start, pause, extend, end and bill sessions, add players, see bills."],
  ["Owner", "Everything staff can do, plus stations, prices, floor layout, reports, activity, settings, team and write-offs."],
] as const;

async function Team() {
  const { org, role, user, branch } = await getAppContext();
  const supabase = await createClient();
  const owner = isOwner(role);

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, created_at").eq("org_id", org.id).order("created_at"),
    owner
      ? supabase
          .from("team_invites")
          .select("id, code, role, expires_at")
          .eq("org_id", org.id)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; code: string; role: "owner" | "manager" | "staff"; expires_at: string }[] }),
  ]);

  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name || "Unnamed";

  return (
    <>
      <SettingsSection title="Members" description={`${members?.length ?? 0} people at ${org.name}.`} flush>
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">
                {nameOf(m.user_id).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {nameOf(m.user_id)}
                  {m.user_id === user.id && <span className="font-normal text-muted"> (you)</span>}
                </span>
                <span className="block text-xs text-muted">Joined {formatDateTime(m.created_at, branch.timezone)}</span>
              </span>
              {owner && m.user_id !== user.id ? (
                <MemberActions userId={m.user_id} role={m.role === "owner" ? "owner" : "staff"} />
              ) : (
                <Badge>{ROLE_LABEL[m.role]}</Badge>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>

      {owner && (
        <SettingsSection
          title="Invite someone"
          description="Invites are for staff. They sign up on this site, choose “Join with invite code” and enter it. Codes work once and last 7 days. You can make someone a co-owner after they join."
        >
          <InviteForm />
          {(invites ?? []).length > 0 && (
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
              {invites!.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="num font-semibold tracking-widest">{inv.code}</span>
                  <Badge>{ROLE_LABEL[inv.role]}</Badge>
                  <span className="text-xs text-muted">expires {formatDateTime(inv.expires_at, branch.timezone)}</span>
                  <span className="ml-auto">
                    <DeleteInviteButton id={inv.id} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}

      <SettingsSection title="What each role can do" flush>
        <dl className="divide-y divide-line text-sm">
          {ROLE_HELP.map(([r, text]) => (
            <div key={r} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[96px_1fr]">
              <dt className="font-medium">{r}</dt>
              <dd className="text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>
    </>
  );
}
