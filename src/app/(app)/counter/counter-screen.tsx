"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { subscribeSessionChanges } from "@/lib/live-sessions";
import { STATION_TYPE_LABEL } from "@/lib/constants";
import { formatINR, formatTime } from "@/lib/format";
import { computeBill } from "@/lib/bill";
import { friendlyError } from "@/lib/errors";
import { sortCategories } from "@/lib/menu";
import { Modal, Sheet } from "@/components/overlay";
import { Button, buttonClass, ErrorText, Input, cx } from "@/components/ui";
import { PaymentFields, type PaymentRow } from "../dashboard/payment-fields";
import { DiscountFields, discountReady } from "../dashboard/discount-fields";
import { WhatsAppButton } from "../bills/[id]/whatsapp-button";
import { SalesToday } from "./sales-today";
import { ALL, CategoryChips, ItemTile, TOP, filterMenu, isOut, menuTabs, useOrder } from "./menu-items";
import { saveHeld, useHeldOrders, type HeldOrder } from "./held-orders";
import {
  OPEN_SESSION_SELECT,
  PRODUCT_SELECT,
  lineForSale,
  type CartLine,
  type CounterProduct,
  type OpenSessionRow,
} from "./types";

type BillLine = { id: string; product_id: string | null; name: string; price: number; quantity: number };
type Sold = { id: string; number: string; total: number; lines: CartLine[]; phone: string; paidBy: string };
type Tab = "sell" | "today" | "held";

const WALK_IN = "walk-in";

