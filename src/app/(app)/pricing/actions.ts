"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { STATION_TYPES } from "@/lib/constants";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const OWNER_ONLY = ["owner"] as const;

const money = z.coerce.number().min(0, "Amount can't be negative.").max(100000);
// Empty form fields mean "not set".
const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null);

const planSchema = z.object({
  id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(1, "Enter a plan name.").max(60),
  station_type: z.enum(STATION_TYPES),
  tier: optionalText,
  per_hour: money,
  min_minutes: z.coerce.number().int().min(0).max(600),
  rounding_minutes: z.coerce.number().int().min(1, "Rounding must be at least 1 minute.").max(60),
  included_players: z.coerce.number().int().min(1).max(16),
  extra_player_per_hour: money,
  gst_rate_override: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().min(0).max(28).nullable()),
});

export async function saveRatePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole([...OWNER_ONLY]);
  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("rate_plans").update(values).eq("id", id)
    : await supabase.from("rate_plans").insert({ ...values, org_id: org.id, branch_id: branch.id });

  if (error?.code === "23505") {
    return { error: "There's already an active price for this type and tier. Edit that one instead." };
  }
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Price saved." };
}

export async function deleteRatePlan(id: string): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const supabase = await createClient();
  const { error } = await supabase.from("rate_plans").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Deleted." };
}

const ruleSchema = z
  .object({
    rate_plan_id: z.uuid(),
    name: z.string().trim().min(1, "Name the rule, e.g. Happy hour.").max(60),
    days_of_week: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day."),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time."),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time."),
    per_hour: money,
  })
  .refine((r) => r.start_time !== r.end_time, { message: "Start and end can't be the same." });

export async function addRateRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireRole([...OWNER_ONLY]);
  const parsed = ruleSchema.safeParse({
    ...Object.fromEntries(formData),
    days_of_week: formData.getAll("days_of_week"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("rate_rules").insert({ ...parsed.data, org_id: org.id });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Rule added." };
}

export async function deleteRateRule(id: string): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const supabase = await createClient();
  const { error } = await supabase.from("rate_rules").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Deleted." };
}

const packageSchema = z
  .object({
    name: z.string().trim().min(1, "Name the package, e.g. 3 hours.").max(60),
    station_type: z.enum(STATION_TYPES),
    tier: optionalText,
    hours: z.coerce.number().int().min(0).max(24),
    mins: z.coerce.number().int().min(0).max(59),
    price: money,
  })
  .refine((p) => p.hours * 60 + p.mins > 0, { message: "Package must be at least 1 minute." });

export async function addPackage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole([...OWNER_ONLY]);
  const parsed = packageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { hours, mins, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("packages").insert({
    ...values,
    minutes: hours * 60 + mins,
    org_id: org.id,
    branch_id: branch.id,
  });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Package added." };
}

export async function setPackageActive(id: string, isActive: boolean): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const supabase = await createClient();
  const { error } = await supabase.from("packages").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}

export async function deletePackage(id: string): Promise<ActionState> {
  await requireRole([...OWNER_ONLY]);
  const supabase = await createClient();
  const { error } = await supabase.from("packages").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}
