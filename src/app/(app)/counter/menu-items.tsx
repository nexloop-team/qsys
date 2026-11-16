"use client";

import { useState } from "react";
import { Minus, Plus, Star } from "lucide-react";
import { formatINR } from "@/lib/format";
import { categoryLabel, hasChoices, pricedLine, readOptions } from "@/lib/menu";
import { Modal } from "@/components/overlay";
import { Button, cx } from "@/components/ui";
import { sameLine, type CartLine, type CounterProduct } from "./types";

// The menu as the Counter and the station popup both show it: big tiles, a category row with
// "Top sellers" first, and one search across everything.

export const TOP = "top";
export const ALL = "all";

export function isOut(p: CounterProduct) {
  return p.stock !== null && p.stock <= 0;
}

/** Searching looks through everything; otherwise the picked category. In stock first. */
export function filterMenu(products: CounterProduct[], query: string, category: string, top: string[]) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let list: CounterProduct[];
  if (words.length) {
    list = products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)) || p.barcode === query.trim());
  } else if (category === TOP) {
    list = top.map((id) => products.find((p) => p.id === id)).filter((p): p is CounterProduct => Boolean(p));
  } else if (category === ALL) {
    list = products;
  } else {
    list = products.filter((p) => categoryLabel(p.category) === category);
  }
  return [...list].sort((a, b) => Number(isOut(a)) - Number(isOut(b)));
}

export function menuTabs(categories: string[], hasTop: boolean) {
  return [
    ...(hasTop ? [{ key: TOP, label: "Top sellers", star: true }] : []),
    { key: ALL, label: "All items", star: false },
    ...categories.map((c) => ({ key: c, label: c, star: false })),
  ];
}

