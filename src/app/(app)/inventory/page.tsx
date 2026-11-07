import { Suspense } from "react";
import type { Metadata } from "next";
import { Coffee } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatINR, todayIn, zonedStart } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { Button } from "@/components/ui";
import {
  DeleteProductButton,
  ProductDialogButton,
  QuickSalePOSButton,
  StockButton,
  ToggleProductButton,
  type Product,
} from "./product-forms";

export const metadata: Metadata = { title: "Snacks & Drinks" };

const CATEGORY_LABEL: Record<string, string> = {
  beverage: "Cold Drinks & Beverages",
  snack: "Chips & Snacks",
  food: "Food & Instant Meals",
  accessory: "Accessories & Others",
  other: "Other Items",
};

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InventoryList />
    </Suspense>
  );
}

async function InventoryList() {
  const { branch, org, role } = await getAppContext();
  const owner = isOwner(role);
  const supabase = await createClient();

  const [{ data: rawProducts }, { data: shortfalls }, { data: settings }] = await Promise.all([
    supabase.from("products").select("id, name, category, price, is_active, stock, low_stock_at").eq("branch_id", branch.id).order("name"),
    // Shelf counts that came up short this month = missing stock.
    supabase
      .from("stock_moves")
      .select("delta, product_id")
      .eq("org_id", org.id)
      .eq("reason", "count")
      .lt("delta", 0)
      .gte("created_at", zonedStart(`${todayIn(branch.timezone).slice(0, 7)}-01`, branch.timezone)),
    supabase.from("branch_settings").select("gst_enabled, gst_rate, prices_include_tax, staff_max_discount_pct").eq("branch_id", branch.id).single(),
  ]);
  const gst = {
    enabled: settings?.gst_enabled ?? false,
    rate: Number(settings?.gst_rate ?? 18),
    inclusive: settings?.prices_include_tax ?? false,
  };

  const products = (rawProducts ?? []) as Product[];
  const low = products.filter((p) => p.is_active && p.stock !== null && p.stock <= p.low_stock_at);
  const priceOf = (id: string) => Number(products.find((p) => p.id === id)?.price ?? 0);
  const missingQty = (shortfalls ?? []).reduce((t, m) => t - m.delta, 0);
  const missingValue = (shortfalls ?? []).reduce((t, m) => t - m.delta * priceOf(m.product_id), 0);

  const byCategory = products.reduce<Record<string, Product[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  const categories = ["beverage", "snack", "food", "accessory", "other"].filter(
    (c) => (byCategory[c] && byCategory[c].length > 0) || products.length === 0,
  );

  return (
    <>
      <PageHeader
        title="Snacks & Drinks"
        description={`${branch.name} · Beverages, food and snacks sold at the counter`}
        actions={
          <div className="flex items-center gap-2">
            <QuickSalePOSButton
              branchId={branch.id}
              branchName={branch.name}
              gst={gst}
              discountLimit={owner ? null : (settings?.staff_max_discount_pct ?? 10)}
            />
            {owner && <ProductDialogButton />}
          </div>
        }
      />

      {(low.length > 0 || missingQty > 0) && (
        <div className="mb-5 flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-card">
          {low.length > 0 && (
            <p>
              <span className="font-medium text-ending">Running low:</span>{" "}
              {low.map((p) => `${p.name} (${p.stock})`).join(", ")}
            </p>
          )}
          {missingQty > 0 && (
            <p>
              <span className="font-medium text-over">Missing this month:</span> {missingQty} item
              {missingQty === 1 ? "" : "s"} worth {formatINR(missingValue)}, found by shelf counts.
            </p>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <Panel>
          <Empty icon={<Coffee />} title="No items added yet">
            {owner
              ? "Add cold drinks, Maggi, Red Bull, and snacks to sell and bill them to gaming stations."
              : "The owner adds the items and prices sold at the counter."}
            {owner && (
              <div className="mt-4 flex justify-center">
                <ProductDialogButton />
              </div>
            )}
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {categories.map((cat) => {
            const items = byCategory[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <Panel key={cat} title={CATEGORY_LABEL[cat] ?? cat} flush>
                {/* Phones: one card per item. */}
                <ul className="divide-y divide-line text-sm sm:hidden">
                  {items.map((it) => (
                    <li key={it.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <span className={`block font-medium ${it.is_active ? "" : "text-muted"}`}>{it.name}</span>
                          <span className="mt-0.5 block text-xs">
                            {it.stock === null ? (
                              <span className="text-muted">Stock not tracked</span>
                            ) : (
                              <span
                                className={
                                  it.stock === 0
                                    ? "font-semibold text-over"
                                    : it.stock <= it.low_stock_at
                                      ? "font-semibold text-ending"
                                      : "text-muted"
                                }
                              >
                                <span className="num">{it.stock}</span> in stock
                                {it.stock === 0 ? " · out" : it.stock <= it.low_stock_at ? " · low" : ""}
                              </span>
                            )}
                            {!it.is_active && <span className="text-muted"> · hidden</span>}
                          </span>
                        </span>
                        <span className="num shrink-0 font-semibold">{formatINR(it.price)}</span>
                      </div>
                      {owner && (
                        <div className="flex flex-wrap items-center gap-1">
                          <ToggleProductButton id={it.id} active={it.is_active} />
                          <span className="ml-auto flex items-center gap-1">
                            <StockButton product={it} />
                            <ProductDialogButton
                              product={it}
                              trigger={
                                <Button variant="ghost" size="sm">
                                  Edit
                                </Button>
                              }
                            />
                            <DeleteProductButton id={it.id} name={it.name} />
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="px-4 py-2.5 font-medium">Item</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                        <th className="px-4 py-2.5 text-right font-medium">Price</th>
                        <th className="px-4 py-2.5 text-right font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                          <td className="px-4 py-2.5 font-medium">{it.name}</td>
                          <td className="px-4 py-2.5">
                            {owner ? (
                              <ToggleProductButton id={it.id} active={it.is_active} />
                            ) : (
                              <span className="text-xs text-muted">{it.is_active ? "On sale" : "Hidden"}</span>
                            )}
                          </td>
                          <td className="num px-4 py-2.5 text-right">
                            {it.stock === null ? (
                              <span className="text-faint">—</span>
                            ) : (
                              <span
                                className={
                                  it.stock === 0 ? "font-semibold text-over" : it.stock <= it.low_stock_at ? "font-semibold text-ending" : ""
                                }
                              >
                                {it.stock}
                                {it.stock === 0 ? " · out" : it.stock <= it.low_stock_at ? " · low" : ""}
                              </span>
                            )}
                          </td>
                          <td className="num px-4 py-2.5 text-right font-semibold">{formatINR(it.price)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {owner && (
                            <div className="flex items-center justify-end gap-1">
                              <StockButton product={it} />
                              <ProductDialogButton
                                product={it}
                                trigger={
                                  <Button variant="ghost" size="sm">
                                    Edit
                                  </Button>
                                }
                              />
                              <DeleteProductButton id={it.id} name={it.name} />
                            </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
