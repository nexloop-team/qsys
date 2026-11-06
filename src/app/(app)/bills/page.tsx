import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, ReceiptText } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, formatTime, nextDay, todayIn, zonedStart } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
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

// "card" only appears on old bills; checkout offers cash, UPI, and wallet.
const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet" } as const;

async function Bills({ searchParams }: { searchParams: PageProps<"/bills">["searchParams"] }) {
  const { branch, org, role } = await getAppContext();
  const sp = await searchParams;
  const today = todayIn(branch.timezone);
  const wanted = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const date = wanted > today ? today : wanted;

  const supabase = await createClient();
  const dayStart = zonedStart(date, branch.timezone);
  const dayEnd = zonedStart(nextDay(date), branch.timezone);
  const [{ data: invoices }, { data: walletMoves }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, created_at, customer_name, total, gst_enabled, cgst, sgst, voided_at, invoice_lines(description), payments(method, amount)")
      .eq("branch_id", branch.id)
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd)
      .order("created_at", { ascending: false }),
    // Wallet top-ups and refunds move real cash/UPI without a bill.
    supabase
      .from("wallet_transactions")
      .select("amount, method")
      .eq("org_id", org.id)
      .in("method", ["cash", "upi"])
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd),
  ]);

  const list = invoices ?? [];
  // Cancelled bills stay listed (struck through) but count nowhere.
  const live = list.filter((i) => !i.voided_at);
  const total = live.reduce((s, i) => s + Number(i.total), 0);
  const byMethod = live
    .flatMap((i) => i.payments)
    .reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.method]: (acc[p.method] ?? 0) + Number(p.amount) }), {});
  const walletIn = (m: string) =>
    (walletMoves ?? []).filter((w) => w.method === m).reduce((t, w) => t + Number(w.amount), 0);
  const topups = (walletMoves ?? []).filter((w) => Number(w.amount) > 0).reduce((t, w) => t + Number(w.amount), 0);
  // What should be in the drawer from today: cash bills + cash top-ups − cash refunds.
  const cashInDrawer = (byMethod.cash ?? 0) + walletIn("cash");

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

      <Panel flush className="mb-5">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-muted">
              Billed · {live.length} bill{live.length === 1 ? "" : "s"}
              {list.length > live.length && ` · ${list.length - live.length} cancelled`}
            </dt>
            <dd className="num text-xl font-semibold">{formatINR(total)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Cash in drawer</dt>
            <dd className="num text-xl font-semibold">{formatINR(cashInDrawer)}</dd>
          </div>
          <div className="flex items-end gap-x-5 text-muted">
            <span>
              UPI <span className="num font-medium text-fg">{formatINR((byMethod.upi ?? 0) + walletIn("upi"))}</span>
            </span>
            {(byMethod.wallet ?? 0) > 0 && (
              <span>
                From wallets <span className="num font-medium text-fg">{formatINR(byMethod.wallet ?? 0)}</span>
              </span>
            )}
            {topups > 0 && (
              <span>
                Wallet top-ups <span className="num font-medium text-fg">{formatINR(topups)}</span>
              </span>
            )}
          </div>
        </dl>
        {(walletMoves ?? []).length > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Cash and UPI include wallet top-ups and refunds, which have no bill. Wallet payments are not new money.
          </p>
        )}
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
                  <tr
                    key={inv.id}
                    className={`border-b border-line last:border-0 hover:bg-subtle/60 ${inv.voided_at ? "text-muted line-through" : ""}`}
                  >
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
