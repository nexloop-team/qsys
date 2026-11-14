import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Wallet } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass, cx } from "@/components/styles";
import { CloseShiftForm } from "./close-shift-form";

export const metadata: Metadata = { title: "Close shift" };

export default function ShiftPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Shift />
    </Suspense>
  );
}

type Status = {
  since: string;
  first: boolean;
  opening_float: number;
  cash_sales: number;
  cash_wallet: number;
  upi_total: number;
  expected_cash: number;
};

async function Shift() {
  const { branch } = await getAppContext();
  const supabase = await createClient();
  const [{ data: status, error }, { data: history }] = await Promise.all([
    supabase.rpc("shift_status", { p_branch_id: branch.id }),
    supabase
      .from("shift_closes")
      .select("id, closed_by, opened_at, closed_at, expected_cash, counted_cash, difference, float_left, upi_total, note")
      .eq("branch_id", branch.id)
      .order("closed_at", { ascending: false })
      .limit(30),
  ]);
  if (error || !status) return <p className="text-sm text-danger">Couldn&apos;t load the shift.</p>;
  const s = status as Status;
  const ids = [...new Set((history ?? []).map((h) => h.closed_by).filter((x): x is string => Boolean(x)))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string | null) => people?.find((p) => p.id === id)?.full_name ?? "Someone";

  const rows: [string, number][] = [
    ["Left in the drawer by the last shift", Number(s.opening_float)],
    ["Cash bills", Number(s.cash_sales)],
    ["Wallet top-ups in cash, minus refunds", Number(s.cash_wallet)],
  ];

  return (
    <>
      <Link href="/bills" className={buttonClass("ghost", "sm", "mb-3")}>
        <ArrowLeft /> Bills
      </Link>
      <PageHeader
        title="Close shift"
        description={`${branch.name} · since ${s.first ? "the start of today" : `the last close, ${formatDateTime(s.since, branch.timezone)}`}`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Expected in the drawer">
          <dl className="flex flex-col gap-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted">{label}</dt>
                <dd className="num">{formatINR(value)}</dd>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 text-base font-semibold">
              <dt>Expected cash</dt>
              <dd className="num">{formatINR(s.expected_cash)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-muted">
              <dt>UPI this shift (not in the drawer)</dt>
              <dd className="num">{formatINR(s.upi_total)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Count the drawer">
          <CloseShiftForm expected={Number(s.expected_cash)} lastFloat={Number(s.opening_float)} />
        </Panel>
      </div>

      <Panel title="Past shifts" flush className="mt-5">
        {(history ?? []).length === 0 ? (
          <Empty icon={<Wallet />} title="No shifts closed yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Closed</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                  <th className="px-4 py-2.5 text-right font-medium">Counted</th>
                  <th className="px-4 py-2.5 text-right font-medium">Difference</th>
                  <th className="px-4 py-2.5 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(history ?? []).map((h) => {
                  const d = Number(h.difference);
                  return (
                    <tr key={h.id}>
                      <td className="num whitespace-nowrap px-4 py-2.5">
                        {formatDateTime(h.closed_at, branch.timezone)}
                        {h.note && <span className="block max-w-56 truncate text-xs text-muted">{h.note}</span>}
                      </td>
                      <td className="px-4 py-2.5">{nameOf(h.closed_by)}</td>
                      <td className="num px-4 py-2.5 text-right">{formatINR(h.expected_cash)}</td>
                      <td className="num px-4 py-2.5 text-right">{formatINR(h.counted_cash)}</td>
                      <td className={cx("num px-4 py-2.5 text-right font-medium", d === 0 ? "text-free" : d < 0 ? "text-over" : "text-ending")}>
                        {d === 0 ? "matched" : `${d < 0 ? "−" : "+"}${formatINR(Math.abs(d))}`}
                      </td>
                      <td className="num px-4 py-2.5 text-right text-muted">{formatINR(h.float_left)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
