"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Field, FormMessage, Input, Segmented, SubmitButton } from "@/components/ui";
import { adjustStock, deleteProduct, saveProduct, toggleProduct } from "./actions";
import type { ActionState } from "@/lib/action-state";
import { formatINR } from "@/lib/format";
import { SUGGESTED_CATEGORIES, categoryLabel, readOptions, sortCategories } from "@/lib/menu";
import { LOSS_LABEL, type LossReason } from "./snacks-report";

export type Product = {
  id: string;
  name: string;
  category: string;
  barcode: string | null;
  /** Sizes and add-ons (lib/menu readOptions). */
  options: unknown;
  price: number;
  /** Average buying price; null = not set */
  cost: number | null;
  is_active: boolean;
  /** null = not tracked */
  stock: number | null;
  low_stock_at: number;
};

export function ProductDialogButton({
  product,
  trigger,
  categories = SUGGESTED_CATEGORIES,
}: {
  product?: Product;
  trigger?: React.ReactNode;
  /** The venue's categories so far, offered as suggestions. */
  categories?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await saveProduct(prev, fd);
    if (res?.ok) setOpen(false);
    return res;
  }, null);

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Add item
        </Button>
      )}

      <Modal open={open} onOpenChange={setOpen} wide title={product ? `Edit ${product.name}` : "Add snack or drink"}>
        {/* Keyed so reopening starts from the saved item, not from half-edited rows. */}
        {open && <ProductForm key={product?.id ?? "new"} product={product} categories={categories} action={action} state={state} onCancel={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function ProductForm({
  product,
  categories,
  action,
  state,
  onCancel,
}: {
  product?: Product;
  categories: string[];
  action: (fd: FormData) => void;
  state: ActionState;
  onCancel: () => void;
}) {
  const initial = readOptions(product?.options);
  const [sizes, setSizes] = useState<Row[]>(initial.sizes.map((c) => ({ name: c.name, price: String(c.price) })));
  const [addons, setAddons] = useState<Row[]>(initial.addons.map((c) => ({ name: c.name, price: String(c.price) })));
  const [price, setPrice] = useState(product ? String(product.price) : "");

  const clean = (rows: Row[]) =>
    rows.filter((r) => r.name.trim() || r.price !== "").map((r) => ({ name: r.name.trim(), price: Number(r.price) || 0 }));
  const options = JSON.stringify({ sizes: clean(sizes), addons: clean(addons) });
  const sized = clean(sizes).length > 0;

  return (
    <form action={action} className="flex flex-col gap-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="options" value={options} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item name" hint="Such as Red Bull 250ml, Maggi or Lays">
          <Input name="name" defaultValue={product?.name ?? ""} placeholder="Maggi" required />
        </Field>
        <Field label="Category" hint="Pick one or type a new one.">
          <Input
            name="category"
            list="product-categories"
            defaultValue={product ? categoryLabel(product.category) : ""}
            placeholder="Food"
            maxLength={30}
            required
          />
          <datalist id="product-categories">
            {sortCategories([...SUGGESTED_CATEGORIES, ...categories]).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {sized ? (
          <Field label="Selling price" hint="Set by the sizes below.">
            <input type="hidden" name="price" value={clean(sizes)[0]?.price ?? 0} />
            <Input value={`From ${formatINR(Math.min(...clean(sizes).map((x) => x.price)))}`} disabled />
          </Field>
        ) : (
          <Field label="Selling price (₹)">
            <Input
              name="price"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="60"
              required
            />
          </Field>
        )}
        <Field label="Buying price (₹)" hint="What you pay for one. Only you see it.">
          <Input name="cost" type="number" inputMode="decimal" min={0} step="any" defaultValue={product?.cost ?? ""} placeholder="35" />
        </Field>
        <Field label="Barcode (optional)" hint="Scan it here to fill it in.">
          <Input name="barcode" defaultValue={product?.barcode ?? ""} inputMode="numeric" autoComplete="off" maxLength={40} />
        </Field>
      </div>

      <ChoiceRows
        title="Sizes"
        hint="Half and Full, Small and Large. Each has its own price; the counter asks which one."
        addLabel="Add a size"
        namePlaceholder="Full"
        rows={sizes}
        onChange={setSizes}
        max={10}
      />
      <ChoiceRows
        title="Add-ons"
        hint="Extras with their own price, such as Extra cheese or Egg. Any number can be picked."
        addLabel="Add an add-on"
        namePlaceholder="Extra cheese"
        rows={addons}
        onChange={setAddons}
        max={20}
        plus
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {!product && (
          <Field label="Count on hand" hint="Leave empty to not track stock.">
            <Input name="stock" type="number" inputMode="numeric" min={0} placeholder="24" />
          </Field>
        )}
        <Field label="Warn when down to" hint="Shows as running low at this count.">
          <Input name="low_stock_at" type="number" inputMode="numeric" min={0} defaultValue={product?.low_stock_at ?? 5} />
        </Field>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={product?.is_active ?? true} className="size-4" />
        On sale (shows on the Counter, the table QR page and the PC menu)
      </label>

      <FormMessage state={state} />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…">{product ? "Save changes" : "Add item"}</SubmitButton>
      </div>
    </form>
  );
}

type Row = { name: string; price: string };

function ChoiceRows({
  title,
  hint,
  addLabel,
  namePlaceholder,
  rows,
  onChange,
  max,
  plus = false,
}: {
  title: string;
  hint: string;
  addLabel: string;
  namePlaceholder: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  max: number;
  plus?: boolean;
}) {
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="rounded-xl border border-line p-3">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {rows.length > 0 && (
        <ul className="mb-2 flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2">
              <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={namePlaceholder} maxLength={30} aria-label={`${title} name`} />
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={r.price}
                onChange={(e) => set(i, { price: e.target.value })}
                placeholder={plus ? "+₹" : "₹"}
                aria-label={`${title} price`}
              />
              <Button type="button" variant="ghost" aria-label={`Remove ${r.name || title.toLowerCase()}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rows.length < max && (
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, { name: "", price: "" }])}>
          <Plus /> {addLabel}
        </Button>
      )}
    </section>
  );
}

export function DeleteProductButton({ id, name }: { id: string; name: string }) {
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${name}"?`)) return;
    setPending(true);
    await deleteProduct(id);
    setPending(false);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleDelete} disabled={pending} aria-label={`Delete ${name}`}>
      <Trash2 className="size-3.5 text-danger" />
    </Button>
  );
}

export function ToggleProductButton({ id, active }: { id: string; active: boolean }) {
  const [pending, setPending] = useState(false);

  const handleToggle = async () => {
    setPending(true);
    await toggleProduct(id, !active);
    setPending(false);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
        active ? "bg-free/10 text-free hover:bg-free/20" : "bg-faint/20 text-muted hover:bg-faint/30"
      }`}
    >
      {active ? "Active" : "Hidden"}
    </button>
  );
}

const WRITE_OFF_REASONS = Object.keys(LOSS_LABEL) as LossReason[];

// Owner: a delivery (+N, with what was paid), a write-off (-N, with why), or a shelf count
// (the exact number; any shortfall is logged as missing). Every change is in the stock history.
export function StockButton({ product }: { product: Product }) {
  const tracked = product.stock !== null;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"receive" | "write_off" | "count">(tracked ? "receive" : "count");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState<LossReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const stock = product.stock ?? 0;
  const n = Number(qty);
  const c = Number(unitCost);
  const diff = mode === "count" && tracked && qty !== "" ? n - stock : null;
  // What the average buying price becomes after this delivery.
  const newAverage =
    mode === "receive" && unitCost !== "" && n > 0
      ? product.cost === null || stock <= 0
        ? c
        : (stock * product.cost + n * c) / (stock + n)
      : null;

  const reset = () => {
    setQty("");
    setUnitCost("");
    setReason(null);
    setNote("");
    setError(undefined);
  };

  const save = async () => {
    setPending(true);
    setError(undefined);
    const result = await adjustStock({
      productId: product.id,
      mode,
      qty: qty === "" ? null : n,
      note,
      unitCost: mode === "receive" && unitCost !== "" ? c : null,
      reason: mode === "write_off" ? reason : null,
    });
    setPending(false);
    if (result?.error) return setError(result.error);
    setOpen(false);
    reset();
    router.refresh();
  };

  const stopTracking = async () => {
    if (!confirm(`Stop counting stock for ${product.name}?`)) return;
    const result = await adjustStock({ productId: product.id, mode: "count", qty: null, note: "Stopped tracking" });
    if (result?.error) return setError(result.error);
    setOpen(false);
    router.refresh();
  };

  const valid =
    qty !== "" &&
    Number.isInteger(n) &&
    (mode === "count" ? n >= 0 : n >= 1) &&
    (mode !== "write_off" || (reason !== null && (!tracked || n <= stock))) &&
    (mode !== "receive" || unitCost === "" || c >= 0);

  const qtyLabel =
    mode === "receive" ? "How many arrived?" : mode === "write_off" ? "How many to take off?" : "How many are on the shelf right now?";
  const qtyHint =
    !tracked && mode === "count"
      ? "This starts counting: sales take it down automatically."
      : mode === "receive"
        ? `Now ${stock}. After: ${stock + (n || 0)}.`
        : mode === "write_off"
          ? tracked
            ? `Now ${stock}. After: ${Math.max(stock - (n || 0), 0)}.${product.cost !== null && n > 0 ? ` Loss: ${formatINR(n * product.cost)}.` : ""}`
            : "Stock isn't counted, so only the loss is recorded."
          : `The app expects ${stock}.`;
  const costHint =
    newAverage !== null
      ? `Buying price becomes ${formatINR(Math.round(newAverage * 100) / 100)}${product.cost !== null ? `, from ${formatINR(product.cost)}` : ""}.`
      : product.cost !== null
        ? `Now ${formatINR(product.cost)}. Leave empty to keep it.`
        : "Sets the buying price, for profit.";

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {tracked ? "Stock" : "Track stock"}
      </Button>
      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
        title={`${product.name} · stock`}
        description={tracked ? `${stock} on the shelf` : "Stock isn't counted yet"}
      >
        <div className="flex flex-col gap-3">
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(undefined);
            }}
            className="w-full"
            options={[
              { value: "receive", label: "Arrived", disabled: !tracked },
              { value: "write_off", label: "Write off" },
              { value: "count", label: tracked ? "Count" : "Start counting" },
            ]}
          />

          {mode === "write_off" && (
            <div role="radiogroup" aria-label="Why" className="grid grid-cols-2 gap-2">
              {WRITE_OFF_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  onClick={() => setReason(r)}
                  className={
                    "min-h-11 rounded-lg border px-3 text-left text-sm font-medium transition-colors " +
                    (reason === r ? "border-fg bg-fg text-bg" : "border-line hover:bg-hover")
                  }
                >
                  {LOSS_LABEL[r]}
                </button>
              ))}
            </div>
          )}

          <Field label={qtyLabel} hint={qtyHint}>
            <Input type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </Field>

          {mode === "receive" && (
            <Field label="Paid for one (₹, optional)" hint={costHint}>
              <Input type="number" inputMode="decimal" min={0} step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </Field>
          )}

          {diff !== null && diff !== 0 && (
            <p className={`text-sm ${diff < 0 ? "text-over" : "text-ok"}`}>
              {diff < 0 ? `${-diff} missing` : `${diff} more than expected`} · recorded with this count.
            </p>
          )}
          <Field label="Note (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder={mode === "receive" ? "Supplier bill 1024" : mode === "write_off" ? "Dropped at table 3" : ""}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center justify-between gap-2">
            {tracked ? (
              <button
                type="button"
                className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline"
                onClick={stopTracking}
              >
                Stop counting
              </button>
            ) : (
              <span />
            )}
            <Button onClick={save} disabled={pending || !valid}>
              {pending ? "Saving…" : mode === "write_off" ? "Write off" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
