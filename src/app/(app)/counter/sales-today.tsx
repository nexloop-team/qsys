"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatINR, formatTime, todayIn, zonedStart } from "@/lib/format";
import { Button, cx } from "@/components/ui";

type Supa = SupabaseClient<Database>;

type Bill = {
  id: string;
  number: string;
  total: number;
  created_at: string;
  voided_at: string | null;
  customer_name: string | null;
  invoice_lines: { description: string; session_id: string | null; product_id: string | null; quantity: number | null; amount: number }[];
  payments: { method: string; amount: number }[];
};
type StationSnack = { name: string; quantity: number; price: number; product_id: string | null };
type Data = { bills: Bill[]; stationSnacks: StationSnack[] };

const METHOD: Record<string, string> = { cash: "Cash", upi: "UPI", wallet: "Wallet" };

// Today at the counter: what came in and how, what sold, and every counter bill. Snacks put on
// station bills are counted in "what sold" (they are paid with the station at checkout).
export function SalesToday({ supabase, branchId, timezone, refreshKey }: {
  supabase: Supa;
  branchId: string;
  timezone: string;
  /** Changes after each sale, to reload. */
  refreshKey: number;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string>();
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let ignore = false;
    const start = zonedStart(todayIn(timezone), timezone);
    void Promise.all([
      supabase
        .from("invoices")
        .select(
          "id, number, total, created_at, voided_at, customer_name, invoice_lines(description, session_id, product_id, quantity, amount), payments(method, amount)",
        )
        .eq("branch_id", branchId)
        .gte("created_at", start)
        .order("created_at", { ascending: false }),
      supabase
        .from("session_items")
        .select("name, quantity, price, product_id, sessions!inner(branch_id)")
        .eq("sessions.branch_id", branchId)
        .gte("created_at", start),
    ]).then(([bills, snacks]) => {
      if (ignore) return;
      if (bills.error || snacks.error) return setError((bills.error ?? snacks.error)?.message);
      setError(undefined);
      setData({
        // Counter bills: nothing from a station on them.
        bills: ((bills.data ?? []) as unknown as Bill[]).filter(
          (b) => b.invoice_lines.length > 0 && b.invoice_lines.every((l) => !l.session_id),
        ),
        stationSnacks: (snacks.data ?? []) as unknown as StationSnack[],
      });
    });
    return () => {
      ignore = true;
    };
  }, [supabase, branchId, timezone, refreshKey, reloads]);

  if (error) return <p className="text-sm text-danger">Couldn&apos;t load today&apos;s sales. {error}</p>;
  if (!data) return <p className="py-10 text-center text-sm text-muted">Loading today&apos;s sales…</p>;

  const live = data.bills.filter((b) => !b.voided_at);
  const takings = live.reduce((t, b) => t + Number(b.total), 0);
  const byMethod = new Map<string, number>();
  for (const b of live) for (const p of b.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
  const stationTotal = data.stationSnacks.reduce((t, s) => t + Number(s.price) * s.quantity, 0);

  // What sold, from the counter and onto station bills, by item.
  const items = new Map<string, { name: string; qty: number; amount: number }>();
  const add = (k: string, name: string, qty: number, amount: number) => {
    const row = items.get(k) ?? { name, qty: 0, amount: 0 };
    row.qty += qty;
    row.amount += amount;
    items.set(k, row);
  };
  for (const b of live) {
    for (const l of b.invoice_lines) {
      const qty = l.quantity ?? 1;
      const name = l.description.replace(/ × \d+$/, "");
      add(l.product_id ?? `name:${name}`, name, qty, Number(l.amount));
    }
  }
  for (const s of data.stationSnacks) add(s.product_id ?? `name:${s.name}`, s.name, s.quantity, Number(s.price) * s.quantity);
  const sold = [...items.values()].sort((a, b) => b.amount - a.amount);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Today, from midnight.</p>
        <Button variant="ghost" size="sm" onClick={() => setReloads((n) => n + 1)}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-4">
        <Stat label="Counter sales" value={formatINR(takings)} sub={`${live.length} ${live.length === 1 ? "bill" : "bills"}`} />
        <Stat label="Cash" value={formatINR(byMethod.get("cash") ?? 0)} sub="In the drawer from the counter" />
        <Stat
          label="UPI and wallet"
          value={formatINR((byMethod.get("upi") ?? 0) + (byMethod.get("wallet") ?? 0))}
          sub={`UPI ${formatINR(byMethod.get("upi") ?? 0)} · wallet ${formatINR(byMethod.get("wallet") ?? 0)}`}
        />
        <Stat label="On station bills" value={formatINR(stationTotal)} sub="Paid with the station at checkout" />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="rounded-xl border border-line bg-panel shadow-card">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">What sold</h2>
          {sold.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Nothing sold yet today.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {sold.map((r) => (
                <li key={r.name} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="num w-10 text-right text-muted">× {r.qty}</span>
                  <span className="num w-20 text-right font-semibold">{formatINR(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-panel shadow-card">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Counter bills</h2>
          {data.bills.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No counter bills yet today.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.bills.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}?from=counter`}
                    className={cx("flex items-start gap-3 px-4 py-2.5 hover:bg-hover", b.voided_at && "opacity-60")}
                  >
                    <span className="num w-16 shrink-0 pt-px text-xs text-muted">{formatTime(b.created_at, timezone)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        #{b.number}
                        {b.customer_name ? ` · ${b.customer_name}` : ""}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {b.invoice_lines.map((l) => l.description).join(", ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cx("num block font-semibold", b.voided_at && "line-through")}>{formatINR(b.total)}</span>
                      <span className="block text-xs text-muted">
                        {b.voided_at ? "Cancelled" : b.payments.map((p) => METHOD[p.method] ?? p.method).join(" + ") || "Free"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-panel px-4 py-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="num text-lg font-semibold">{value}</span>
      <span className="truncate text-xs text-muted">{sub}</span>
    </div>
  );
}
