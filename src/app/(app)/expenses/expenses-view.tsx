import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, ReceiptIndianRupee, Repeat } from "lucide-react";
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Empty, Metric, PageHeader, Panel } from "@/components/card";
import { AddExpenseButton, DeleteExpenseButton, EditExpenseButton, type TeamMember } from "./expense-forms";
import { CATEGORY_ICON } from "./category-icons";
import type { DueExpense } from "@/lib/expenses-due";

export type ExpenseRow = {
  id: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  spent_on: string;
  staff_id: string | null;
  note: string | null;
  repeats_monthly: boolean;
};

export type { DueExpense } from "@/lib/expenses-due";

// Pure view for /expenses: a month of spending against that month's revenue.
export function ExpensesView({
  branchName,
  month,
  prevMonth,
  nextMonth,
  today,
  revenue,
  expenses,
  team,
  due = [],
}: {
  branchName: string;
  month: string; // YYYY-MM
  prevMonth: string;
  nextMonth: string | null; // null when `month` is the current month
  today: string;
  revenue: number;
  expenses: ExpenseRow[];
  team: TeamMember[];
  due?: DueExpense[];
}) {
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const salaries = expenses.filter((e) => e.category === "salary").reduce((s, e) => s + Number(e.amount), 0);
  const net = revenue - total;
  const margin = revenue > 0 ? Math.round((net / revenue) * 100) : null;

  const byCategory = Object.entries(
    expenses.reduce<Partial<Record<ExpenseCategory, number>>>(
      (acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + Number(e.amount) }),
      {},
    ),
  )
    .map(([category, amount]) => ({ category: category as ExpenseCategory, amount: amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount);

  const paidThisMonth = (id: string) =>
    expenses.filter((e) => e.staff_id === id).reduce((s, e) => s + Number(e.amount), 0);

  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`${branchName} · rent, bills, salaries and other costs`}
        actions={
          <>
            <nav aria-label="Month" className="inline-flex items-center rounded-lg border border-line bg-panel shadow-xs">
              <Link href={`/expenses?month=${prevMonth}`} className="rounded-l-lg p-2 text-muted hover:bg-hover hover:text-fg" aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-32 border-x border-line px-3 text-center text-[13px] font-medium">{monthName}</span>
              {nextMonth ? (
                <Link href={`/expenses?month=${nextMonth}`} className="rounded-r-lg p-2 text-muted hover:bg-hover hover:text-fg" aria-label="Next month">
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <span className="p-2 text-faint/50" aria-hidden>
                  <ChevronRight className="size-4" />
                </span>
              )}
            </nav>
            <AddExpenseButton team={team} today={today} />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Metric label="Revenue" value={formatINR(revenue)} sub="From bills this month" />
          <Metric
            label="Expenses"
            value={formatINR(total)}
            sub={`${expenses.length} entr${expenses.length === 1 ? "y" : "ies"}`}
          />
          <Metric label="Salaries" value={formatINR(salaries)} sub={total ? `${Math.round((salaries / total) * 100)}% of expenses` : "None logged"} />
          <Metric
            label="Net profit"
            value={formatINR(net)}
            tone={net < 0 ? "over" : net > 0 ? "ok" : undefined}
            sub={margin === null ? "No revenue yet" : `${margin}% margin`}
          />
        </div>

        {due.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <CalendarClock className="size-4 text-ending" /> Due this month
                <span className="num rounded-full bg-ending/12 px-1.5 text-xs text-ending">{due.length}</span>
              </span>
            }
            description={`Monthly costs not logged yet · ${formatINR(due.reduce((t, d) => t + d.amount, 0))} in total`}
            flush
          >
            <ul className="divide-y divide-line">
              {due.map((d) => {
                const Icon = CATEGORY_ICON[d.category];
                return (
                  <li key={d.key} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-ending/30 bg-ending/8 text-ending">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {EXPENSE_CATEGORY_LABEL[d.category]} · last {formatINR(d.amount)} on {dayLabel(d.lastPaid)}
                      </span>
                    </span>
                    <AddExpenseButton
                      team={team}
                      today={today}
                      preset={{
                        category: d.category,
                        staffId: d.staff_id ?? undefined,
                        amount: d.amount,
                        description: d.name,
                        repeats: true,
                      }}
                      label="Log"
                      variant="secondary"
                      size="sm"
                    />
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
          <div className="flex flex-col gap-5">
            <Panel
              title="Team salaries"
              description={team.length ? `Paid in ${monthName.split(" ")[0]}` : undefined}
              flush
            >
              {team.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  No staff yet.{" "}
                  <Link href="/settings/team" className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                    Invite your team
                  </Link>{" "}
                  to track their salaries here.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {team.map((m) => {
                    const paid = paidThisMonth(m.id);
                    return (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">
                          {m.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="block text-xs text-muted">
                            {paid > 0 ? (
                              <span className="text-ok">Paid {formatINR(paid)}</span>
                            ) : (
                              "Not paid yet"
                            )}
                            {m.lastSalary && paid === 0 ? ` · last ${formatINR(m.lastSalary)}` : ""}
                          </span>
                        </span>
                        <AddExpenseButton
                          team={team}
                          today={today}
                          preset={{ category: "salary", staffId: m.id, amount: m.lastSalary ?? undefined }}
                          label="Salary"
                          variant="secondary"
                          size="sm"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Where it went" flush>
              {byCategory.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Nothing logged this month.</p>
              ) : (
                <ul className="flex flex-col gap-3 p-4">
                  {byCategory.map(({ category, amount }) => {
                    const Icon = CATEGORY_ICON[category];
                    const pct = total ? (amount / total) * 100 : 0;
                    return (
                      <li key={category}>
                        <div className="mb-1.5 flex items-center gap-2 text-sm">
                          <Icon className="size-4 text-faint" />
                          <span className="flex-1">{EXPENSE_CATEGORY_LABEL[category]}</span>
                          <span className="num text-xs text-muted">{Math.round(pct)}%</span>
                          <span className="num w-24 text-right font-medium">{formatINR(amount)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-chart/15">
                          <div className="h-full rounded-full bg-chart" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="All expenses" description={monthName} flush>
            {expenses.length === 0 ? (
              <Empty icon={<ReceiptIndianRupee />} title="No expenses this month">
                Log rent, power, internet, salaries and other costs to see your real profit in Reports.
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {expenses.map((e) => {
                  const Icon = CATEGORY_ICON[e.category];
                  return (
                    <li key={e.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-subtle/60">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-subtle text-muted">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {e.name}
                          {e.repeats_monthly && (
                            <Repeat className="size-3 shrink-0 text-faint" aria-label="Repeats monthly" />
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {EXPENSE_CATEGORY_LABEL[e.category]} · {dayLabel(e.spent_on)}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </span>
                      <span className="num text-sm font-semibold">{formatINR(e.amount)}</span>
                      <span className="flex items-center">
                        <EditExpenseButton expense={e} team={team} today={today} />
                        <DeleteExpenseButton id={e.id} name={e.name} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <p className="text-xs text-muted">
          Net profit = revenue from bills − expenses logged here. See it by day and period in{" "}
          <Link href="/reports" className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
            Reports
          </Link>
          .
        </p>
      </div>
    </>
  );
}

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
