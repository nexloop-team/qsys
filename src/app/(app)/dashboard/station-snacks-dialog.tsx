"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Minus, Plus, Search, ShoppingBag, X } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatINR } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { sortCategories } from "@/lib/menu";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Input, cx } from "@/components/ui";
import { ALL, CategoryChips, ItemTile, TOP, filterMenu, menuTabs, useOrder } from "../counter/menu-items";
import { PRODUCT_SELECT, lineForSale, type CounterProduct } from "../counter/types";

type Supa = SupabaseClient<Database>;
type BillLine = { id: string; product_id: string | null; name: string; price: number; quantity: number };

// Snacks and drinks for one running station, without leaving the Floor: the same big tiles as the
// Counter, what's already on this bill, and one button that adds the new items to it.
export function StationSnacksDialog({
  open,
  onOpenChange,
  sessionId,
  stationName,
  branchId,
  supabase,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  stationName: string;
  branchId: string;
  supabase: Supa;
  onDone: () => Promise<void> | void;
}) {
  const [products, setProducts] = useState<CounterProduct[] | null>(null);
  const [top, setTop] = useState<string[]>([]);
  const [onBill, setOnBill] = useState<BillLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ name: string; price: string } | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const load = async () => {
    const [pr, tp, bill] = await Promise.all([
      supabase.from("products").select(PRODUCT_SELECT).eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.rpc("top_products", { p_branch_id: branchId }),
      supabase
        .from("session_items")
        .select("id, product_id, name, price, quantity")
        .eq("session_id", sessionId)
        .is("invoice_id", null)
        .order("created_at"),
    ]);
    return {
      products: (pr.data ?? []) as CounterProduct[],
      top: (tp.data ?? []).map((r) => r.product_id),
      bill: (bill.data ?? []) as BillLine[],
    };
  };

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    void load().then((r) => {
      if (ignore) return;
      setProducts(r.products);
      setTop(r.top);
      setOnBill(r.bill);
    });
    return () => {
      ignore = true;
    };
  }, [open, sessionId, branchId, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => products ?? [], [products]);
  const topHere = useMemo(() => top.filter((id) => list.some((p) => p.id === id)), [top, list]);
  const categories = useMemo(() => sortCategories(list.map((p) => p.category)), [list]);
  const tabs = menuTabs(categories, topHere.length > 0);
  // Top sellers first when there are enough of them to be useful.
  const activeCategory = category ?? (topHere.length >= 4 ? TOP : ALL);
  const matches = useMemo(
    () => filterMenu(list, query, activeCategory, topHere),
    [list, query, activeCategory, topHere],
  );

  // Sizes and add-ons open a picker; never more than the shelf holds.
  const order = useOrder(list, setError);
  const { cart, setCart, change, qtyOf: inCart, picker } = order;
  const add = (p: CounterProduct) => {
    setError(undefined);
    order.tap(p);
  };

  const subtotal = cart.reduce((t, l) => t + l.price * l.quantity, 0);
  const count = cart.reduce((t, l) => t + l.quantity, 0);
  const billTotal = onBill.reduce((t, l) => t + Number(l.price) * l.quantity, 0);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCart([]);
      setQuery("");
      setCategory(null);
      setCustom(null);
      setError(undefined);
    }
  };

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const items = cart.map(lineForSale);
      const { error: err } = await supabase.rpc("add_session_items", { p_session_id: sessionId, p_items: items });
      if (err) return setError(friendlyError(err));
      await onDone();
      close(false);
    });

  const takeOff = (line: BillLine) =>
    startTransition(async () => {
      setError(undefined);
      const { error: err } = await supabase.rpc("reduce_session_item", { p_item_id: line.id });
      if (err) return setError(friendlyError(err));
      const r = await load();
      setOnBill(r.bill);
      setProducts(r.products);
      await onDone();
    });

  const customPrice = Number(custom?.price);
  const customOk = Boolean(custom && custom.name.trim() && custom.price !== "" && customPrice > 0 && customPrice <= 50000);

  return (
    <Modal
      open={open}
      onOpenChange={close}
      large
      title={`Snacks & drinks · ${stationName}`}
      description={billTotal > 0 ? `${formatINR(billTotal)} of snacks on this bill so far` : "Added to this station's bill, paid at checkout"}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
        {/* Menu */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const code = query.trim();
                const byCode = list.find((p) => p.barcode === code);
                const first = byCode ?? matches[0];
                if (first) {
                  add(first);
                  setQuery("");
                }
              }}
              placeholder={products ? `Search ${list.length} items or scan a barcode` : "Loading the menu…"}
              aria-label="Search the menu"
              autoComplete="off"
              className="h-11 pl-10 text-[15px]"
            />
          </div>
          {list.length > 0 && (
            <CategoryChips
              tabs={tabs}
              active={query ? null : activeCategory}
              onPick={(k) => {
                setCategory(k);
                setQuery("");
              }}
              className="-mx-5 shrink-0 px-5"
            />
          )}

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {products === null ? (
              <p className="py-10 text-center text-sm text-muted">Loading the menu…</p>
            ) : (
              <ul aria-label="Menu" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {matches.map((p, i) => (
                  <li key={p.id}>
                    <ItemTile product={p} qty={inCart(p.id)} highlight={i === 0 && Boolean(query)} onAdd={() => add(p)} />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setCustom({ name: "", price: "" })}
                    className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line p-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
                  >
                    <Plus className="size-5" />
                    Not on the menu
                  </button>
                </li>
              </ul>
            )}
            {products !== null && matches.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">{query ? `Nothing matches “${query}”.` : "Nothing in this category."}</p>
            )}
          </div>
        </div>

        {/* Order */}
        <aside className="flex max-h-[42%] shrink-0 flex-col gap-3 border-t border-line pt-3 sm:max-h-none sm:w-80 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {custom && (
              <form
                className="mb-3 flex flex-col gap-2 rounded-xl border border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customOk || !custom) return;
                  order.put({ name: custom.name.trim(), price: customPrice, quantity: 1 });
                  setCustom(null);
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Not on the menu</p>
                <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                  <Input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Samosa" autoFocus maxLength={80} />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={custom.price}
                    onChange={(e) => setCustom({ ...custom, price: e.target.value })}
                    placeholder="₹"
                    aria-label="Price"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCustom(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" className="flex-1" disabled={!customOk}>
                    Add
                  </Button>
                </div>
              </form>
            )}

            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Adding now</h3>
            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
                <ShoppingBag className="mx-auto mb-1 size-5 text-faint" />
                Tap items to add them.
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {cart.map((l, i) => (
                  <li key={`${l.productId ?? l.name}-${i}`} className="flex items-center gap-1.5 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.name}</span>
                      <span className="num block text-xs text-muted">{formatINR(l.price * l.quantity)}</span>
                    </span>
                    <Step label={`One less ${l.name}`} onClick={() => change(i, -1)}>
                      {l.quantity > 1 ? <Minus /> : <X />}
                    </Step>
                    <span className="num w-6 text-center text-sm font-semibold">{l.quantity}</span>
                    <Step label={`One more ${l.name}`} onClick={() => change(i, 1)}>
                      <Plus />
                    </Step>
                  </li>
                ))}
              </ul>
            )}

            {onBill.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-4 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted">
                  Already on the bill <span className="num normal-case tracking-normal">{formatINR(billTotal)}</span>
                </h3>
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {onBill.map((l) => (
                    <li key={l.id} className="flex items-center gap-1.5 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate">
                        {l.name}
                        {l.quantity > 1 && <span className="num text-muted"> × {l.quantity}</span>}
                      </span>
                      <span className="num text-xs text-muted">{formatINR(Number(l.price) * l.quantity)}</span>
                      <Step label={`Take one ${l.name} off`} disabled={pending} onClick={() => takeOff(l)}>
                        {l.quantity > 1 ? <Minus /> : <X />}
                      </Step>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            <ErrorText>{error}</ErrorText>
            <Button size="lg" className="w-full" disabled={cart.length === 0 || pending} onClick={submit}>
              {pending
                ? "Adding…"
                : cart.length === 0
                  ? "Tap items to add them"
                  : `Add ${count} to ${stationName} · ${formatINR(subtotal)}`}
            </Button>
          </div>
        </aside>
      </div>
      {picker}
    </Modal>
  );
}

function Step({
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
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 pointer-coarse:size-10 [&_svg]:size-4",
      )}
    >
      {children}
    </button>
  );
}
