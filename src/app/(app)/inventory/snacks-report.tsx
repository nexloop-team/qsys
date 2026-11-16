import Link from "next/link";
import { formatINR } from "@/lib/format";
import { Panel } from "@/components/card";
import { cx } from "@/components/styles";

// What report_snacks returns (see 20261203000001_snacks_cost_writeoffs.sql).
export type SnacksReport = {
  items: { id: string; name: string; category: string; qty: number; sales: number; cost: number | null; profit: number | null }[];
  totals: { qty: number; sales: number; cost: number; profit: number; costed_sales: number };
  losses: { reason: LossReason; qty: number; value: number; some_uncosted: boolean }[];
};

export type LossReason = "broken" | "expired" | "staff" | "free" | "missing";

export const LOSS_LABEL: Record<LossReason, string> = {
  broken: "Broken or spilled",
  expired: "Expired",
  staff: "Used by staff",
  free: "Given free",
  missing: "Missing",
};

// Reports: snacks and drinks for the period. Sales, what they cost, profit per item, and losses.
export function SnacksReportPanel({ report, gst }: { report: SnacksReport; gst: boolean }) {
  const { totals, items, losses } = report;
  if (Number(totals.qty) === 0 && losses.length === 0) return null;
  const lost = losses.reduce((t, l) => t + Number(l.value), 0);
  const uncosted = Number(totals.sales) - Number(totals.costed_sales);
  return (
    <Panel
      title="Snacks and drinks"
      description={`Menu items on paid bills${gst ? ", before GST" : ""} and before bill discounts.`}
      action={
        <Link href="/inventory/history" className="text-xs font-medium text-muted underline-offset-4 hover:text-fg hover:underline">
          Stock history
        </Link>
      }
      flush
    >
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Cell label="Sold" value={formatINR(Number(totals.sales))} sub={`${totals.qty} items`} />
        <Cell label="Bought for" value={formatINR(Number(totals.cost))} sub={uncosted > 0 ? `${formatINR(uncosted)} of sales have no buying price` : "Buying price of what sold"} />
        <Cell
          label="Profit"
          value={formatINR(Number(totals.profit))}
          sub={Number(totals.costed_sales) > 0 ? `${Math.round((Number(totals.profit) / Number(totals.costed_sales)) * 100)}% of sales` : "Add buying prices to see it"}
        />
        <Cell label="Lost" value={formatINR(lost)} sub={losses.length ? losses.map((l) => `${l.qty} ${LOSS_LABEL[l.reason].toLowerCase()}`).join(", ") : "Nothing written off"} over={lost > 0} />
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 text-right font-medium">Sold</th>
                <th className="px-4 py-2.5 text-right font-medium">Sales</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                <th className="px-4 py-2.5 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 15).map((it) => (
                <tr key={it.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{it.name}</td>
                  <td className="num px-4 py-2.5 text-right">{it.qty}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(Number(it.sales))}</td>
                  <td className="num px-4 py-2.5 text-right">
                    {it.cost === null ? <span className="text-xs text-faint">Not set</span> : formatINR(Number(it.cost))}
                  </td>
                  <td className={cx("num px-4 py-2.5 text-right font-semibold", it.profit !== null && it.profit < 0 && "text-over")}>
                    {it.profit === null ? <span className="text-xs font-normal text-faint">-</span> : formatINR(Number(it.profit))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 15 && <p className="px-4 py-2.5 text-xs text-muted">Top 15 of {items.length} items by sales.</p>}
        </div>
      )}
    </Panel>
  );
}

function Cell({ label, value, sub, over }: { label: string; value: string; sub: string; over?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 bg-panel px-4 py-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className={cx("num text-lg font-semibold", over && "text-over")}>{value}</span>
      <span className="text-xs text-muted">{sub}</span>
    </div>
  );
}
