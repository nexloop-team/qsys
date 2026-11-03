"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { friendlyDbError, type ActionState } from "@/lib/action-state";

// Invites are always for staff. The owner can make someone a co-owner after they join.
export async function createInvite(): Promise<(ActionState & { code?: string }) | null> {
  const { org } = await requireRole(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invite", { p_org_id: org.id, p_role: "staff" });
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Invite created.", code: data ?? undefined };
}

export async function deleteInvite(id: string): Promise<ActionState> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("team_invites").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}

export async function changeRole(userId: string, role: "owner" | "staff"): Promise<ActionState> {
  const { org, user } = await requireRole(["owner"]);
  if (userId === user.id) return { error: "You can't change your own role." };
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").update({ role }).eq("org_id", org.id).eq("user_id", userId);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}

export async function removeMember(userId: string): Promise<ActionState> {
  const { org, user } = await requireRole(["owner"]);
  if (userId === user.id) return { error: "You can't remove yourself." };
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").delete().eq("org_id", org.id).eq("user_id", userId);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}
