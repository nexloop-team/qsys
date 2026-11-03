"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/constants";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const expenseSchema = z
  .object({
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
  })
  .refine((v) => v.category !== "salary" || v.staff_id, {
    message: "Pick who the salary was paid to.",
    path: ["staff_id"],
  });

export async function addExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole(["owner"]);
  const parsed = expenseSchema.safeParse({
    category: formData.get("category") ?? "",
    amount: formData.get("amount") ?? "",
    spent_on: formData.get("spent_on") ?? "",
    staff_id: formData.get("staff_id") ?? "",
    description: formData.get("description") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { category, amount, spent_on, description, note } = parsed.data;
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

  const { error } = await supabase.from("expenses").insert({
    org_id: org.id,
    branch_id: branch.id,
    category,
    name: name.slice(0, 80),
    amount,
    spent_on,
    staff_id: staffId,
    note,
  });
  if (error) return { error: friendlyDbError(error) };

  refresh();
  return { ok: "Expense saved." };
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
