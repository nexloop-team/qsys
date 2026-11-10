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
      .pipe(z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters, like 27ABCDE1234F1Z5.").nullable()),
    gst_rate: z.coerce.number().min(0).max(28),
    prices_include_tax: z.boolean(),
    invoice_prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,10}$/, "The bill prefix can have up to 10 letters, numbers or dashes."),
    overtime_grace_minutes: z.coerce.number().int().min(0).max(30),
    early_end_policy: z.enum(["full", "played"]),
    staff_max_discount_pct: z.coerce.number().int().min(0, "0% or more.").max(100, "100% at most."),
    credit_limit: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().min(0, "The pay-later limit can't be negative.").max(1000000).nullable()),
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
    credit_limit: String(formData.get("credit_limit") ?? ""),
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

// Wallet top-up offers ("pay ₹500, get ₹50 extra"). Venue-wide, owner only.
const offersSchema = z
  .array(
    z.object({
      pay: z.coerce.number().int().min(1, "Pay amount must be at least ₹1.").max(100000),
      bonus: z.coerce.number().int().min(1, "Bonus must be at least ₹1.").max(100000),
    }),
  )
  .max(6, "Keep it to 6 offers or fewer.")
  .refine((offers) => offers.every((o) => o.bonus <= o.pay), { message: "A bonus can't be more than the amount paid." })
  .refine((offers) => new Set(offers.map((o) => o.pay)).size === offers.length, {
    message: "Two offers have the same pay amount.",
  });

export async function saveWalletOffers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireRole(["owner"]);
  const pays = formData.getAll("pay");
  const bonuses = formData.getAll("bonus");
  const rows = pays
    .map((pay, i) => ({ pay: String(pay).trim(), bonus: String(bonuses[i] ?? "").trim() }))
    .filter((r) => r.pay !== "" || r.bonus !== "");
  const parsed = offersSchema.safeParse(rows);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("orgs")
    .update({ wallet_offers: [...parsed.data].sort((a, b) => a.pay - b.pay) })
    .eq("id", org.id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Offers saved." };
}

// Bonus on spending: % of each cash/UPI bill back into the player's wallet.
export async function saveSpendBonus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireRole(["owner"]);
  const parsed = z.coerce
    .number({ message: "Enter a percentage." })
    .min(0, "The bonus can't be negative.")
    .max(20, "Keep the bonus at 20% or less.")
    .transform((v) => Math.round(v * 10) / 10)
    .safeParse(String(formData.get("spend_bonus_pct") ?? "").trim() || "0");
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update({ spend_bonus_pct: parsed.data }).eq("id", org.id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: parsed.data > 0 ? `Saved. Players now get ${parsed.data}% back on every bill.` : "Bonus on spending is off." };
}

// PC app: apps it closes while a player is on the PC, and the text on the lock screen.
const pcSchema = z.object({
  blocked_apps: z
    .string()
    .transform((v) =>
      [...new Set(v.split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))].map((s) =>
        s.endsWith(".exe") ? s : `${s}.exe`,
      ),
    )
    .pipe(
      z
        .array(z.string().max(60, "An app name is too long.").regex(/^[a-z0-9 ._()+-]+\.exe$/, "Use program names like taskmgr.exe."))
        .max(100, "Keep the list to 100 apps or fewer."),
    ),
  lock_message: z
    .string()
    .trim()
    .max(200, "Keep the lock-screen message under 200 characters.")
    .transform((v) => v || null),
  // A checkbox: present ("on") when ticked, missing when not.
  pc_player_login: z.string().optional().transform((v) => v === "on"),
});

// Same rules as the PC app (src-tauri/src/system.rs check_target): a program or shortcut on a
// drive, or a known game launcher link. Nothing else is started.
const GAME_LINK_SCHEMES = [
  "steam", "com.epicgames.launcher", "uplay", "ubisoft", "origin", "origin2", "link2ea", "battlenet",
  "riotclient", "roblox", "roblox-player", "minecraft",
];
function gameTargetError(target: string): string | null {
  if (target.length > 300 || /["\u0000-\u001f]/.test(target)) return "is too long or has odd characters.";
  const link = /^([a-z0-9.+-]+):\/\/(.+)$/i.exec(target);
  if (link) return GAME_LINK_SCHEMES.includes(link[1].toLowerCase()) ? null : "isn't a game launcher link (steam://…, com.epicgames.launcher://…).";
  if (!/^[a-z]:\\/i.test(target) || target.includes("..")) return "must be a full path such as C:\\Games\\game.exe, or a launcher link.";
  return /\.(exe|lnk|url)$/i.test(target) ? null : "must end in .exe, .lnk or .url.";
}

const RESTRICTIONS = ["task_manager", "control_panel", "command_line", "usb_drives"] as const;

export async function savePcSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await requireRole(["owner"]);
  const parsed = pcSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // Games menu: name + target rows (ids kept, so a PC never starts the wrong game after an edit).
  const ids = formData.getAll("game_id").map(String);
  const names = formData.getAll("game_name").map((v) => String(v).trim());
  const targets = formData.getAll("game_target").map((v) => String(v).trim());
  const games: { id: string; name: string; target: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i] && !targets[i]) continue;
    if (!names[i] || names[i].length > 40) return { error: `Game ${i + 1}: give it a name of up to 40 characters.` };
    if (!targets[i]) return { error: `${names[i]}: add the program or launcher link.` };
    const problem = gameTargetError(targets[i]);
    if (problem) return { error: `${names[i]}: the link ${problem}` };
    const id = /^[a-z0-9]{6,16}$/.test(ids[i] ?? "") ? ids[i] : crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    games.push({ id, name: names[i], target: targets[i] });
  }
  if (games.length > 40) return { error: "Keep the games list to 40 or fewer." };
  const restrictions = RESTRICTIONS.filter((r) => formData.get(`restrict_${r}`) === "on");

  const supabase = await createClient();
  const { error } = await supabase
    .from("branch_settings")
    .update({ ...parsed.data, pc_games: games, pc_restrictions: restrictions })
    .eq("branch_id", branch.id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Saved. PCs pick it up within a few seconds." };
}

// Online: the player QR page on each station, and the public booking page.
const onlineSchema = z
  .object({
    qr_enabled: z.boolean(),
    qr_orders: z.boolean(),
    booking_enabled: z.boolean(),
    booking_slug: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => v || null)
      .pipe(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "The page address needs 3 to 40 letters, numbers or dashes, like cue-club-nashik.")
          .nullable(),
      ),
    booking_days: z.coerce.number().int().min(1, "At least 1 day ahead.").max(30, "Up to 30 days ahead."),
    booking_note: z
      .string()
      .trim()
      .max(300, "Keep the note under 300 characters.")
      .transform((v) => v || null),
  })
  .refine((v) => !v.booking_enabled || v.booking_slug, { message: "Choose a page address to turn bookings on." });

export async function saveOnlineSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await requireRole(["owner"]);
  const parsed = onlineSchema.safeParse({
    ...Object.fromEntries(formData),
    qr_enabled: formData.get("qr_enabled") === "on",
    qr_orders: formData.get("qr_orders") === "on",
    booking_enabled: formData.get("booking_enabled") === "on",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("branch_settings").update(parsed.data).eq("branch_id", branch.id);
  if (error?.code === "23505") return { error: "That page address is taken. Try adding your area to it." };
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Saved." };
}
