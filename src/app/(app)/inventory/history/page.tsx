import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { History, Lock } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, formatTime, todayIn } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { cx } from "@/components/styles";
import { InventoryTabs } from "../inventory-tabs";
import { LOSS_LABEL } from "../snacks-report";

export const metadata: Metadata = { title: "Stock history" };

const REASON_LABEL: Record<string, string> = {
  sale: "Sold",
  return: "Taken off a bill",
  void: "Bill cancelled, back on the shelf",
  receive: "Arrived",
  count: "Shelf count",
  start: "Started counting",
  ...LOSS_LABEL,
};

const KINDS = {
  all: { label: "All", reasons: null },
  arrived: { label: "Arrived", reasons: ["receive", "start"] },
  sold: { label: "Sold", reasons: ["sale", "return", "void"] },
  lost: { label: "Written off", reasons: Object.keys(LOSS_LABEL) },
  counts: { label: "Shelf counts", reasons: ["count"] },
} as const;
type Kind = keyof typeof KINDS;

const LIMIT = 300;

export default function StockHistoryPage(props: PageProps<"/inventory/history">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockHistory searchParams={props.searchParams} />
    </Suspense>
  );
}

async function StockHistory({ searchParams }: { searchParams: PageProps<"/inventory/history">["searchParams"] }) {
  const sp = await searchParams;
  const { branch, role } = await getAppContext();
  const header = (
    <>
      <PageHeader title="Snacks & drinks" description="Every delivery, sale, write-off and shelf count, with who did it." />
      <InventoryTabs active="history" />
    </>
  );
  if (!isOwner(role)) {
    return (
      <>
        {header}
        <Panel>
          <Empty icon={<Lock />} title="Stock history is for the owner" />
        </Panel>
      </>
    );
  }

  const kind: Kind = typeof sp.kind === "string" && sp.kind in KINDS ? (sp.kind as Kind) : "all";
  const item = typeof sp.item === "string" ? sp.item : undefined;
  const supabase = await createClient();

  // Owner-only in the database too: buying prices aren't readable by staff.
  const reasons = KINDS[kind].reasons;
  const { data: moves, error } = await supabase.rpc("stock_history", {
    p_branch_id: branch.id,
    p_reasons: reasons ? [...reasons] : undefined,
    p_product_id: item,
    p_limit: LIMIT,
  });

  const rows = moves ?? [];
  const ids = [...new Set(rows.map((m) => m.created_by).filter((v): v is string => Boolean(v)))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const who = (id: string | null) => (id && people?.find((p) => p.id === id)?.full_name) || "";

  const itemName = item ? rows[0]?.product_name : undefined;
  const href = (k: Kind, it?: string) => {
    const q = new URLSearchParams();
    if (k !== "all") q.set("kind", k);
    if (it) q.set("item", it);
    const s = q.toString();
    return `/inventory/history${s ? `?${s}` : ""}`;
  };

  // Newest first, under a heading for each day.
  const today = todayIn(branch.timezone);
  const yesterday = todayIn(branch.timezone, -1);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: branch.timezone }).format(new Date(iso));
  const dayLabel = (d: string) =>
    d === today
      ? "Today"
      : d === yesterday
        ? "Yesterday"
        : new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
            new Date(`${d}T00:00:00Z`),
          );
  const days: { day: string; rows: typeof rows }[] = [];
  for (const m of rows) {
    const d = dayOf(m.created_at);
    if (days.at(-1)?.day !== d) days.push({ day: d, rows: [] });
    days.at(-1)!.rows.push(m);
  }

  return (
    <>
      {header}
      {itemName && <p className="-mt-1 mb-3 text-sm font-semibold">{itemName}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Show" className="swipe-row flex max-w-full gap-1.5 overflow-x-auto">
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <Link
              key={k}
              href={href(k, item)}
              aria-current={k === kind ? "page" : undefined}
              className={cx(
                "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                k === kind ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {KINDS[k].label}
            </Link>
          ))}
        </nav>
        {item && (
          <Link href={href(kind)} className="text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline">
            Show every item
          </Link>
        )}
      </div>

      {error ? (
        <Panel>
          <p className="text-sm text-danger">Couldn&apos;t load the history. {error.message}</p>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <Empty icon={<History />} title="Nothing here yet">
            Deliveries, sales of counted items, write-offs and shelf counts show up here.
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map(({ day, rows: list }) => (
            <Panel key={day} title={dayLabel(day)} flush>
              <ul className="divide-y divide-line text-sm">
                {list.map((m) => {
                  const loss = m.reason in LOSS_LABEL || (m.reason === "count" && m.delta < 0);
                  const value = m.value !== null ? Number(m.value) : null;
                  const person = who(m.created_by);
                  return (
                    <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="num w-16 shrink-0 pt-px text-xs text-muted">{formatTime(m.created_at, branch.timezone)}</span>
                      <span className="min-w-0 flex-1">
                        <Link href={href(kind, m.product_id)} className="font-medium hover:underline">
                          {m.product_name}
                        </Link>
                        <span className="block text-xs text-muted">
                          {m.reason === "count"
                            ? m.delta < 0
                              ? `Shelf count: ${-m.delta} missing`
                              : `Shelf count: ${m.delta} more than expected`
                            : (REASON_LABEL[m.reason] ?? m.reason)}
                          {m.invoice_id && (
                            <>
                              {" · "}
                              <Link href={`/bills/${m.invoice_id}`} className="underline underline-offset-2 hover:text-fg">
                                bill
                              </Link>
                            </>
                          )}
                          {person && ` · ${person}`}
                          {m.note && ` · ${m.note}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cx(
                            "num block font-semibold",
                            loss ? "text-over" : m.delta > 0 ? "text-fg" : "text-muted",
                          )}
                        >
                          {m.delta > 0 ? `+${m.delta}` : `−${-m.delta}`}
                        </span>
                        {value !== null && value > 0 && (m.reason === "receive" || loss) && (
                          <span className="num block text-xs text-muted">{formatINR(Math.round(value * 100) / 100)}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
          {rows.length === LIMIT && (
            <p className="text-center text-xs text-muted">Showing the latest {LIMIT}. Pick an item or a type to see further back.</p>
          )}
        </div>
      )}
    </>
  );
}
