"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const schema = z.object({
  counted: z.coerce.number({ message: "Enter the cash you counted." }).min(0, "Enter the cash you counted.").max(10000000),
  float_left: z.coerce.number().min(0, "The cash left can't be negative.").default(0),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").default(""),
});

// Anyone on the team can close the shift they ran.
export async function closeShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { branch } = await getAppContext();
  const parsed = schema.safeParse({
    counted: String(formData.get("counted") ?? "").trim() || undefined,
    float_left: String(formData.get("float_left") ?? "").trim() || 0,
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_shift", {
    p_branch_id: branch.id,
    p_counted: parsed.data.counted,
    p_float_left: parsed.data.float_left,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Shift closed." };
}
