import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/constants";

export const ACTIVE_BRANCH_COOKIE = "qs_branch";

// Data access layer: every authenticated page and action resolves the
// current user / org / branch through these helpers. RLS is the real guard;
// these checks give friendly redirects and role-aware UI.

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? "" };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type AppContext = {
  user: { id: string; email: string; fullName: string };
  org: { id: string; name: string };
  role: MemberRole;
  branches: { id: string; name: string; timezone: string }[];
  branch: { id: string; name: string; timezone: string };
};

// Resolves the signed-in user's org, role and active branch.
// Sends users without an org to onboarding.
// Waits for the real request first: every page uses "now" (today's takings, timers, date ranges)
// after this, and Cache Components refuses to prerender the clock from cookies alone.
export const getAppContext = cache(async (): Promise<AppContext> => {
  await connection();
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, org:orgs(id, name)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  if (!membership?.org) redirect("/onboarding");

  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, timezone")
    .eq("org_id", membership.org.id)
    .order("created_at");

  if (!branches?.length) redirect("/onboarding");

  const wanted = (await cookies()).get(ACTIVE_BRANCH_COOKIE)?.value;
  const branch = branches.find((b) => b.id === wanted) ?? branches[0];

  return {
    user: { ...user, fullName: profile?.full_name ?? "" },
    org: membership.org,
    role: membership.role,
    branches,
    branch,
  };
});

// Two roles: owner (everything) and staff (runs the floor). "manager" exists only in the DB enum.
export function isOwner(role: MemberRole) {
  return role === "owner";
}

// For Server Actions: resolve context and enforce a minimum role.
export async function requireRole(allowed: MemberRole[]) {
  const ctx = await getAppContext();
  if (!allowed.includes(ctx.role)) {
    throw new Error("You don't have permission to do that.");
  }
  return ctx;
}
