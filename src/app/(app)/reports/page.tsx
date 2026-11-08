import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { nextDay, todayIn } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass, cx } from "@/components/styles";
import { rangeText, ReportView, type Insights, type Report } from "./report-view";
import { CustomRange } from "./custom-range";

export const metadata: Metadata = { title: "Reports" };

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

// Resolves ?range= (and ?from=&to= for custom) into an inclusive date range ending no later than today.
function resolveRange(sp: Record<string, string | string[] | undefined>, today: string) {
  const key = typeof sp.range === "string" ? sp.range : "today";
  const monthStart = `${today.slice(0, 7)}-01`;
  let from = today;
  let to = today;
  let label = "Today";
  switch (key) {
    case "7d":
      from = nextDay(today, -6);
      label = "7 days";
      break;
    case "30d":
      from = nextDay(today, -29);
      label = "30 days";
      break;
    case "month":
      from = monthStart;
      label = "This month";
      break;
    case "lastmonth":
      to = nextDay(monthStart, -1);
      from = `${to.slice(0, 7)}-01`;
      label = "Last month";
      break;
    case "custom": {
      const a = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : today;
      const b = typeof sp.to === "string" && DATE.test(sp.to) ? sp.to : today;
      to = b > today ? today : b;
      from = a > to ? to : a;
      if (daysBetween(from, to) > MAX_DAYS) from = nextDay(to, -(MAX_DAYS - 1));
      label = "Custom";
      break;
    }
  }
  const valid = PRESETS.some((p) => p.key === key) || key === "custom";
  return { key: valid ? key : "today", label, from, to, days: daysBetween(from, to) };
}

export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reports searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const { branch, role } = await getAppContext();
  if (!isOwner(role)) {
    return (
      <>
        <PageHeader title="Reports" />
        <Panel>
          <Empty icon={<Lock />} title="Reports are for the owner">
            Ask the owner if you need takings or how busy the floor has been.
          </Empty>
        </Panel>
      </>
    );
  }

  const sp = await searchParams;
  const today = todayIn(branch.timezone);
  const range = resolveRange(sp, today);
  const { from, to } = range;

  const supabase = await createClient();
  const args = { p_branch_id: branch.id, p_from: from, p_to: to };
  const prevFrom = nextDay(from, -range.days);
  const expensesBetween = (a: string, b: string) =>
    supabase.from("expenses").select("amount").eq("branch_id", branch.id).gte("spent_on", a).lte("spent_on", b);
  const [summary, insights, spent, spentBefore] = await Promise.all([
    supabase.rpc("report_summary", args),
    supabase.rpc("report_insights", args),
    expensesBetween(from, to),
    expensesBetween(prevFrom, nextDay(from, -1)),
  ]);
  const r = summary.data as Report | null;
  const x = insights.data as Insights | null;
  const error = summary.error ?? insights.error;

  const header = (
    <PageHeader
      title="Reports"
      description={`${branch.name} · ${rangeText(from, to, range.days, today)}`}
      actions={
        <>
          <a href={`/bills/export?from=${from}&to=${to}`} className={buttonClass("secondary", "sm")}>
            <Download /> Export bills
          </a>
          <CustomRange from={from} to={to} max={today} active={range.key === "custom"} />
          <nav aria-label="Period" className="swipe-row inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-subtle p-0.5">
            {PRESETS.map((v) => (
              <Link
                key={v.key}
                href={`/reports?range=${v.key}`}
                aria-current={v.key === range.key ? "page" : undefined}
                className={cx(
                  "shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                  v.key === range.key
                    ? "bg-panel text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.06)]"
                    : "text-muted hover:text-fg",
                )}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </>
      }
    />
  );

  if (error || !r || !x) {
    return (
      <>
        {header}
        <Panel>
          <p className="text-sm text-danger">Couldn&apos;t load the report. {error?.message}</p>
        </Panel>
      </>
    );
  }

  const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((t, e) => t + Number(e.amount), 0);
  const costs = { total: sum(spent.data), previous: sum(spentBefore.data) };

  return <ReportView header={header} range={range} from={from} r={r} x={x} costs={costs} />;
}
