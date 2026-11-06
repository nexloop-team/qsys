"use client";

import { useEffect, useState, useTransition } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Coffee, Plus, Trash2 } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatINR } from "@/lib/format";
import { Button, ErrorText, Input } from "@/components/ui";

type Supa = SupabaseClient<Database>;

export type SessionItem = {
  id: string;
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
  const [products, setProducts] = useState<Product[]>([]);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Items and stock counts both change when a snack is added or removed.
  const reloadItems = async () => {
    const [{ data: it }, { data: pr }] = await Promise.all([
      supabase.from("session_items").select("id, name, price, quantity").eq("session_id", sessionId),
      supabase.from("products").select("id, name, price, category, stock").eq("branch_id", branchId).eq("is_active", true),
    ]);
    setItems((it ?? []) as SessionItem[]);
    setProducts((pr ?? []) as Product[]);
  };

  useEffect(() => {
    let ignore = false;
    Promise.all([
      supabase.from("session_items").select("id, name, price, quantity").eq("session_id", sessionId),
      supabase.from("products").select("id, name, price, category, stock").eq("branch_id", branchId).eq("is_active", true),
    ]).then(([{ data: it }, { data: pr }]) => {
      if (!ignore) {
        setItems((it ?? []) as SessionItem[]);
        setProducts((pr ?? []) as Product[]);
      }
    });
    return () => {
      ignore = true;
    };
  }, [sessionId, branchId, supabase]);

  const addItem = (name: string, price: number, qty = 1, productId?: string) =>
    startTransition(async () => {
      setError(undefined);
      const { error: err } = await supabase.rpc("add_session_item", {
        p_session_id: sessionId,
        p_name: name,
        p_price: price,
        p_quantity: qty,
        p_product_id: productId || null,
      });
      if (err) return setError(err.message);
      await reloadItems();
      await onDone();
    });

  const removeItem = (itemId: string) =>
    startTransition(async () => {
      setError(undefined);
      const { error: err } = await supabase.rpc("remove_session_item", {
        p_item_id: itemId,
      });
      if (err) return setError(err.message);
      await reloadItems();
      await onDone();
    });

  const handleCustomAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(customPrice);
    if (!customName.trim() || isNaN(price) || price < 0) return;
    addItem(customName.trim(), price, Math.max(1, Number(customQty) || 1));
    setCustomName("");
    setCustomPrice("");
    setCustomQty("1");
  };

  const total = items.reduce((s, it) => s + it.price * it.quantity, 0);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-subtle/50 p-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          <Coffee className="size-3.5 text-accent-ink" /> Snacks & Drinks
        </span>
        {total > 0 && <span className="num text-xs font-semibold text-fg">Items total: {formatINR(total)}</span>}
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-panel text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between px-3 py-2">
              <span className="font-medium">
                {it.name} {it.quantity > 1 && <span className="text-muted">× {it.quantity}</span>}
              </span>
              <div className="flex items-center gap-2">
                <span className="num font-semibold">{formatINR(it.price * it.quantity)}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeItem(it.id)}
                  className="cursor-pointer text-muted hover:text-danger p-1"
                  aria-label="Remove item"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {products.length > 0 && (
        <div>
          <span className="text-[11px] font-medium text-muted block mb-1.5">Quick add from menu:</span>
          <div className="flex flex-wrap gap-1.5">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending || (p.stock !== null && p.stock <= 0)}
                onClick={() => addItem(p.name, p.price, 1, p.id)}
                className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium transition-colors hover:border-line-strong hover:bg-hover active:scale-95"
              >
                <Plus className="size-3 text-muted" />
                {p.name} <span className="num font-semibold text-muted">{formatINR(p.price)}</span>
                {p.stock !== null && (
                  <span className={`num text-[11px] ${p.stock <= 0 ? "text-over" : "text-faint"}`}>
                    {p.stock <= 0 ? "out" : `${p.stock} left`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleCustomAdd} className="flex flex-col gap-2 pt-1 border-t border-line">
        <span className="text-[11px] font-medium text-muted">Or add custom item:</span>
        <div className="grid grid-cols-[1fr_80px_45px_auto] gap-1.5">
          <Input
            placeholder="Item (e.g. Chips)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            disabled={pending}
          />
          <Input
            type="number"
            inputMode="decimal"
            placeholder="₹ Price"
            min={0}
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            disabled={pending}
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            disabled={pending}
            title="Qty"
          />
          <Button type="submit" size="sm" disabled={pending || !customName.trim() || !customPrice}>
            Add
          </Button>
        </div>
      </form>

      <ErrorText>{error}</ErrorText>
    </div>
  );
}
