"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Minus, Plus, Printer, Search, ShoppingBag, Trash2 } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatINR } from "@/lib/format";
import { computeBill } from "@/lib/bill";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, buttonClass, ErrorText, Input, cx } from "@/components/ui";
import { PaymentFields, type PaymentRow } from "./payment-fields";
import { DiscountFields, discountReady } from "./discount-fields";
import { WhatsAppButton } from "@/app/(app)/bills/[id]/whatsapp-button";
import { friendlyError } from "@/lib/errors";

type Supa = SupabaseClient<Database>;

export type CartItem = {
  productId?: string;
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

export function QuickSaleDialog({
  open,
  onOpenChange,
  branchId,
  branchName,
  supabase,
  gst,
  discountLimit,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  branchName: string;
  supabase: Supa;
  gst: { enabled: boolean; rate: number; inclusive: boolean };
  /** Staff discount cap in %; null for the owner (no cap). */
  discountLimit: number | null;
  onDone?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // The balance belongs to one exact mobile number: change the number and it no longer applies.
  // customers.wallet_balance is the only source of truth (the database charges from it).
  const cleanPhone = customerPhone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const [wallet, setWallet] = useState<{ phone: string; balance: number } | null>(null);
  const walletBalance = wallet && wallet.phone === cleanPhone ? wallet.balance : 0;

  useEffect(() => {
    if (cleanPhone.length !== 10) return;
    let ignore = false;
    void supabase
      .from("customers")
      .select("name, wallet_balance")
      .eq("phone", cleanPhone)
      .maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        if (data?.name) setCustomerName((name) => name || data.name);
        setWallet({ phone: cleanPhone, balance: Number(data?.wallet_balance ?? 0) });
      });
    return () => {
      ignore = true;
    };
  }, [cleanPhone, supabase]);

  const [discountRupees, setDiscountRupees] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const [paid, setPaid] = useState<{ id: string; number: string; total: number } | null>(null);

  // Load active products for this branch
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    supabase
      .from("products")
      .select("id, name, price, category, stock")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (!ignore && data) {
          setProducts(data as Product[]);
        }
        if (!ignore) setLoadingProducts(false);
      });

    return () => {
      ignore = true;
    };
  }, [open, branchId, supabase]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { productId: product.id, name: product.name, price: Number(product.price), quantity: 1 }];
    });
  };

  const addCustomItem = () => {
    const trimmed = customName.trim();
    const price = Number(customPrice);
    if (!trimmed) return setError("Enter an item name.");
    if (isNaN(price) || price <= 0) return setError("Enter a price above ₹0.");
    setCart((prev) => [...prev, { name: trimmed, price, quantity: 1 }]);
    setCustomName("");
    setCustomPrice("");
    setError(undefined);
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const newQty = next[index].quantity + delta;
      if (newQty <= 0) {
        return next.filter((_, i) => i !== index);
      }
      next[index] = { ...next[index], quantity: newQty };
      return next;
    });
  };

  const removeItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    return Math.min(Math.max(Number(discountRupees) || 0, 0), subtotal);
  }, [subtotal, discountRupees]);

  // Same maths as the database bill, so GST-exclusive prices still add up.
  const finalTotal = computeBill(
    cart.map((i) => ({ amount: i.price * i.quantity, gstRate: gst.rate })),
    discountAmount,
    { gstEnabled: gst.enabled, pricesIncludeTax: gst.inclusive },
  ).total;

  const resetForm = () => {
    setCart([]);
    setCustomName("");
    setCustomPrice("");
    setCustomerName("");
    setCustomerPhone("");
    setDiscountRupees("");
    setDiscountReason("");
    setPayments([]);
    setError(undefined);
    setPaid(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
    onDone?.();
  };

  const handleCheckout = () => {
    if (cart.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (finalTotal > 0 && payments.length === 0) {
      setError("Choose how they paid.");
      return;
    }

    startTransition(async () => {
      setError(undefined);

      // Catalogue items are priced by the database; custom items send their price.
      const itemsPayload = cart.map((i) => ({
        product_id: i.productId ?? null,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      }));

      // One call: bill + any wallet deduction happen together or not at all.
      const { data: invoiceId, error: rpcErr } = await supabase.rpc("quick_sale", {
        p_branch_id: branchId,
        p_items: itemsPayload,
        p_discount: discountAmount,
        p_payments: payments,
        p_customer_name: customerName.trim() || null,
        p_customer_phone: customerPhone.trim() || null,
        p_discount_reason: discountAmount > 0 ? discountReason.trim() : null,
      });

      if (rpcErr || !invoiceId) {
        setError(friendlyError(rpcErr, "Couldn't create the bill."));
        return;
      }

      // Fetch invoice details for receipt
      const { data: inv } = await supabase
        .from("invoices")
        .select("number, total")
        .eq("id", invoiceId)
        .single();

      setPaid({
        id: invoiceId,
        number: inv?.number ?? "",
        total: Number(inv?.total ?? finalTotal),
      });
    });
  };

  // Filtered product catalog
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchesCat = selectedCategory === "all" || p.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [products, search, selectedCategory]);

  if (paid) {
    return (
      <Modal open={open} onOpenChange={(o: boolean) => !o && handleClose()} title="Sale done">
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-10 text-ok" />
          <p className="num text-3xl font-semibold">{formatINR(paid.total)}</p>
          <p className="text-sm text-muted">Bill #{paid.number} · Paid</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/bills/${paid.id}?print=1&from=floor`} className={buttonClass("secondary")}>
              <Printer /> Print bill
            </Link>
            <WhatsAppButton
              phone={customerPhone.trim() || undefined}
              venueName={branchName}
              billNumber={paid.number}
              dateTime={new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              items={cart.map((i) => ({
                description: `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`,
                amount: formatINR(i.price * i.quantity),
              }))}
              total={formatINR(paid.total)}
              paidBy={payments.map((p) => (p.method === "upi" ? "UPI" : p.method === "wallet" ? "Wallet" : "Cash")).join(" + ") || "Cash"}
              size="md"
            />
          </div>
          <Button onClick={handleClose} className="w-full">
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o: boolean) => (!o ? handleClose() : onOpenChange(o))}
      title="Counter sale"
      description="Sell snacks and drinks to anyone, without a station."
    >
      <div className="flex flex-col gap-4">
        {/* Customer Info (Optional) */}
        <div className="rounded-xl border border-line bg-subtle/50 p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="qs-phone" className="text-xs font-medium text-muted">Customer mobile (optional)</label>
              <Input
                id="qs-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="10-digit number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <label htmlFor="qs-name" className="text-xs font-medium text-muted">Customer name (optional)</label>
              <Input
                id="qs-name"
                type="text"
                placeholder="Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Menu Selection */}
        <div>
          <div className="flex items-center justify-between pb-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Items</h3>
            <span className="text-[11px] text-faint">{filteredProducts.length} items available</span>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 size-3.5 text-muted" />
              <Input
                placeholder="Search snacks and drinks"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-8 rounded-lg border border-line bg-panel px-2 text-xs text-fg"
            >
              <option value="all">All</option>
              <option value="beverage">Beverages</option>
              <option value="snack">Snacks</option>
              <option value="food">Food</option>
              <option value="accessory">Accessories</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Product Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 border border-line/60 rounded-xl bg-panel">
            {loadingProducts ? (
              <p className="col-span-full py-4 text-center text-xs text-muted">Loading menu…</p>
            ) : filteredProducts.length === 0 ? (
              <p className="col-span-full py-4 text-center text-xs text-muted">Nothing matches</p>
            ) : (
              filteredProducts.map((p) => {
                const inCart = cart.find((i) => i.productId === p.id);
                // Can't sell more than is on the shelf (when stock is tracked).
                const soldOut = p.stock !== null && (inCart?.quantity ?? 0) >= p.stock;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={soldOut}
                    onClick={() => addToCart(p)}
                    className={cx(
                      "flex items-center justify-between rounded-lg border p-2 text-left text-xs transition-colors",
                      inCart
                        ? "border-accent bg-accent-soft text-fg"
                        : "border-line bg-subtle hover:border-line-strong hover:bg-hover",
                    )}
                  >
                    <div className="truncate pr-1">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="num text-[11px] text-muted">
                        {formatINR(p.price)}
                        {p.stock !== null && (
                          <span className={p.stock <= 0 ? "text-over" : p.stock <= 5 ? "text-ending" : ""}>
                            {" "}
                            · {p.stock <= 0 ? "out" : `${p.stock} left`}
                          </span>
                        )}
                      </p>
                    </div>
                    {inCart ? (
                      <span className="shrink-0 size-5 rounded-full bg-accent text-accent-fg text-[11px] font-bold flex items-center justify-center">
                        {inCart.quantity}
                      </span>
                    ) : (
                      <Plus className="size-3.5 shrink-0 text-muted" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Quick Custom Item */}
          <div className="mt-2 flex items-center gap-1.5">
            <Input
              placeholder="Or type an item, like Samosa"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <Input
              type="number"
              placeholder="₹ Price"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="h-8 text-xs w-20"
            />
            <Button size="sm" variant="secondary" onClick={addCustomItem} className="h-8 px-2.5 text-xs">
              Add
            </Button>
          </div>
        </div>

        {/* Current Cart */}
        <div>
          <div className="flex items-center justify-between pb-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Order</h3>
            <span className="num text-xs font-semibold">{cart.length} items</span>
          </div>

          {cart.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">
              <ShoppingBag className="mx-auto size-5 mb-1 text-faint" />
              Tap an item above to add it.
            </div>
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line bg-panel overflow-hidden">
              {cart.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 text-xs">
                  <div className="flex-1 truncate pr-2">
                    <p className="font-medium text-fg truncate">{item.name}</p>
                    <p className="num text-[11px] text-muted">
                      {formatINR(item.price)} each = {formatINR(item.price * item.quantity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, -1)}
                      className="size-6 rounded border border-line flex items-center justify-center hover:bg-hover text-muted hover:text-fg"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="num w-5 text-center font-semibold text-xs">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, 1)}
                      className="size-6 rounded border border-line flex items-center justify-center hover:bg-hover text-muted hover:text-fg"
                    >
                      <Plus className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="ml-1 p-1 text-faint hover:text-over"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bill Summary & Discounts */}
        {cart.length > 0 && (
          <div className="rounded-xl border border-line bg-panel p-3 flex flex-col gap-2.5 text-sm">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Subtotal</span>
              <span className="num font-semibold text-fg">{formatINR(subtotal)}</span>
            </div>

            <DiscountFields
              subtotal={subtotal}
              value={discountRupees}
              onChange={setDiscountRupees}
              reason={discountReason}
              onReasonChange={setDiscountReason}
              maxPct={discountLimit}
            />

            <div className="border-t border-line pt-2 flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="num text-xl text-accent-ink">{formatINR(finalTotal)}</span>
            </div>
          </div>
        )}

        {/* Payment Methods */}
        {cart.length > 0 && finalTotal > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Payment</h3>
            <PaymentFields
              total={finalTotal}
              onChange={setPayments}
              walletBalance={walletBalance}
              playerName={customerName || undefined}
            />
          </div>
        )}

        {/* Pinned to the bottom: always in thumb reach, however long the cart gets. */}
        <StickyActions>
          {error && <ErrorText>{error}</ErrorText>}
          <Button
            size="lg"
            onClick={handleCheckout}
            disabled={cart.length === 0 || pending || !discountReady(subtotal, discountRupees, discountReason, discountLimit)}
            className="w-full"
          >
            {pending ? "Creating bill…" : cart.length === 0 ? "Add items to sell" : `Complete sale · ${formatINR(finalTotal)}`}
          </Button>
        </StickyActions>
      </div>
    </Modal>
  );
}
