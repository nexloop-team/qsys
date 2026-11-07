import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ExpenseCategory } from "@/lib/constants";

type Row = { category: ExpenseCategory; name: string; amount: number; spent_on: string; staff_id: string | null };

export type DueExpense = {
  key: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  staff_id: string | null;
  lastPaid: string;
};

// Same cost = same category + person + name, so "Rent" and "Salary · Ravi" each count once.
const keyOf = (e: { category: string; staff_id: string | null; name: string }) =>
  `${e.category}|${e.staff_id ?? ""}|${e.name.trim().toLowerCase()}`;

// Monthly costs logged before this month (newest first) that aren't logged this month yet.
// A salary for someone no longer on the team is not due.
export function dueExpenses(
  thisMonth: { category: string; staff_id: string | null; name: string }[],
  recurring: Row[],
  teamIds: Set<string>,
): DueExpense[] {
  const logged = new Set(thisMonth.map(keyOf));
  const due: DueExpense[] = [];
  for (const e of recurring) {
    const key = keyOf(e);
    if (logged.has(key) || due.some((d) => d.key === key)) continue;
    if (e.category === "salary" && (!e.staff_id || !teamIds.has(e.staff_id))) continue;
    due.push({ key, category: e.category, name: e.name, amount: Number(e.amount), staff_id: e.staff_id, lastPaid: e.spent_on });
  }
  return due;
}

// How many monthly costs are still due this month (the sidebar badge).
export async function countDueExpenses(
  supabase: SupabaseClient<Database>,
  orgId: string,
  branchId: string,
  monthStart: string,
) {
  const [{ data: thisMonth }, { data: recurring }, { data: members }] = await Promise.all([
    supabase.from("expenses").select("category, staff_id, name").eq("branch_id", branchId).gte("spent_on", monthStart),
    supabase
      .from("expenses")
      .select("category, name, amount, spent_on, staff_id")
      .eq("branch_id", branchId)
      .eq("repeats_monthly", true)
      .lt("spent_on", monthStart)
      .order("spent_on", { ascending: false })
      .limit(500),
    supabase.from("memberships").select("user_id").eq("org_id", orgId),
  ]);
  return dueExpenses(thisMonth ?? [], recurring ?? [], new Set((members ?? []).map((m) => m.user_id))).length;
}
