import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, formatTime, nextDay, todayIn, zonedStart } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel, Stat } from "@/components/card";
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
  const { branch } = await getAppContext();
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(branch.timezone);

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
      <PageHeader title="Bills" actions={<DatePicker value={date} />} />

      <Panel flush className="mb-5">
        <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          <Stat label="Collected" value={formatINR(total)} />
          <Stat label="Bills" value={list.length} />
          <Stat label="Cash" value={formatINR(byMethod.cash ?? 0)} />
          <Stat label="UPI" value={formatINR(byMethod.upi ?? 0)} />
        </div>
      </Panel>

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
                      <Link href={`/bills/${inv.id}`} className="num font-medium underline-offset-4 hover:underline">
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