// The counter, laid out like a shop POS: Sell (category rail, item tiles, the order), Sales today
// and Held orders. The order goes either onto a running station's bill or out as a walk-in sale
// paid on the spot. A barcode scanner works anywhere on the Sell tab.
export function CounterScreen({
  branchId,
  branchName,
  timezone,
  owner,
  initialProducts,
  initialSessions,
  topSellers,
  initialTarget,
  fromFloor,
  gst,
  discountLimit,
}: {
  branchId: string;
  branchName: string;
  timezone: string;
  owner: boolean;
  initialProducts: CounterProduct[];
  initialSessions: OpenSessionRow[];
  /** Product ids, best seller first (last 30 days). */
  topSellers: string[];
  initialTarget?: string;
  fromFloor: boolean;
  gst: { enabled: boolean; rate: number; inclusive: boolean };
  /** Staff discount cap in %; null for the owner (no cap). */
  discountLimit: number | null;
}) {
  const [supabase] = useState(createClient);
  const desktop = useIsDesktop();
  const held = useHeldOrders(branchId);

  const [tab, setTab] = useState<Tab>("sell");
  const [products, setProducts] = useState(initialProducts);
  const [sessions, setSessions] = useState(initialSessions);
  const [target, setTarget] = useState(
    initialTarget && initialSessions.some((s) => s.id === initialTarget) ? initialTarget : WALK_IN,
  );
  const session = sessions.find((s) => s.id === target);
  const walkIn = !session;

  const top = useMemo(() => topSellers.filter((id) => products.some((p) => p.id === id)), [topSellers, products]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(top.length >= 4 ? TOP : ALL);
  const [onBill, setOnBill] = useState<BillLine[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [sold, setSold] = useState<Sold | null>(null);
  const [salesKey, setSalesKey] = useState(0);

  // Walk-in details
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [wallet, setWallet] = useState<{ phone: string; balance: number } | null>(null);
  const walletBalance = wallet && wallet.phone === phone ? wallet.balance : 0;

  const loadProducts = async () => {
    const { data } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("name");
    if (data) setProducts(data as CounterProduct[]);
  };

  const loadOnBill = async (sessionId: string) => {
    const { data } = await supabase
      .from("session_items")
      .select("id, product_id, name, price, quantity")
      .eq("session_id", sessionId)
      .is("invoice_id", null)
      .order("created_at");
    setOnBill((data ?? []) as BillLine[]);
  };

  // Running stations come and go while the counter is open.
  useEffect(() => {
    const reload = async () => {
      const { data } = await supabase
        .from("sessions")
        .select(OPEN_SESSION_SELECT)
        .eq("branch_id", branchId)
        .neq("status", "ended")
        .order("started_at");
      if (data) setSessions(data as unknown as OpenSessionRow[]);
    };
    return subscribeSessionChanges(supabase, branchId, { onChange: () => void reload() });
  }, [supabase, branchId]);

  // What's already on the chosen station's bill.
  useEffect(() => {
    if (!session) return;
    let ignore = false;
    void supabase
      .from("session_items")
      .select("id, product_id, name, price, quantity")
      .eq("session_id", session.id)
      .is("invoice_id", null)
      .order("created_at")
      .then(({ data }) => {
        if (!ignore) setOnBill((data ?? []) as BillLine[]);
      });
    return () => {
      ignore = true;
    };
  }, [supabase, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A known player's wallet, by exact mobile number.
  useEffect(() => {
    if (phone.length !== 10) return;
    let ignore = false;
    void supabase
      .from("customers")
      .select("name, wallet_balance")
      .eq("phone", phone)
      .maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        if (data?.name) setName((n) => n || data.name);
        setWallet({ phone, balance: Number(data?.wallet_balance ?? 0) });
      });
    return () => {
      ignore = true;
    };
  }, [phone, supabase]);

  const categories = useMemo(() => sortCategories(products.map((p) => p.category)), [products]);

  const matches = useMemo(() => filterMenu(products, query, category, top), [products, query, category, top]);

  // The order: tapping an item with sizes or add-ons opens the picker; never more than the shelf.
  const order = useOrder(products, setNotice);
  const { cart, setCart, change, qtyOf: inCart, picker } = order;
  const add = (p: CounterProduct) => {
    setSold(null);
    setNotice(undefined);
    setError(undefined);
    order.tap(p);
  };

  // A scanned barcode (or one typed in the search box): add that item.
  const addByBarcode = (code: string) => {
    const p = products.find((x) => x.barcode === code);
    if (p) add(p);
    else setNotice(`No item has the barcode ${code}. Add it to the item under Snacks & drinks.`);
  };

  // Scanners type fast and end with Enter. Outside a text box, catch that and add the item.
  const scan = useRef({ buffer: "", last: 0 });
  const onScan = useRef(addByBarcode);
  useEffect(() => {
    onScan.current = addByBarcode;
  });
  useEffect(() => {
    if (tab !== "sell") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const s = scan.current;
      if (e.timeStamp - s.last > 60) s.buffer = "";
      s.last = e.timeStamp;
      if (e.key === "Enter") {
        if (s.buffer.length >= 3) {
          e.preventDefault();
          onScan.current(s.buffer);
        }
        s.buffer = "";
      } else if (e.key.length === 1 && /[A-Za-z0-9-]/.test(e.key)) {
        s.buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const subtotal = cart.reduce((t, l) => t + l.price * l.quantity, 0);
  const count = cart.reduce((t, l) => t + l.quantity, 0);
  const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  // Same maths as the database bill, so GST-exclusive prices still add up.
  const total = walkIn
    ? computeBill(
        cart.map((l) => ({ amount: l.price * l.quantity, gstRate: gst.rate })),
        discountAmount,
        { gstEnabled: gst.enabled, pricesIncludeTax: gst.inclusive },
      ).total
    : subtotal;
  const billTotal = onBill.reduce((t, l) => t + Number(l.price) * l.quantity, 0);
  const stationName = session ? (session.stations?.name ?? "Station") : "";

  const resetWalkIn = () => {
    setPhone("");
    setName("");
    setDiscount("");
    setDiscountReason("");
    setPayments([]);
  };

  const pick = (id: string) => {
    setTarget(id);
    setNotice(undefined);
    setError(undefined);
    setSold(null);
    setOnBill([]);
  };

  const hold = (label: string) => {
    const order: HeldOrder = {
      id: crypto.randomUUID(),
      label: label.trim() || `Order ${held.length + 1}`,
      at: new Date().toISOString(),
      lines: cart,
    };
    saveHeld(branchId, [order, ...held]);
    setCart([]);
    resetWalkIn();
    setOrderOpen(false);
    setNotice(`${order.label} is on hold. Find it under Held.`);
  };

  const resume = (order: HeldOrder) => {
    if (cart.length > 0 && !confirm("Replace the order on screen with this held one? Hold the current one first to keep it.")) return;
    saveHeld(branchId, held.filter((h) => h.id !== order.id));
    pick(WALK_IN);
    setCart(order.lines);
    if (!/^Order \d+$/.test(order.label)) setName(order.label);
    setTab("sell");
    setNotice(`${order.label} is back on screen.`);
  };

  const submit = () => {
    if (cart.length === 0) return;
    if (walkIn && total > 0 && payments.length === 0) return setError("Choose how they paid.");
    startTransition(async () => {
      setError(undefined);
      const items = cart.map(lineForSale);

      if (session) {
        const { error: err } = await supabase.rpc("add_session_items", { p_session_id: session.id, p_items: items });
        if (err) return setError(friendlyError(err));
        setNotice(`Added ${count} ${count === 1 ? "item" : "items"} (${formatINR(subtotal)}) to ${stationName}.`);
        setCart([]);
        setOrderOpen(false);
        setSalesKey((k) => k + 1);
        await Promise.all([loadOnBill(session.id), loadProducts()]);
        return;
      }

      const { data: invoiceId, error: err } = await supabase.rpc("quick_sale", {
        p_branch_id: branchId,
        p_items: items,
        p_discount: discountAmount,
        p_payments: payments,
        p_customer_name: name.trim() || undefined,
        p_customer_phone: phone || undefined,
        p_discount_reason: discountAmount > 0 ? discountReason.trim() : undefined,
      });
      if (err || !invoiceId) return setError(friendlyError(err, "Couldn't make the bill."));
      const { data: inv } = await supabase.from("invoices").select("number, total").eq("id", invoiceId).single();
      setSold({
        id: invoiceId,
        number: inv?.number ?? "",
        total: Number(inv?.total ?? total),
        lines: cart,
        phone,
        paidBy: payments.map((p) => (p.method === "upi" ? "UPI" : p.method === "wallet" ? "Wallet" : "Cash")).join(" + ") || "Cash",
      });
      setCart([]);
      resetWalkIn();
      setOrderOpen(true);
      setSalesKey((k) => k + 1);
      await loadProducts();
    });
  };

  const takeOff = (line: BillLine) =>
    startTransition(async () => {
      setError(undefined);
      const { error: err } = await supabase.rpc("reduce_session_item", { p_item_id: line.id });
      if (err) return setError(friendlyError(err));
      if (session) await Promise.all([loadOnBill(session.id), loadProducts()]);
    });

  const ready =
    cart.length > 0 && !pending && (!walkIn || discountReady(subtotal, discount, discountReason, discountLimit));
  const actionLabel = pending
    ? "Saving…"
    : cart.length === 0
      ? "Tap items to add them"
      : walkIn
        ? `Charge ${formatINR(total)}`
        : `Add to ${stationName} · ${formatINR(subtotal)}`;

  const action = sold ? (
    <Button size="lg" className="w-full" onClick={() => setSold(null)}>
      New sale
    </Button>
  ) : (
    <div className="flex flex-col gap-2">
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        {walkIn && cart.length > 0 && (
          <Button size="lg" variant="secondary" onClick={() => setHoldOpen(true)} disabled={pending}>
            <PauseCircle /> Hold
          </Button>
        )}
        <Button size="lg" className="min-w-0 flex-1" disabled={!ready} onClick={submit}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );

  const body = sold ? (
    <SoldView sold={sold} branchName={branchName} />
  ) : (
    <div className="flex flex-col gap-4">
      {session && onBill.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Already on the bill</h3>
            <span className="num text-xs font-semibold">{formatINR(billTotal)}</span>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {onBill.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {l.name}
                  {l.quantity > 1 && <span className="num text-muted"> × {l.quantity}</span>}
                </span>
                <span className="num font-medium">{formatINR(Number(l.price) * l.quantity)}</span>
                <StepButton label={`Take one ${l.name} off`} disabled={pending} onClick={() => takeOff(l)}>
                  {l.quantity > 1 ? <Minus /> : <X />}
                </StepButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{session ? "Adding now" : "Order"}</h3>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
            >
              <Trash2 className="size-3.5" /> Clear
            </button>
          )}
        </div>
        {cart.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            <ShoppingBag className="mx-auto mb-1.5 size-5 text-faint" />
            Tap items, or scan a barcode, to add them here.
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {cart.map((l, i) => (
              <li key={`${l.productId ?? l.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="num block text-xs text-muted">{formatINR(l.price)} each</span>
                </span>
                <StepButton label={`One less ${l.name}`} onClick={() => change(i, -1)}>
                  {l.quantity > 1 ? <Minus /> : <X />}
                </StepButton>
                <span className="num w-7 text-center text-[15px] font-semibold">{l.quantity}</span>
                <StepButton label={`One more ${l.name}`} onClick={() => change(i, 1)}>
                  <Plus />
                </StepButton>
                <span className="num w-16 text-right text-sm font-semibold">{formatINR(l.price * l.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {walkIn && cart.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Mobile (optional)
              <Input
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="10 digits"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").slice(0, 10))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Name (optional)
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            </label>
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl border border-line p-3 text-sm">
            <div className="flex items-center justify-between text-muted">
              <span>
                {count} {count === 1 ? "item" : "items"}
              </span>
              <span className="num font-semibold text-fg">{formatINR(subtotal)}</span>
            </div>
            <DiscountFields
              subtotal={subtotal}
              value={discount}
              onChange={setDiscount}
              reason={discountReason}
              onReasonChange={setDiscountReason}
              maxPct={discountLimit}
            />
            {Math.abs(total - (subtotal - discountAmount)) >= 0.01 && (
              <div className="flex items-center justify-between text-muted">
                <span>GST</span>
                <span className="num">{formatINR(Math.round((total - (subtotal - discountAmount)) * 100) / 100)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="num text-xl">{formatINR(total)}</span>
            </div>
          </section>

          {total > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Payment</h3>
              <PaymentFields total={total} onChange={setPayments} walletBalance={walletBalance} playerName={name || undefined} />
            </section>
          )}
        </>
      )}

      {session && cart.length > 0 && <p className="text-xs text-muted">Paid with the station&apos;s bill at checkout.</p>}
    </div>
  );

  const orderTitle = sold ? "Sale done" : session ? `${stationName} bill` : "Walk-in sale";

  const railItems = menuTabs(categories, top.length > 0);
  const pickCategory = (key: string) => {
    setCategory(key);
    setQuery("");
  };
  const showNotice = notice || (target !== WALK_IN && !session);

  return (
    <div className="flex flex-col gap-4">
      {/* Title and tabs */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          {fromFloor && (
            <Link href="/dashboard" className={buttonClass("ghost", "sm")}>
              <ArrowLeft /> Floor
            </Link>
          )}
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Counter</h1>
        </div>
        <nav aria-label="Counter" className="flex rounded-lg border border-line bg-subtle p-0.5">
          {(
            [
              ["sell", "Sell"],
              ["today", "Sales today"],
              ["held", "Held"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
              className={cx(
                "flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors pointer-coarse:h-10",
                tab === key ? "bg-panel text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
              )}
            >
              {label}
              {key === "held" && held.length > 0 && (
                <span className="num grid min-w-5 place-items-center rounded-full bg-fg px-1 text-[11px] font-bold text-bg">
                  {held.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        {owner && (
          <Link href="/inventory" className={buttonClass("ghost", "sm", "ml-auto")}>
            Items and stock
          </Link>
        )}
      </div>

      {tab === "today" && <SalesToday supabase={supabase} branchId={branchId} timezone={timezone} refreshKey={salesKey} />}

      {tab === "held" && (
        <HeldList
          held={held}
          timezone={timezone}
          onResume={resume}
          onDelete={(o) => {
            if (confirm(`Delete ${o.label}? Nothing was billed for it.`)) saveHeld(branchId, held.filter((h) => h.id !== o.id));
          }}
        />
      )}

      {tab === "sell" && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Category rail (desktop) */}
          <nav aria-label="Categories" className="sticky top-[4.5rem] hidden w-44 shrink-0 flex-col gap-1 lg:flex">
            {railItems.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={!query && category === c.key}
                onClick={() => pickCategory(c.key)}
                className={cx(
                  "flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors",
                  !query && category === c.key ? "bg-fg text-bg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                {c.star && <Star className="size-4 shrink-0" />}
                <span className="truncate">{c.label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-line px-3 text-left text-sm font-medium text-muted hover:border-line-strong hover:text-fg"
            >
              <Plus className="size-4 shrink-0" /> Not on the menu
            </button>
          </nav>

          {/* Menu */}
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            {/* Who is this for */}
            <div
              role="radiogroup"
              aria-label="Selling to"
              className="swipe-row -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
            >
              <TargetChip active={walkIn} onClick={() => pick(WALK_IN)} title="Walk-in" sub="Pay now" />
              {sessions.map((s) => (
                <TargetChip
                  key={s.id}
                  active={target === s.id}
                  onClick={() => pick(s.id)}
                  title={s.stations?.name ?? "Station"}
                  sub={
                    s.customer_name ||
                    (s.stations ? STATION_TYPE_LABEL[s.stations.type] : "") + (s.status === "paused" ? " · paused" : "")
                  }
                />
              ))}
            </div>

            {showNotice && (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-muted" />
                <span className="flex-1">
                  {target !== WALK_IN && !session ? "That station's session ended. The order is now a walk-in sale." : notice}
                </span>
                {fromFloor && session && (
                  <Link href="/dashboard" className="shrink-0 font-medium underline underline-offset-4">
                    Back to Floor
                  </Link>
                )}
              </p>
            )}

            {products.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
                No items yet.{" "}
                {owner ? (
                  <Link href="/inventory" className="font-medium text-fg underline underline-offset-4">
                    Add snacks and drinks
                  </Link>
                ) : (
                  "The owner adds them under Snacks & drinks"
                )}
                , or sell something not on the menu.
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => setCustomOpen(true)}>
                    <Plus /> Not on the menu
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") return setQuery("");
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const code = query.trim();
                      if (code && products.some((p) => p.barcode === code)) {
                        addByBarcode(code);
                        setQuery("");
                        return;
                      }
                      const first = matches[0];
                      if (first && !isOut(first)) {
                        add(first);
                        setQuery("");
                      }
                    }}
                    placeholder={`Search ${products.length} items or scan a barcode`}
                    aria-label="Search the menu"
                    autoComplete="off"
                    className="h-11 pl-10 pr-10 text-[15px]"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                      className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-fg"
                    >
                      <X className="size-4" />
                    </button>
                  ) : (
                    <ScanBarcode
                      aria-hidden
                      className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-faint"
                    />
                  )}
                </div>

                {/* Categories (phones and tablets) */}
                <CategoryChips
                  tabs={railItems}
                  active={query ? null : category}
                  onPick={pickCategory}
                  className="-mx-4 px-4 lg:hidden"
                />

                {query && (
                  <p className="-mb-1 text-xs text-muted">
                    {matches.length} {matches.length === 1 ? "match" : "matches"} in every category. Enter adds the first.
                  </p>
                )}

                <ul
                  aria-label="Menu"
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                >
                  {matches.map((p, i) => (
                    <li key={p.id}>
                      <ItemTile product={p} qty={inCart(p.id)} highlight={i === 0 && Boolean(query)} onAdd={() => add(p)} />
                    </li>
                  ))}
                  <li className="lg:hidden">
                    <button
                      type="button"
                      onClick={() => setCustomOpen(true)}
                      className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line p-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
                    >
                      <Plus className="size-5" />
                      Not on the menu
                    </button>
                  </li>
                </ul>
                {matches.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted">
                    {query ? `Nothing matches “${query}”.` : "Nothing in this category."}
                  </p>
                )}
              </>
            )}

            {/* Room for the order bar on phones and tablets */}
            <div aria-hidden className="h-20 lg:hidden" />
          </section>

          {/* Order: beside the menu on desktop */}
          <aside
            aria-label="Order"
            className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-6rem)] w-[380px] shrink-0 flex-col rounded-2xl border border-line bg-panel shadow-card lg:flex"
          >
            {desktop && (
              <>
                <header className="border-b border-line px-4 py-3">
                  <h2 className="text-base font-semibold">{orderTitle}</h2>
                  {session?.customer_name && !sold && <p className="text-[13px] text-muted">{session.customer_name}</p>}
                </header>
                <div className="flex-1 overflow-y-auto p-4">{body}</div>
                <footer className="border-t border-line p-4">{action}</footer>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Order: a bar above the bottom navigation on phones and tablets, opening into a sheet */}
      {!desktop && tab === "sell" && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-panel/95 px-4 py-2.5 backdrop-blur-md md:bottom-0 md:left-60 md:pb-[calc(10px+env(safe-area-inset-bottom))] lg:hidden">
          <button
            type="button"
            onClick={() => setOrderOpen(true)}
            className={cx(
              "flex h-12 w-full items-center justify-between gap-3 rounded-xl px-4 text-left font-medium transition-colors",
              cart.length > 0 ? "bg-fg text-bg" : "border border-line text-muted",
            )}
          >
            <span className="min-w-0 truncate text-[15px]">
              {cart.length > 0
                ? `${count} ${count === 1 ? "item" : "items"} · ${session ? stationName : "walk-in"}`
                : session
                  ? `${stationName} bill${billTotal > 0 ? ` · ${formatINR(billTotal)} so far` : ""}`
                  : "Order is empty"}
            </span>
            <span className="num shrink-0 text-[15px] font-semibold">
              {cart.length > 0 ? `${formatINR(walkIn ? total : subtotal)} ›` : "View"}
            </span>
          </button>
        </div>
      )}
      {!desktop && (
        <Sheet
          open={orderOpen}
          onOpenChange={setOrderOpen}
          title={orderTitle}
          description={session?.customer_name && !sold ? session.customer_name : undefined}
          footer={action}
        >
          {body}
        </Sheet>
      )}

      <CustomItemDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onAdd={(line) => {
          setSold(null);
          order.put(line);
        }}
      />
      {picker}
      <HoldDialog open={holdOpen} onOpenChange={setHoldOpen} suggested={name.trim()} onHold={hold} />
    </div>
  );
}

function HeldList({
  held,
  timezone,
  onResume,
  onDelete,
}: {
  held: HeldOrder[];
  timezone: string;
  onResume: (o: HeldOrder) => void;
  onDelete: (o: HeldOrder) => void;
}) {
  if (held.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
        <PauseCircle className="mx-auto mb-2 size-6 text-faint" />
        No orders on hold. Hold parks a walk-in order here (say the player went to get cash) so you can serve the next
        person. Held orders stay on this device and nothing is billed until you complete them.
      </div>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {held.map((o) => {
        const total = o.lines.reduce((t, l) => t + l.price * l.quantity, 0);
        return (
          <li key={o.id} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{o.label}</p>
                <p className="text-xs text-muted">Held at {formatTime(o.at, timezone)}</p>
              </div>
              <span className="num shrink-0 text-lg font-semibold">{formatINR(total)}</span>
            </div>
            <p className="line-clamp-2 text-sm text-muted">
              {o.lines.map((l) => `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`).join(", ")}
            </p>
            <div className="mt-auto flex gap-2">
              <Button className="flex-1" onClick={() => onResume(o)}>
                Open
              </Button>
              <Button variant="ghost" aria-label={`Delete ${o.label}`} onClick={() => onDelete(o)}>
                <Trash2 />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HoldDialog({
  open,
  onOpenChange,
  suggested,
  onHold,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggested: string;
  onHold: (label: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [shownFor, setShownFor] = useState(false);
  // Fill in the player's name each time the dialog opens.
  if (open !== shownFor) {
    setShownFor(open);
    if (open) setLabel(suggested);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Hold this order"
      description="Park it to serve someone else. Nothing is billed until you open it and complete the sale."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onHold(label);
          onOpenChange(false);
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name it (optional)
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rahul, or Table 3" maxLength={40} autoFocus />
        </label>
        <Button type="submit" size="lg">
          <PauseCircle /> Hold order
        </Button>
      </form>
    </Modal>
  );
}

function SoldView({ sold, branchName }: { sold: Sold; branchName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1.5 py-3 text-center">
        <CheckCircle2 className="size-10 text-ok" />
        <p className="num text-3xl font-semibold">{formatINR(sold.total)}</p>
        <p className="text-sm text-muted">
          Bill #{sold.number} · Paid by {sold.paidBy}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/bills/${sold.id}?print=1&from=counter`} className={buttonClass("secondary")}>
          <Printer /> Print bill
        </Link>
        <WhatsAppButton
          phone={sold.phone || undefined}
          venueName={branchName}
          billNumber={sold.number}
          dateTime={new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          items={sold.lines.map((l) => ({
            description: `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`,
            amount: formatINR(l.price * l.quantity),
          }))}
          total={formatINR(sold.total)}
          paidBy={sold.paidBy}
          size="md"
        />
      </div>
    </div>
  );
}

function CustomItemDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: CartLine) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const n = Number(price);
  const ok = name.trim() !== "" && price !== "" && n > 0 && n <= 50000;
  const close = () => {
    setName("");
    setPrice("");
    setQty(1);
    onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} title="Item not on the menu">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onAdd({ name: name.trim(), price: n, quantity: qty });
          close();
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Item
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Samosa" maxLength={80} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Price (₹ each)
            <Input type="number" inputMode="decimal" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="20" />
          </label>
          <div className="flex flex-col gap-1 text-sm font-medium">
            How many
            <div className="flex items-center gap-2">
              <StepButton label="One less" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                <Minus />
              </StepButton>
              <span className="num w-8 text-center text-base font-semibold">{qty}</span>
              <StepButton label="One more" onClick={() => setQty((q) => Math.min(100, q + 1))}>
                <Plus />
              </StepButton>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted">Sold once. It isn&apos;t added to the menu or the stock count.</p>
        <Button type="submit" size="lg" disabled={!ok}>
          Add to order{ok ? ` · ${formatINR(n * qty)}` : ""}
        </Button>
      </form>
    </Modal>
  );
}

function TargetChip({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        "flex min-h-12 shrink-0 flex-col justify-center rounded-xl border px-3.5 py-1.5 text-left transition-colors",
        active ? "border-fg bg-fg text-bg" : "border-line bg-panel hover:border-line-strong hover:bg-hover",
      )}
    >
      <span className="max-w-40 truncate text-sm font-semibold">{title}</span>
      {sub && <span className={cx("max-w-40 truncate text-xs", active ? "text-bg/75" : "text-muted")}>{sub}</span>}
    </button>
  );
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
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

// Desktop (lg and up) shows the order beside the menu; smaller screens use the bar and sheet.
// Only one of them is mounted, so the payment fields never exist twice.
const DESKTOP = "(min-width: 1024px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