export function CategoryChips({
  tabs,
  active,
  onPick,
  className,
}: {
  tabs: { key: string; label: string; star: boolean }[];
  /** null while searching (no category applies). */
  active: string | null;
  onPick: (key: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Category" className={cx("swipe-row flex gap-2 overflow-x-auto", className)}>
      {tabs.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={active === c.key}
          onClick={() => onPick(c.key)}
          className={cx(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
            active === c.key ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg",
          )}
        >
          {c.star && <Star className="size-3.5" />}
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function ItemTile({
  product: p,
  qty,
  highlight,
  onAdd,
}: {
  product: CounterProduct;
  /** How many are in the order now. */
  qty: number;
  /** The one Enter would add. */
  highlight?: boolean;
  onAdd: () => void;
}) {
  const out = isOut(p);
  const sizes = readOptions(p.options).sizes;
  const from = sizes.length > 1 ? Math.min(...sizes.map((x) => x.price)) : null;
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`${p.name}, ${formatINR(p.price)}${qty ? `, ${qty} in the order` : ""}${out ? ", out of stock" : ""}`}
      className={cx(
        "relative flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-[background-color,border-color,transform] active:scale-[0.98]",
        qty > 0 ? "border-fg bg-subtle" : "border-line bg-panel hover:border-line-strong hover:bg-hover",
        out && "opacity-50",
        highlight && !out && "ring-2 ring-line-strong",
      )}
    >
      <span className="line-clamp-2 pr-7 text-[15px] font-medium leading-snug">{p.name}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="num text-[15px] font-semibold">
          {from !== null && <span className="text-xs font-normal text-muted">from </span>}
          {formatINR(from ?? p.price)}
          {hasChoices(p.options) && from === null && <span className="text-xs font-normal text-muted"> +</span>}
        </span>
        {p.stock !== null && (
          <span className={cx("num text-xs", out ? "font-medium text-over" : p.stock <= 5 ? "font-medium text-ending" : "text-muted")}>
            {out ? "Out" : `${p.stock} left`}
          </span>
        )}
      </span>
      {qty > 0 && (
        <span className="num absolute right-2 top-2 grid min-w-7 place-items-center rounded-full bg-fg px-1.5 py-0.5 text-sm font-bold text-bg">
          {qty}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The order being built, shared by the Counter and the station popup. Tapping an item with sizes
// or add-ons opens the picker; otherwise it goes straight in. Never more than the shelf holds.
// ---------------------------------------------------------------------------
export function useOrder(products: CounterProduct[], onLimit: (message: string) => void) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<CounterProduct | null>(null);

  const qtyOf = (productId: string) => cart.filter((l) => l.productId === productId).reduce((t, l) => t + l.quantity, 0);
  const productOf = (line: CartLine) => (line.productId ? products.find((p) => p.id === line.productId) : undefined);

  const fits = (p: CounterProduct | undefined, extra: number) => {
    if (!p || p.stock === null || qtyOf(p.id) + extra <= p.stock) return true;
    onLimit(p.stock <= 0 ? `${p.name} is out of stock.` : `Only ${p.stock} ${p.name} on the shelf.`);
    return false;
  };

  const put = (line: CartLine) => {
    if (!fits(productOf(line), line.quantity)) return false;
    setCart((prev) => {
      const i = prev.findIndex((x) => sameLine(x, line));
      if (i < 0) return [...prev, line];
      const next = [...prev];
      next[i] = { ...next[i], quantity: next[i].quantity + line.quantity };
      return next;
    });
    return true;
  };

  const tap = (p: CounterProduct) => {
    if (hasChoices(p.options)) {
      if (fits(p, 1)) setPicking(p);
      return;
    }
    put({ productId: p.id, name: p.name, price: Number(p.price), quantity: 1 });
  };

  const change = (index: number, delta: number) => {
    const line = cart[index];
    if (!line) return;
    if (delta > 0 && !fits(productOf(line), delta)) return;
    setCart((prev) => {
      const quantity = prev[index].quantity + delta;
      if (quantity <= 0) return prev.filter((_, i) => i !== index);
      const next = [...prev];
      next[index] = { ...prev[index], quantity };
      return next;
    });
  };

  const picker = (
    <ChoicePicker
      product={picking}
      onClose={() => setPicking(null)}
      onAdd={(line) => {
        if (put(line)) setPicking(null);
      }}
    />
  );

  return { cart, setCart, tap, put, change, qtyOf, picker };
}

// Pick a size and add-ons for one item, like a café till.
function ChoicePicker({
  product,
  onClose,
  onAdd,
}: {
  product: CounterProduct | null;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [pick, setPick] = useState<{ for: string; size?: string; addons: string[]; qty: number }>({
    for: "",
    addons: [],
    qty: 1,
  });
  // A fresh pick each time a different item opens.
  if (product && pick.for !== product.id) {
    setPick({ for: product.id, size: readOptions(product.options).sizes[0]?.name, addons: [], qty: 1 });
  }

  const o = product ? readOptions(product.options) : { sizes: [], addons: [] };
  const line = product ? pricedLine(product, pick.size, pick.addons) : null;
  const toggle = (name: string) =>
    setPick((x) => ({ ...x, addons: x.addons.includes(name) ? x.addons.filter((a) => a !== name) : [...x.addons, name] }));

  return (
    <Modal
      open={Boolean(product)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setPick({ for: "", addons: [], qty: 1 });
        }
      }}
      title={product?.name ?? ""}
      description="Pick what they want."
    >
      {product && line && (
        <div className="flex flex-col gap-4">
          {o.sizes.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Size</h3>
              <div role="radiogroup" aria-label="Size" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {o.sizes.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    role="radio"
                    aria-checked={pick.size === s.name}
                    onClick={() => setPick((x) => ({ ...x, size: s.name }))}
                    className={cx(
                      "flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 text-left transition-colors",
                      pick.size === s.name ? "border-fg bg-fg text-bg" : "border-line hover:bg-hover",
                    )}
                  >
                    <span className="text-sm font-semibold">{s.name}</span>
                    <span className={cx("num text-xs", pick.size === s.name ? "text-bg/75" : "text-muted")}>
                      {formatINR(s.price)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {o.addons.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Add-ons</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {o.addons.map((a) => {
                  const on = pick.addons.includes(a.name);
                  return (
                    <button
                      key={a.name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(a.name)}
                      className={cx(
                        "flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 text-left transition-colors",
                        on ? "border-fg bg-fg text-bg" : "border-line hover:bg-hover",
                      )}
                    >
                      <span className="text-sm font-semibold">{a.name}</span>
                      <span className={cx("num text-xs", on ? "text-bg/75" : "text-muted")}>+{formatINR(a.price)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">How many</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="One less"
                onClick={() => setPick((x) => ({ ...x, qty: Math.max(1, x.qty - 1) }))}
                className="grid size-10 place-items-center rounded-lg border border-line text-muted hover:bg-hover hover:text-fg [&_svg]:size-4"
              >
                <Minus />
              </button>
              <span className="num w-8 text-center text-base font-semibold">{pick.qty}</span>
              <button
                type="button"
                aria-label="One more"
                onClick={() => setPick((x) => ({ ...x, qty: Math.min(100, x.qty + 1) }))}
                className="grid size-10 place-items-center rounded-lg border border-line text-muted hover:bg-hover hover:text-fg [&_svg]:size-4"
              >
                <Plus />
              </button>
            </div>
          </div>
          <Button
            size="lg"
            onClick={() =>
              onAdd({
                productId: product.id,
                name: line.name,
                price: line.price,
                quantity: pick.qty,
                size: line.size,
                addons: line.addons.length ? line.addons : undefined,
              })
            }
          >
            Add · {formatINR(line.price * pick.qty)}
          </Button>
        </div>
      )}
    </Modal>
  );
}
