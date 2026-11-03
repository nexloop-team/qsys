"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext, requireRole } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."));
const name = z.string().trim().min(2, "Enter the player's name.").max(80);

export async function addPlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await getAppContext();
  const parsed = z.object({ phone, name }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_customer", {
    p_org_id: org.id,
    p_phone: parsed.data.phone,
    p_name: parsed.data.name,
  });
  if (error) return { error: error.code === "23505" ? error.message : friendlyDbError(error) };
  refresh();
  return { ok: "Player added." };
}

export async function updatePlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["owner"]);
  const parsed = z.object({ id: z.uuid(), phone, name }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ name: parsed.data.name, phone: parsed.data.phone })
    .eq("id", parsed.data.id);
  if (error) {
    return { error: error.code === "23505" ? "Another player already has this mobile number." : friendlyDbError(error) };
  }
  refresh();
  return { ok: "Saved." };
}
