"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_BRANCH_COOKIE, getAppContext, requireRole } from "@/lib/dal";
import { SESSION_MODES, STATION_TYPES, type SessionMode, type StationType } from "@/lib/constants";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const optionalTime = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(z.string().regex(/^\d{2}:\d{2}$/).nullable());

const branchSchema = z.object({
  name: z.string().trim().min(2, "Enter a branch name.").max(80),
  address: z.string().trim().max(200).transform((v) => v || null),
  phone: z.string().trim().max(20).transform((v) => v || null),
  opening_time: optionalTime,
  closing_time: optionalTime,
});

export async function saveBranchDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await requireRole(["owner"]);
  const parsed = branchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("branches").update(parsed.data).eq("id", branch.id);
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Branch saved." };
}

export async function saveStationTypes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await requireRole(["owner"]);
  const parsed = z
    .array(z.enum(STATION_TYPES))
    .min(1, "Pick at least one kind of station.")
    .safeParse(formData.getAll("station_types"));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("branch_settings")
    .update({ station_types: parsed.data })
    .eq("branch_id", branch.id);
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Station types saved." };
}

const billingSchema = z
  .object({
    gst_enabled: z.boolean(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5.").nullable()),
    gst_rate: z.coerce.number().min(0).max(28),
    prices_include_tax: z.boolean(),
    invoice_prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,10}$/, "Bill prefix: up to 10 letters, numbers or dashes."),
    overtime_grace_minutes: z.coerce.number().int().min(0).max(30),
    early_end_policy: z.enum(["full", "played"]),
  })
  .refine((v) => !v.gst_enabled || v.gstin, {
    message: "Enter your GSTIN to turn GST on.",
  });

export async function saveBillingSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await requireRole(["owner"]);
  const parsed = billingSchema.safeParse({
    ...Object.fromEntries(formData),
    gst_enabled: formData.get("gst_enabled") === "on",
    prices_include_tax: formData.get("prices_include_tax") === "on",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // Timer modes: per station type, which are allowed and which is pre-selected.
  const allowed = {} as Record<StationType, SessionMode[]>;
  const defaults = {} as Record<StationType, SessionMode>;
  for (const type of STATION_TYPES) {
    const modes = SESSION_MODES.filter((m) => formData.get(`allow_${type}_${m}`) === "on");
    if (modes.length === 0) return { error: "Each station type needs at least one timer mode." };
    const chosen = formData.get(`default_${type}`) as SessionMode | null;
    allowed[type] = modes;
    defaults[type] = chosen && modes.includes(chosen) ? chosen : modes[0];
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("branch_settings")
    .update({ ...parsed.data, allowed_modes_by_type: allowed, default_mode_by_type: defaults })
    .eq("branch_id", branch.id);
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Billing settings saved." };
}

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Colombo"] as const;

export async function addBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireRole(["owner"]);
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Enter a branch name.").max(80),
      timezone: z.enum(TIMEZONES),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data: branchId, error } = await supabase.rpc("create_branch", {
    p_org_id: org.id,
    p_name: parsed.data.name,
    p_timezone: parsed.data.timezone,
  });
  if (error) return { error: friendlyDbError(error) };

  // Switch to the new branch so the owner can set it up straight away.
  (await cookies()).set(ACTIVE_BRANCH_COOKIE, branchId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
  return { ok: `${parsed.data.name} added and selected. Add its stations next.` };
}

export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await getAppContext();
  const parsed = z.string().trim().min(2, "Enter your name.").max(80).safeParse(formData.get("full_name"));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data }).eq("id", user.id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Name saved." };
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await getAppContext();
  const parsed = z
    .object({
      password: z.string().min(8, "Password must be at least 8 characters."),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { message: "The two passwords don't match." })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };
  return { ok: "Password changed." };
}
