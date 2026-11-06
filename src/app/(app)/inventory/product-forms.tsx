"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Field, FormMessage, Input, Segmented, Select, SubmitButton } from "@/components/ui";
import { adjustStock, deleteProduct, saveProduct, toggleProduct } from "./actions";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/client";
import { QuickSaleDialog } from "../dashboard/quick-sale-dialog";

export type Product = {
  id: string;
  name: string;
  category: "beverage" | "snack" | "food" | "accessory" | "other";
  price: number;
  is_active: boolean;
  /** null = not tracked */
  stock: number | null;
  low_stock_at: number;
};

const CATEGORIES = [
  { value: "beverage", label: "Beverage (Cold drinks, Red Bull, Water)" },
  { value: "snack", label: "Snack (Chips, Kurkure, Chocolates)" },
  { value: "food", label: "Food (Maggi, Sandwiches, Fries)" },
  { value: "accessory", label: "Accessory / Gaming" },
  { value: "other", label: "Other" },
];

export function ProductDialogButton({
  product,
  trigger,
}: {
  product?: Product;
  trigger?: React.ReactNode;
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

      <Modal open={open} onOpenChange={setOpen} title={product ? "Edit item" : "Add snack or drink"}>
        <form action={action} className="flex flex-col gap-3">
          {product && <input type="hidden" name="id" value={product.id} />}
          <Field label="Item name" hint="e.g. Red Bull 250ml, Maggi, Lays">
            <Input name="name" defaultValue={product?.name ?? ""} placeholder="Monster Energy" required />
          </Field>

          <Field label="Category">
            <Select name="category" defaultValue={product?.category ?? "beverage"}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Price (₹)">
            <Input
              name="price"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              defaultValue={product?.price ?? ""}
              placeholder="120"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {!product && (
              <Field label="Count on hand" hint="Leave empty to not track stock.">
                <Input name="stock" type="number" inputMode="numeric" min={0} placeholder="e.g. 24" />
              </Field>
            )}
            <Field label="Warn when down to" hint="Low-stock badge at this count.">
              <Input name="low_stock_at" type="number" inputMode="numeric" min={0} defaultValue={product?.low_stock_at ?? 5} />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm pt-1">
            <input type="checkbox" name="is_active" defaultChecked={product?.is_active ?? true} className="size-4" />
            Available for sale
          </label>

          <FormMessage state={state} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">{product ? "Save changes" : "Add item"}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
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

export function QuickSalePOSButton({
  branchId,
  branchName,
  gst,
  discountLimit,
}: {
  branchId: string;
  branchName: string;
  gst: { enabled: boolean; rate: number; inclusive: boolean };
  discountLimit: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [supabase] = useState(createClient);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="gap-1.5">
        <ShoppingBag className="size-3.5" /> Sell Snacks (Quick Sale)
      </Button>
      <QuickSaleDialog
        open={open}
        onOpenChange={setOpen}
        branchId={branchId}
        branchName={branchName}
        supabase={supabase}
        gst={gst}
        discountLimit={discountLimit}
      />
    </>
  );
}

// Owner: record a delivery (+N) or a shelf count (exact number; any shortfall is logged as missing).
export function StockButton({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"receive" | "count">(product.stock === null ? "count" : "receive");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const n = Number(qty);
  const diff = mode === "count" && product.stock !== null && qty !== "" ? n - product.stock : null;

  const save = async () => {
    setPending(true);
    setError(undefined);
    const result = await adjustStock(product.id, mode, qty === "" ? null : n, note);
    setPending(false);
    if (result?.error) return setError(result.error);
    setOpen(false);
    setQty("");
    setNote("");
    router.refresh();
  };

  const stopTracking = async () => {
    if (!confirm(`Stop tracking stock for ${product.name}?`)) return;
    const result = await adjustStock(product.id, "count", null, "Stopped tracking");
    if (result?.error) return setError(result.error);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {product.stock === null ? "Track stock" : "Stock"}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`${product.name} · stock`}>
        <div className="flex flex-col gap-3">
          {product.stock !== null && (
            <Segmented
              value={mode}
              onChange={setMode}
              className="w-full"
              options={[
                { value: "receive", label: "Stock arrived" },
                { value: "count", label: "Count the shelf" },
              ]}
            />
          )}
          <Field
            label={mode === "receive" ? "How many arrived?" : "How many are on the shelf right now?"}
            hint={
              product.stock === null
                ? "This starts tracking: sales take it down automatically."
                : mode === "receive"
                  ? `Now ${product.stock}. After: ${product.stock + (n || 0)}.`
                  : `The app expects ${product.stock}.`
            }
          >
            <Input type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </Field>
          {diff !== null && diff !== 0 && (
            <p className={`text-sm ${diff < 0 ? "text-over" : "text-ok"}`}>
              {diff < 0 ? `${-diff} missing` : `${diff} more than expected`} · recorded with this count.
            </p>
          )}
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Supplier invoice 1024" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center justify-between gap-2">
            {product.stock !== null ? (
              <button
                type="button"
                className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline"
                onClick={stopTracking}
              >
                Stop tracking
              </button>
            ) : (
              <span />
            )}
            <Button onClick={save} disabled={pending || qty === "" || n < 0 || (mode === "receive" && n < 1)}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
