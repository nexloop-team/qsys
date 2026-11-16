import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Coffee, ShoppingBag } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, hoursFromNow, todayIn } from "@/lib/format";
import { categoryLabel, sortCategories } from "@/lib/menu";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass, cx } from "@/components/styles";
import { ProductDialogButton, type Product } from "./product-forms";
import { ItemsTable } from "./items-table";
import { InventoryTabs } from "./inventory-tabs";
import { ShoppingList, type ShoppingRow } from "./shopping-list";
import { LOSS_LABEL, type SnacksReport } from "./snacks-report";

export const metadata: Metadata = { title: "Snacks & drinks" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inventory />
    </Suspense>
  );
}

async function Inventory() {
  const { branch, role } = await getAppContext();
  const owner = isOwner(role);
  const supabase = await createClient();
  const today = todayIn(branch.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [items, { data: settings }, month, costs] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, barcode, options, price, is_active, stock, low_stock_at")
      .eq("branch_id", branch.id)
      .order("name"),
    supabase.from("branch_settings").select("gst_enabled, gst_rate, prices_include_tax").eq("branch_id", branch.id).single(),
    owner
      ? supabase.rpc("report_snacks", { p_branch_id: branch.id, p_from: monthStart, p_to: today })
      : Promise.resolve({ data: null }),
    // Buying prices are owner-only in the database too.
    owner ? supabase.rpc("product_costs", { p_branch_id: branch.id }) : Promise.resolve({ data: null }),
  ]);

  if (items.error) {
    return (
      <>
        <PageHeader title="Snacks & drinks" />
        <Panel>
          <p className="text-sm">
            Couldn&apos;t load the items: {items.error.message}. If you just updated the app, apply the latest database
            changes (npx supabase db push) and reload.
          </p>
        </Panel>
      </>
    );
  }

  const costOf = new Map((costs.data ?? []).map((c) => [c.product_id, c.cost === null ? null : Number(c.cost)]));
  const products = (items.data ?? []).map((p) => ({ ...p, cost: costOf.get(p.id) ?? null })) as Product[];
  const categories = sortCategories(products.map((p) => categoryLabel(p.category)));
  const report = month.data as SnacksReport | null;
  const low = products.filter((p) => p.is_active && p.stock !== null && p.stock <= p.low_stock_at);

  // Shopping list: enough for about a week, going by the last 7 days of sales.
  let shopping: ShoppingRow[] = [];
  if (owner && low.length > 0) {
    const { data: moves } = await supabase
      .from("stock_moves")
      .select("product_id, delta")
      .in("product_id", low.map((p) => p.id))
      .in("reason", ["sale", "return", "void"])
      .gte("created_at", hoursFromNow(-7 * 24));
    shopping = low.map((p) => {
      const sold = Math.max(-(moves ?? []).filter((m) => m.product_id === p.id).reduce((t, m) => t + m.delta, 0), 0);
      return { id: p.id, name: p.name, stock: p.stock ?? 0, sold, buy: Math.max(Math.max(sold, p.low_stock_at * 2) - (p.stock ?? 0), 0) };
    });
  }

  const gstInside = Boolean(settings?.gst_enabled && settings?.prices_include_tax);
  const totals = report?.totals;
  const losses = report?.losses ?? [];
  const lost = losses.reduce((t, l) => t + Number(l.value), 0);
  const shelfValue = products.reduce((t, p) => t + (p.stock && p.stock > 0 && p.cost !== null ? p.stock * p.cost : 0), 0);
  const counted = products.filter((p) => p.stock !== null).length;

  return (
    <>
      <PageHeader
        title="Snacks & drinks"
        description={`${branch.name} · what you sell at the counter, at the stations and on the PCs`}
        actions={
          <>
            <Link href="/counter" className={buttonClass("secondary")}>
              <ShoppingBag /> Open the counter
            </Link>
            {owner && <ProductDialogButton categories={categories} />}
          </>
        }
      />
      {owner && <InventoryTabs active="items" />}

      {owner && products.length > 0 && (
        <section
          aria-label="This month"
          className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card lg:grid-cols-4"
        >
          <Stat
            label="Sold this month"
            value={formatINR(Number(totals?.sales ?? 0))}
            sub={`${totals?.qty ?? 0} items${settings?.gst_enabled ? ", before GST" : ""}`}
          />
          <Stat
            label="Profit this month"
            value={formatINR(Number(totals?.profit ?? 0))}
            sub={
              Number(totals?.costed_sales ?? 0) > 0
                ? `${Math.round((Number(totals!.profit) / Number(totals!.costed_sales)) * 100)}% of sales with a buying price`
                : "Add buying prices to see it"
            }
          />
          <Stat
            label="Stock on the shelf"
            value={formatINR(Math.round(shelfValue))}
            sub={counted ? `At buying price, ${counted} counted items` : "Count stock to see it"}
          />
          <Stat
            label="Lost this month"
            value={formatINR(lost)}
            over={lost > 0}
            sub={losses.length ? losses.map((l) => `${l.qty} ${LOSS_LABEL[l.reason].toLowerCase()}`).join(", ") : "Nothing written off"}
          />
        </section>
      )}

      {owner && shopping.length > 0 && (
        <details className="group mb-5 rounded-xl border border-line bg-panel shadow-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
            <span className="size-2 shrink-0 rounded-full bg-ending" aria-hidden />
            <span className="flex-1">
              <span className="font-semibold">{shopping.length} {shopping.length === 1 ? "item is" : "items are"} running low.</span>{" "}
              <span className="text-muted">Open the shopping list.</span>
            </span>
            <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-line">
            <ShoppingList rows={shopping} branchName={branch.name} />
          </div>
        </details>
      )}

      {products.length === 0 ? (
        <Panel>
          <Empty icon={<Coffee />} title="No items yet">
            {owner
              ? "Add drinks, Maggi and snacks, with sizes and add-ons if they have them. Then sell them on the Counter, onto a station's bill, or from the table QR page and the PCs."
              : "The owner adds the items and prices sold at the counter."}
            {owner && (
              <div className="mt-4 flex justify-center">
                <ProductDialogButton categories={categories} />
              </div>
            )}
          </Empty>
        </Panel>
      ) : (
        <ItemsTable
          products={products}
          categories={categories}
          owner={owner}
          gstRate={gstInside ? Number(settings?.gst_rate ?? 18) : null}
        />
      )}
    </>
  );
}

function Stat({ label, value, sub, over }: { label: string; value: string; sub: string; over?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 bg-panel px-4 py-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className={cx("num text-xl font-semibold", over && "text-over")}>{value}</span>
      <span className="truncate text-xs text-muted">{sub}</span>
    </div>
  );
}
