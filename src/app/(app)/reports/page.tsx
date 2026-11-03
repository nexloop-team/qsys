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

export const metadata: Metadata = { title: "Reports" };

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
] as const;

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
            Ask the venue owner if you need takings or utilisation numbers.
          </Empty>
        </Panel>
      </>
    );
  }

  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[0];
  const to = todayIn(branch.timezone);
  const from = nextDay(to, -(range.days - 1));

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
      description={`${branch.name} · ${rangeText(from, to, range.days)}`}
      actions={
        <>
          <a href={`/bills/export?from=${from}&to=${to}`} className={buttonClass("secondary", "sm")}>
            <Download /> Export bills
          </a>
          <nav aria-label="Period" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
            {RANGES.map((v) => (
              <Link
                key={v.key}
                href={`/reports?range=${v.key}`}
                aria-current={v.key === range.key ? "page" : undefined}
                className={cx(
                  "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
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
