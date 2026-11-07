import { Suspense } from "react";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/constants";
import { todayIn, zonedStart } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { ExpensesView } from "./expenses-view";
import { dueExpenses } from "@/lib/expenses-due";
import type { TeamMember } from "./expense-forms";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage(props: PageProps<"/expenses">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Expenses searchParams={props.searchParams} />
    </Suspense>
  );
}

// "2026-11" → "2026-12" (or "2026-10" with step -1).
function shiftMonth(month: string, step: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + step, 1));
  return d.toISOString().slice(0, 7);
}

async function Expenses({ searchParams }: { searchParams: PageProps<"/expenses">["searchParams"] }) {
  const { org, branch, role, user } = await getAppContext();
  if (!isOwner(role)) {
    return (
      <>
        <PageHeader title="Expenses" />
        <Panel>
          <Empty icon={<Lock />} title="Expenses are for the owner">
            Ask the venue owner to log rent, bills and salaries.
          </Empty>
        </Panel>
      </>
    );
  }

  const today = todayIn(branch.timezone);
  const current = today.slice(0, 7);
  const sp = await searchParams;
  const wanted = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : current;
  const month = wanted > current ? current : wanted;
  const next = shiftMonth(month, 1);
  const monthStart = `${month}-01`;
  const nextStart = `${next}-01`;

  const supabase = await createClient();
  const [{ data: expenses }, { data: invoices }, { data: members }, { data: salaries }, { data: recurring }] =
    await Promise.all([
    supabase
      .from("expenses")
      .select("id, category, name, amount, spent_on, staff_id, note, repeats_monthly")
      .eq("branch_id", branch.id)
      .gte("spent_on", monthStart)
      .lt("spent_on", nextStart)
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("total")
      .eq("branch_id", branch.id)
      .gte("created_at", zonedStart(monthStart, branch.timezone))
      .lt("created_at", zonedStart(nextStart, branch.timezone)),
    supabase.from("memberships").select("user_id, role").eq("org_id", org.id).order("created_at"),
    // Latest salary per person, to pre-fill next month's amount.
    supabase
      .from("expenses")
      .select("staff_id, amount")
      .eq("branch_id", branch.id)
      .eq("category", "salary")
      .not("staff_id", "is", null)
      .order("spent_on", { ascending: false })
      .limit(200),
    // Monthly costs from earlier months, newest first, to work out what's still due.
    supabase
      .from("expenses")
      .select("category, name, amount, spent_on, staff_id")
      .eq("branch_id", branch.id)
      .eq("repeats_monthly", true)
      .lt("spent_on", monthStart)
      .order("spent_on", { ascending: false })
      .limit(500),
  ]);

  const others = (members ?? []).filter((m) => m.user_id !== user.id);
  const { data: profiles } = others.length
    ? await supabase.from("profiles").select("id, full_name").in("id", others.map((m) => m.user_id))
    : { data: [] };

  const team: TeamMember[] = others.map((m) => ({
    id: m.user_id,
    name: profiles?.find((p) => p.id === m.user_id)?.full_name || "Unnamed",
    role: ROLE_LABEL[m.role],
    lastSalary: Number(salaries?.find((s) => s.staff_id === m.user_id)?.amount ?? 0) || null,
  }));

  const due = dueExpenses(expenses ?? [], recurring ?? [], new Set(team.map((m) => m.id)));

  return (
    <ExpensesView
      branchName={branch.name}
      month={month}
      prevMonth={shiftMonth(month, -1)}
      nextMonth={month < current ? next : null}
      today={today}
      revenue={(invoices ?? []).reduce((s, i) => s + Number(i.total), 0)}
      expenses={(expenses ?? []).map((e) => ({ ...e, amount: Number(e.amount) }))}
      team={team}
      due={due}
    />
  );
}
