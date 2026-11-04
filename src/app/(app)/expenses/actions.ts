"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/constants";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const expenseSchema = z
  .object({
    id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    category: z.enum(EXPENSE_CATEGORIES, "Pick a category."),
    amount: z.coerce
      .number("Enter the amount.")
      .positive("Enter an amount above ₹0.")
      .max(9_999_999, "That amount is too large."),
    spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
    staff_id: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.uuid().nullable()),
    description: z.string().trim().max(80, "Keep the description under 80 characters."),
    note: z
      .string()
      .trim()
      .max(200, "Keep the note under 200 characters.")
      .transform((v) => v || null),
    repeats_monthly: z.boolean(),
  })
  .refine((v) => v.category !== "salary" || v.staff_id, {
    message: "Pick who the salary was paid to.",
    path: ["staff_id"],
  });

// Adds an expense, or updates it when the form carries an id.
export async function saveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole(["owner"]);
  const parsed = expenseSchema.safeParse({
    id: formData.get("id") ?? "",
    repeats_monthly: formData.get("repeats_monthly") === "on",
    category: formData.get("category") ?? "",
    amount: formData.get("amount") ?? "",
    spent_on: formData.get("spent_on") ?? "",
    staff_id: formData.get("staff_id") ?? "",
    description: formData.get("description") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, category, amount, spent_on, description, note, repeats_monthly } = parsed.data;
  const staffId = category === "salary" ? parsed.data.staff_id : null;

  const supabase = await createClient();

  // Name the row so lists and the activity log read well: "Salary · Ravi", "Electricity bill".
  let name = description || EXPENSE_CATEGORY_LABEL[category];
  if (staffId) {
    const { data: member } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("org_id", org.id)
      .eq("user_id", staffId)
      .maybeSingle();
    if (!member) return { error: "That person isn't on your team any more." };
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", staffId).maybeSingle();
    name = description || `Salary · ${profile?.full_name || "Team member"}`;
  }

  const row = { category, name: name.slice(0, 80), amount, spent_on, staff_id: staffId, note, repeats_monthly };
  const { error } = id
    ? await supabase.from("expenses").update(row).eq("id", id)
    : await supabase.from("expenses").insert({ ...row, org_id: org.id, branch_id: branch.id });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: id ? "Expense updated." : "Expense saved." };
}

export async function deleteExpense(id: string): Promise<ActionState> {
  await requireRole(["owner"]);
  if (!z.uuid().safeParse(id).success) return { error: "Unknown expense." };
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return null;
}
