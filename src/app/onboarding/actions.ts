"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";
import { STATION_TYPES } from "@/lib/constants";

const schema = z.object({
  orgName: z.string().trim().min(2, "Enter your venue name.").max(80),
  branchName: z.string().trim().min(2, "Enter a branch name.").max(80),
  timezone: z.string().min(1),
  stationTypes: z.array(z.enum(STATION_TYPES)).min(1, "Pick at least one kind of station."),
});

export async function createOrganization(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = schema.safeParse({
    ...Object.fromEntries(formData),
    stationTypes: formData.getAll("stationTypes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_org_name: parsed.data.orgName,
    p_branch_name: parsed.data.branchName,
    p_timezone: parsed.data.timezone,
    p_station_types: parsed.data.stationTypes,
  });
  if (error) return { error: friendlyDbError(error) };

  redirect("/stations");
}

export async function joinWithCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return { error: "Invite codes are 8 letters and numbers." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", { p_code: code });
  if (error) return { error: error.message };

  redirect("/dashboard");
}
