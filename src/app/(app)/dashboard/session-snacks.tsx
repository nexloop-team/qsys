"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Minus, Plus, Search, X } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatINR } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { Button, ErrorText, Input, cx } from "@/components/ui";

type Supa = SupabaseClient<Database>;

export type SessionItem = {
  id: string;
  product_id: string | null;
  name: string;
  price: number;
  quantity: number;
};

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  /** null = not tracked */
  stock: number | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  beverage: "Drinks",
  snack: "Snacks",
  food: "Food",
  accessory: "Accessories",
  other: "Other",
};
const CATEGORY_ORDER = ["beverage", "snack", "food", "accessory", "other"];

// Snacks and drinks on a running session. Built for a menu of 50+ items: type a few letters
// (Enter adds the top match) or narrow by category; quantities change in place on the bill.
export function SessionSnacksForm({
  sessionId,
  branchId,
  supabase,
  onDone,
}: {
  sessionId: string;
  branchId: string;
  supabase: Supa;
  onDone: () => Promise<void>;
}) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Items and stock counts both change when a snack is added or taken off.
  const load = async () => {
    const [{ data: it }, { data: pr }] = await Promise.all([
      supabase
        .from("session_items")
        .select("id, product_id, name, price, quantity")
        .eq("session_id", sessionId)
        .order("created_at"),
      supabase
        .from("products")
        .select("id, name, price, category, stock")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("name"),
    ]);
    return { items: (it ?? []) as SessionItem[], products: (pr ?? []) as Product[] };
  };

  useEffect(() => {
    let ignore = false;
    void load().then((r) => {
      if (ignore) return;
      setItems(r.items);
      setProducts(r.products);
    });
    return () => {
      ignore = true;
    };
  }, [sessionId, branchId, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>) =>
    startTransition(async () => {
      setError(undefined);
      const { error: err } = await fn();
      if (err) return setError(friendlyError(err));
      const r = await load();
      setItems(r.items);
      setProducts(r.products);
      await onDone();
    });

  const addProduct = (p: Product) =>
    run(() =>
      supabase.rpc("add_session_item", {
        p_session_id: sessionId,
        p_name: p.name,
        p_price: p.price,
        p_quantity: 1,
        p_product_id: p.id,
      }),
    );
  const reduce = (item: SessionItem) => run(() => supabase.rpc("reduce_session_item", { p_item_id: item.id }));

  const categories = useMemo(
    () => CATEGORY_ORDER.filter((c) => (products ?? []).some((p) => p.category === c)),
    [products],
  );

  // Every word typed must appear in the name ("red bu" finds "Red Bull 250ml").
  // In-stock items first, so the top match is always something you can sell.
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (products ?? [])
      .filter((p) => category === "all" || p.category === category)
      .filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
      .sort((a, b) => Number(isOut(a)) - Number(isOut(b)));
  }, [products, query, category]);

  const total = items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(customPrice);
    if (!customName.trim() || !(price >= 0)) return;
    const name = customName.trim();
    run(() =>
      supabase.rpc("add_session_item", { p_session_id: sessionId, p_name: name, p_price: price, p_quantity: 1 }),
    );
    setCustomName("");
    setCustomPrice("");
    setCustomOpen(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Snacks &amp; drinks</h3>
        {total > 0 && <span className="num text-sm font-semibold">{formatINR(total)}</span>}
      </div>

      {/* On this bill */}
      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {items.map((it) => {
            const product = it.product_id ? productById.get(it.product_id) : undefined;
            const canAddMore = Boolean(product) && !isOut(product!);
            return (
              <li key={it.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <div className="flex items-center gap-1">
                  <StepButton label={`One less ${it.name}`} disabled={pending} onClick={() => reduce(it)}>
                    {it.quantity > 1 ? <Minus /> : <X />}
                  </StepButton>
                  <span className="num w-6 text-center text-sm font-medium">{it.quantity}</span>
                  <StepButton
                    label={`One more ${it.name}`}
                    disabled={pending || !canAddMore}
                    onClick={() => product && addProduct(product)}
                  >
                    <Plus />
                  </StepButton>
                </div>
                <span className="num w-16 text-right font-medium">{formatINR(Number(it.price) * it.quantity)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Find on the menu */}
      {products === null ? (
        <p className="py-3 text-center text-xs text-muted">Loading menu…</p>
      ) : products.length === 0 ? (
        <p className="text-xs text-muted">No menu yet. Add items under Snacks &amp; drinks, or add one below.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const first = matches[0];
                if (first && !isOut(first) && !pending) {
                  addProduct(first);
                  setQuery("");
                }
              }}
              placeholder={`Search ${products.length} items`}
              aria-label="Search the menu"
              autoComplete="off"
              autoFocus
              className="pl-9"
            />
          </div>

          {categories.length > 1 && (
            <div role="group" aria-label="Category" className="flex gap-1.5 overflow-x-auto">
              {["all", ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={cx(
                    "h-7 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:h-9",
                    category === c
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto rounded-lg border border-line" aria-label="Menu">
            {matches.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted">Nothing matches “{query}”.</li>
            ) : (
              matches.map((p, i) => {
                const out = isOut(p);
                return (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      disabled={pending || out}
                      onClick={() => addProduct(p)}
                      className={cx(
                        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors pointer-coarse:py-3",
                        out ? "opacity-50" : "hover:bg-hover",
                        i === 0 && query && !out && "bg-subtle",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.stock !== null && (
                        <span
                          className={cx(
                            "num shrink-0 text-xs",
                            out ? "text-over" : p.stock <= 5 ? "text-ending" : "text-muted",
                          )}
                        >
                          {out ? "Out" : `${p.stock} left`}
                        </span>
                      )}
                      <span className="num w-14 shrink-0 text-right font-medium">{formatINR(p.price)}</span>
                      <Plus className="size-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {query && matches.length > 0 && !isOut(matches[0]) && (
            <p className="-mt-1 text-[11px] text-muted">Enter adds {matches[0].name}.</p>
          )}
        </div>
      )}

      {/* Not on the menu */}
      {customOpen ? (
        <form onSubmit={addCustom} className="grid grid-cols-[minmax(0,1fr)_96px_auto] gap-2">
          <Input
            placeholder="Item name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            aria-label="Item name"
            autoFocus
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="₹ Price"
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            aria-label="Price"
          />
          <Button type="submit" size="sm" className="h-9" disabled={pending || !customName.trim() || customPrice === ""}>
            Add
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className="self-start text-xs font-medium text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Item not on the menu?
        </button>
      )}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function isOut(p: Product) {
  return p.stock !== null && p.stock <= 0;
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md border border-line text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 pointer-coarse:size-9 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
