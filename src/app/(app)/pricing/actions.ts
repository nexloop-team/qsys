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

// "2 players ₹200/hr, 4 players ₹300/hr" (and ₹/frame when frame billing is on).
const choicesSchema = z
  .string()
  .transform((v, ctx) => {
    try {
      return JSON.parse(v || "[]") as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Check the player choices." });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          players: z.number().int("Players must be a whole number.").min(1, "At least 1 player.").max(16, "Up to 16 players."),
          per_hour: z.number({ error: "Give every choice a price per hour." }).min(0).max(100000),
          per_frame: z.number({ error: "Give every choice a price per frame." }).min(0).max(100000).nullable(),
        }),
      )
      .max(8, "Up to 8 choices.")
      .refine((rows) => rows.length === 0 || rows.length >= 2, { message: "Add at least two choices, like 2 and 4." })
      .refine((rows) => new Set(rows.map((r) => r.players)).size === rows.length, {
        message: "Two choices have the same number of players.",
      }),
  );

const planSchema = z
  .object({
    id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    name: z.string().trim().min(1, "Enter a plan name.").max(60),
    station_type: z.enum(STATION_TYPES),
    tier: optionalText,
    per_hour: money,
    frames_on: z.string().optional().transform((v) => v === "on"),
    per_frame: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().min(0, "Frame price can't be negative.").max(100000).nullable()),
    player_choices: choicesSchema,
    min_minutes: z.coerce.number().int().min(0).max(600),
    rounding_minutes: z.coerce.number().int().min(1, "Rounding must be at least 1 minute.").max(60),
    gst_rate_override: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().min(0).max(28).nullable()),
  })
  .refine((p) => !p.frames_on || p.per_frame !== null, { message: "Enter a price per frame." })
  .refine((p) => !p.frames_on || p.player_choices.every((c) => c.per_frame !== null), {
    message: "Give every choice a price per frame.",
  });

export async function saveRatePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole([...OWNER_ONLY]);
  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { id, frames_on, player_choices, ...rest } = parsed.data;
  const pc = rest.station_type === "pc";
  const values = {
    ...rest,
    // PCs: one person each, no frames. Choices replace the older "extra player" price.
    player_choices: pc ? [] : player_choices.map((c) => (frames_on ? c : { players: c.players, per_hour: c.per_hour })),
    per_frame: frames_on && !pc ? rest.per_frame : null,
    included_players: 1,
    extra_player_per_hour: 0,
  };
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

const optionalId = z.uuid().optional().or(z.literal("").transform(() => undefined));

const ruleSchema = z
  .object({
    id: optionalId,
    rate_plan_id: z.uuid(),
    name: z.string().trim().min(1, "Name the rule, like Happy hour.").max(60),
    days_of_week: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day."),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time."),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time."),
    per_hour: money,
  })
  .refine((r) => r.start_time !== r.end_time, { message: "Start and end can't be the same." });

// Adds a time-based rate, or updates it when the form carries an id.
export async function saveRateRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireRole([...OWNER_ONLY]);
  const parsed = ruleSchema.safeParse({
    ...Object.fromEntries(formData),
    days_of_week: formData.getAll("days_of_week"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("rate_rules").update(values).eq("id", id)
    : await supabase.from("rate_rules").insert({ ...values, org_id: org.id });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: id ? "Rate saved." : "Rate added." };
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
    id: optionalId,
    name: z.string().trim().min(1, "Name the package, like 3 hours.").max(60),
    station_type: z.enum(STATION_TYPES),
    tier: optionalText,
    hours: z.coerce.number().int().min(0).max(24),
    mins: z.coerce.number().int().min(0).max(59),
    price: money,
  })
  .refine((p) => p.hours * 60 + p.mins > 0, { message: "Package must be at least 1 minute." });

// Adds a package, or updates it when the form carries an id.
export async function savePackage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole([...OWNER_ONLY]);
  const parsed = packageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { id, hours, mins, ...values } = parsed.data;
  const row = { ...values, minutes: hours * 60 + mins };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("packages").update(row).eq("id", id)
    : await supabase.from("packages").insert({ ...row, org_id: org.id, branch_id: branch.id });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: id ? "Package saved." : "Package added." };
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
