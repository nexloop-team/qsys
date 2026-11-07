import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, Printer, ReceiptText, Search } from "lucide-react";
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
// Same hues as the payment mix in Reports (UPI blue, cash orange); text stays readable.
const METHOD_CHIP = {
  upi: "bg-series-1/12 text-fg",
  cash: "bg-series-2/14 text-fg",
  card: "bg-subtle text-muted",
} as const;

async function Bills({ searchParams }: { searchParams: PageProps<"/bills">["searchParams"] }) {
  const { branch, role } = await getAppContext();
  const sp = await searchParams;
  const today = todayIn(branch.timezone);
  const wanted = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const date = wanted > today ? today : wanted;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";

  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, number, created_at, customer_name, total, gst_enabled, cgst, sgst, invoice_lines(description), payments(method, amount)")
    .eq("branch_id", branch.id)
    .gte("created_at", zonedStart(date, branch.timezone))
    .lt("created_at", zonedStart(nextDay(date), branch.timezone))
    .order("created_at", { ascending: false });

  const all = invoices ?? [];
  // Search the day's bills by number, player, or station on any line.
  const needle = q.toLowerCase();
  const list = needle
    ? all.filter(
        (i) =>
          i.number.toLowerCase().includes(needle) ||
          (i.customer_name ?? "").toLowerCase().includes(needle) ||
          i.invoice_lines.some((l) => l.description.toLowerCase().includes(needle)),
      )
    : all;
  // Day totals always cover every bill, whatever the search.
  const total = all.reduce((s, i) => s + Number(i.total), 0);
  const byMethod = all
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
        <Metric label="Bills" value={all.length} sub={all.length ? `Average ${formatINR(Math.round(total / all.length))}` : undefined} />
        <Metric label="Cash" value={formatINR(byMethod.cash ?? 0)} sub={total ? `${Math.round(((byMethod.cash ?? 0) / total) * 100)}% of takings` : undefined} />
        <Metric label="UPI" value={formatINR(byMethod.upi ?? 0)} sub={total ? `${Math.round(((byMethod.upi ?? 0) / total) * 100)}% of takings` : undefined} />
      </div>

      <Panel flush>
        {/* Plain GET form: works before JavaScript loads, keeps the date. */}
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3" role="search">
          <input type="hidden" name="date" value={date} />
          <label className="relative min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Search bills</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Bill no., player or station"
              className="h-9 w-full rounded-lg border border-line-strong bg-panel pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
          {q && (
            <Link href={`/bills?date=${date}`} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
          <span className="num ml-auto text-xs text-muted">
            {q ? `${list.length} of ${all.length} bills` : `${all.length} bill${all.length === 1 ? "" : "s"}`}
          </span>
        </form>
        {list.length === 0 ? (
          <Empty icon={<ReceiptText />} title={q ? "No bills match" : "No bills on this day"} />
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
                  <th className="w-12 px-2 py-2.5">
                    <span className="sr-only">Print</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((inv) => (
                  <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/bills/${inv.id}`} className="num font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="num px-4 py-2.5 text-muted">{formatTime(inv.created_at, branch.timezone)}</td>
                    <td className="max-w-[260px] truncate px-4 py-2.5">
                      {inv.invoice_lines.map((l) => l.description).join(", ")}
                      {inv.customer_name && <span className="text-muted"> · {inv.customer_name}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {[...new Set(inv.payments.map((p) => p.method))].map((m) => (
                          <span key={m} className={`rounded-md px-1.5 py-px text-xs font-medium ${METHOD_CHIP[m]}`}>
                            {METHOD_LABEL[m]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{formatINR(inv.total)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <Link
                        href={`/bills/${inv.id}`}
                        aria-label={`Open bill ${inv.number} to print`}
                        title="Open to print"
                        className="inline-grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-fg"
                      >
                        <Printer className="size-4" />
                      </Link>
                    </td>
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
