"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { STATION_STATUSES, STATION_TYPES } from "@/lib/constants";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const OWNER_ONLY = ["owner"] as const;

const bulkSchema = z.object({
  type: z.enum(STATION_TYPES),
  prefix: z.string().trim().min(1, "Enter a name prefix.").max(20),
  count: z.coerce.number().int().min(1, "Add at least 1.").max(200, "Max 200 at once."),
  start: z.coerce.number().int().min(0).default(1),
  tier: z.string().trim().max(30).default("standard"),
  zone: z.string().trim().max(40).optional(),
});

export async function bulkCreateStations(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { branch } = await requireRole([...OWNER_ONLY]);
  const parsed = bulkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_create_stations", {
    p_branch_id: branch.id,
    p_type: parsed.data.type,
    p_prefix: parsed.data.prefix,
    p_count: parsed.data.count,
    p_start: parsed.data.start,
    p_tier: parsed.data.tier || "standard",
    p_zone: parsed.data.zone || undefined,
  });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: `Added ${data?.length ?? parsed.data.count} stations.` };
}

const updateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name can't be empty.").max(40),
  tier: z.string().trim().min(1, "Tier can't be empty.").max(30),
  zone: z.string().trim().max(40),
  status: z.enum(STATION_STATUSES),
});

export async function updateStation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { id, zone, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("stations")
    .update({ ...rest, zone: zone || null })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Saved." };
}

export async function deleteStation(id: string): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const supabase = await createClient();
  const { error } = await supabase.from("stations").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Deleted." };
}
