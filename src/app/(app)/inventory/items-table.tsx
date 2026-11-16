"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import { categoryLabel, readOptions } from "@/lib/menu";
import { Button, Input, cx } from "@/components/ui";
import { DeleteProductButton, ProductDialogButton, StockButton, ToggleProductButton, type Product } from "./product-forms";

type Filter = "all" | "low" | "hidden";

// The item list, like a POS back office: search, a category row with counts, quick filters for
// what's running low or hidden, and every item's price, buying price, margin and stock.
export function ItemsTable({
  products,
  categories,
  owner,
  gstRate,
}: {
  products: Product[];
  categories: string[];
  owner: boolean;
  /** GST % inside menu prices (margins are worked out before it); null when prices don't include GST. */
  gstRate: number | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const isLow = (p: Product) => p.is_active && p.stock !== null && p.stock <= p.low_stock_at;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(categoryLabel(p.category), (m.get(categoryLabel(p.category)) ?? 0) + 1);
    return m;
  }, [products]);
  const lowCount = products.filter(isLow).length;
  const hiddenCount = products.filter((p) => !p.is_active).length;

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => !category || categoryLabel(p.category) === category)
      .filter((p) => (filter === "low" ? isLow(p) : filter === "hidden" ? !p.is_active : true))
      .filter((p) => words.every((w) => p.name.toLowerCase().includes(w)) || (query.trim() !== "" && p.barcode === query.trim()))
      .sort(
        (a, b) =>
          categories.indexOf(categoryLabel(a.category)) - categories.indexOf(categoryLabel(b.category)) ||
          a.name.localeCompare(b.name),
      );
  }, [products, query, category, filter, categories]);

  const margin = (p: Product) => {
    if (p.cost === null) return null;
    const net = gstRate !== null ? Number(p.price) / (1 + gstRate / 100) : Number(p.price);
    const m = net - Number(p.cost);
    return { amount: Math.round(m * 100) / 100, pct: net > 0 ? Math.round((m / net) * 100) : 0 };
  };

  return (
    <section className="rounded-xl border border-line bg-panel shadow-card">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${products.length} items or scan a barcode`}
              aria-label="Search items"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div role="group" aria-label="Show" className="flex rounded-lg border border-line bg-subtle p-0.5">
            {(
              [
                ["all", "All"],
                ["low", `Running low${lowCount ? ` · ${lowCount}` : ""}`],
                ["hidden", `Hidden${hiddenCount ? ` · ${hiddenCount}` : ""}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cx(
                  "h-8 rounded-md px-3 text-[13px] font-medium transition-colors pointer-coarse:h-10",
                  filter === key ? "bg-panel text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
                  key === "low" && lowCount > 0 && filter !== key && "text-ending",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {categories.length > 1 && (
          <div role="group" aria-label="Category" className="swipe-row -mx-3 flex gap-1.5 overflow-x-auto px-3 sm:-mx-4 sm:px-4">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? "all"}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cx(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors pointer-coarse:h-10",
                  category === c ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {c ?? "All categories"}
                <span className={cx("num text-xs", category === c ? "text-bg/70" : "text-faint")}>
                  {c ? counts.get(c) ?? 0 : products.length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">
          {query ? `Nothing matches “${query}”.` : filter === "low" ? "Nothing is running low." : filter === "hidden" ? "No hidden items." : "No items here."}
          {(query || category || filter !== "all") && (
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setCategory(null);
                  setFilter("all");
                }}
              >
                Show every item
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Phones: one card per item */}
          <ul className="divide-y divide-line sm:hidden">
            {shown.map((p) => {
              const m = margin(p);
              return (
                <li key={p.id} className="flex flex-col gap-2.5 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <ItemName product={p} />
                    <span className="shrink-0 text-right">
                      <span className="num block font-semibold">{priceText(p)}</span>
                      {owner && (
                        <span className="num block text-xs text-muted">
                          {p.cost === null ? "No buying price" : `Buy ${formatINR(p.cost)}${m ? ` · ${m.pct}%` : ""}`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StockPill product={p} />
                    {owner && (
                      <span className="ml-auto flex items-center gap-1">
                        <ToggleProductButton id={p.id} active={p.is_active} />
                        <StockButton product={p} />
                        <EditButton product={p} categories={categories} />
                        <DeleteProductButton id={p.id} name={p.name} />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Larger screens: a table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  {owner && <th className="px-4 py-2.5 text-right font-medium">Buying price</th>}
                  {owner && <th className="px-4 py-2.5 text-right font-medium">Margin</th>}
                  <th className="px-4 py-2.5 font-medium">On sale</th>
                  {owner && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const m = margin(p);
                  return (
                    <tr key={p.id} className={cx("border-b border-line last:border-0 hover:bg-subtle/60", !p.is_active && "text-muted")}>
                      <td className="px-4 py-2.5">
                        <ItemName product={p} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StockPill product={p} />
                      </td>
                      <td className="num px-4 py-2.5 text-right font-semibold">{priceText(p)}</td>
                      {owner && (
                        <td className="num px-4 py-2.5 text-right">
                          {p.cost === null ? <span className="text-xs text-faint">Not set</span> : formatINR(p.cost)}
                        </td>
                      )}
                      {owner && (
                        <td className="num px-4 py-2.5 text-right">
                          {m === null ? (
                            <span className="text-xs text-faint">-</span>
                          ) : (
                            <span className={m.amount < 0 ? "font-semibold text-over" : ""}>
                              {formatINR(m.amount)} <span className="text-xs text-muted">{m.pct}%</span>
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        {owner ? (
                          <ToggleProductButton id={p.id} active={p.is_active} />
                        ) : (
                          <span className="text-xs">{p.is_active ? "On sale" : "Hidden"}</span>
                        )}
                      </td>
                      {owner && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <StockButton product={p} />
                            <EditButton product={p} categories={categories} />
                            <DeleteProductButton id={p.id} name={p.name} />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {gstRate !== null && owner && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Margins are worked out on the price before GST.</p>
          )}
        </>
      )}
    </section>
  );
}

function ItemName({ product: p }: { product: Product }) {
  const o = readOptions(p.options);
  const extras = [
    categoryLabel(p.category),
    o.sizes.length ? `${o.sizes.length} sizes` : null,
    o.addons.length ? `${o.addons.length} add-ons` : null,
    p.barcode ? `Barcode ${p.barcode}` : null,
  ].filter(Boolean);
  return (
    <span className="min-w-0 flex-1">
      <span className="block font-medium">{p.name}</span>
      <span className="block truncate text-xs text-muted">{extras.join(" · ")}</span>
    </span>
  );
}

function priceText(p: Product) {
  const sizes = readOptions(p.options).sizes;
  if (sizes.length > 1) return `${formatINR(Math.min(...sizes.map((s) => s.price)))} to ${formatINR(Math.max(...sizes.map((s) => s.price)))}`;
  return formatINR(p.price);
}

function StockPill({ product: p }: { product: Product }) {
  if (p.stock === null) return <span className="text-xs text-faint">Not counted</span>;
  const out = p.stock <= 0;
  const low = !out && p.stock <= p.low_stock_at;
  return (
    <span
      className={cx(
        "num inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold",
        out ? "bg-over/15 text-over" : low ? "bg-ending/15 text-ending" : "bg-subtle text-fg",
      )}
    >
      {p.stock} {out ? "· out" : low ? "· low" : "left"}
    </span>
  );
}

function EditButton({ product, categories }: { product: Product; categories: string[] }) {
  return (
    <ProductDialogButton
      product={product}
      categories={categories}
      trigger={
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      }
    />
  );
}
