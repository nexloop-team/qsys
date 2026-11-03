import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, ReceiptText } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, formatTime, nextDay, todayIn, zonedStart } from "@/lib/format";
import { Empty, Metric, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { DatePicker } from "./date-picker";

export const metadata: Metadata = { title: "Bills" };

export default function BillsPage(props: PageProps<"/bills">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Bills searchParams={props.searchParams} />
    </Suspense>
  );
}

// "card" only appears on old bills; checkout offers cash and UPI.
const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card" } as const;

async function Bills({ searchParams }: { searchParams: PageProps<"/bills">["searchParams"] }) {
  const { branch, role } = await getAppContext();
  const sp = await searchParams;
  const today = todayIn(branch.timezone);
  const wanted = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const date = wanted > today ? today : wanted;

  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, number, created_at, customer_name, total, gst_enabled, cgst, sgst, invoice_lines(description), payments(method, amount)")
    .eq("branch_id", branch.id)
    .gte("created_at", zonedStart(date, branch.timezone))
    .lt("created_at", zonedStart(nextDay(date), branch.timezone))
    .order("created_at", { ascending: false });

  const list = invoices ?? [];
  const total = list.reduce((s, i) => s + Number(i.total), 0);
  const byMethod = list
    .flatMap((i) => i.payments)
    .reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.method]: (acc[p.method] ?? 0) + Number(p.amount) }), {});

  return (
    <>
      <PageHeader
        title="Bills"
        description={`${branch.name} · ${date === today ? "today" : new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`}
        actions={
          <>
            {isOwner(role) && (
              <a href={`/bills/export?from=${date}&to=${date}`} className={buttonClass("secondary", "md")}>
                <Download /> Export
              </a>
            )}
            <DatePicker value={date} max={today} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Metric label="Collected" value={formatINR(total)} />
        <Metric label="Bills" value={list.length} sub={list.length ? `Average ${formatINR(Math.round(total / list.length))}` : undefined} />
        <Metric label="Cash" value={formatINR(byMethod.cash ?? 0)} sub={total ? `${Math.round(((byMethod.cash ?? 0) / total) * 100)}% of takings` : undefined} />
        <Metric label="UPI" value={formatINR(byMethod.upi ?? 0)} sub={total ? `${Math.round(((byMethod.upi ?? 0) / total) * 100)}% of takings` : undefined} />
      </div>

      <Panel flush>
        {list.length === 0 ? (
          <Empty icon={<ReceiptText />} title="No bills on this day" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Bill</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">For</th>
                  <th className="px-4 py-2.5 font-medium">Paid by</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {list.map((inv) => (
                  <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/bills/${inv.id}`} className="num font-medium text-accent-ink underline-offset-4 hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="num px-4 py-2.5 text-muted">{formatTime(inv.created_at, branch.timezone)}</td>
                    <td className="max-w-[260px] truncate px-4 py-2.5">
                      {inv.invoice_lines.map((l) => l.description).join(", ")}
                      {inv.customer_name && <span className="text-muted"> · {inv.customer_name}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {[...new Set(inv.payments.map((p) => METHOD_LABEL[p.method]))].join(" + ")}
                    </td>
                    <td className="num px-4 py-2.5 text-right font-medium">{formatINR(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
