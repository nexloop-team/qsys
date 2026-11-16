"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";
import { sqlNull } from "@/lib/sql-null";

// Sizes ("Half ₹40, Full ₹70") and add-ons ("Extra cheese +₹20"), sent from the form as JSON.
const choice = z.object({
  name: z.string().trim().min(1, "Give every size and add-on a name.").max(30, "Keep size and add-on names short."),
  price: z.coerce.number().min(0, "Prices can't be negative.").max(50000),
});
const optionsSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return { sizes: [], addons: [] };
    try {
      return JSON.parse(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Couldn't read the sizes and add-ons." });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .object({
        sizes: z.array(choice).max(10, "Up to 10 sizes.").default([]),
        addons: z.array(choice).max(20, "Up to 20 add-ons.").default([]),
      })
      .refine((o) => new Set(o.sizes.map((x) => x.name.toLowerCase())).size === o.sizes.length, "Two sizes have the same name.")
      .refine((o) => new Set(o.addons.map((x) => x.name.toLowerCase())).size === o.addons.length, "Two add-ons have the same name."),
  );

const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(1, "Enter a product name.").max(80),
  category: z.string().trim().min(1, "Pick a category.").max(30, "Keep the category under 30 characters."),
  // From a scanner or typed; empty = none.
  barcode: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().regex(/^[A-Za-z0-9-]{3,40}$/, "A barcode is 3 to 40 letters or digits.").nullable())
    .optional(),
  price: z.coerce.number().min(0, "Price can't be negative.").max(50000),
  is_active: z.boolean().default(true),
  low_stock_at: z.coerce.number().int().min(0).max(10000).default(5),
  // Buying price for one; empty = not set.
  cost: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().min(0, "Buying price can't be negative.").max(50000).nullable())
    .optional(),
  // Only on create: the starting count. Later changes go through adjustStock (logged).
  stock: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(0, "Stock can't be negative.").max(100000).nullable())
    .optional(),
});

export async function saveProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, branch } = await requireRole(["owner"]);
  const parsed = productSchema.safeParse({
    ...Object.fromEntries(formData),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const options = optionsSchema.safeParse(formData.get("options") ?? undefined);
  if (!options.success) return { error: firstIssue(options.error) };

  const { id, stock, cost, ...values } = parsed.data;
  const row = { ...values, options: options.data };
  const supabase = await createClient();

  const saved = id
    ? await supabase.from("products").update(row).eq("id", id).select("id").single()
    : await supabase
        .from("products")
        .insert({ ...row, stock: stock ?? null, org_id: org.id, branch_id: branch.id })
        .select("id")
        .single();

  // The only unique thing on an item is its barcode (per branch).
  if (saved.error) {
    return { error: saved.error.code === "23505" ? "Another item already has that barcode." : friendlyDbError(saved.error) };
  }

  // Buying prices are owner-only in the database, so they're set through their own function.
  if (cost !== undefined) {
    const { error } = await supabase.rpc("set_product_cost", { p_product_id: saved.data.id, p_cost: sqlNull(cost) });
    if (error) return { error: friendlyDbError(error) };
  }

  refresh();
  return { ok: id ? "Item updated." : "Item added." };
}

export async function deleteProduct(id: string): Promise<ActionState> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: "Deleted." };
}

export async function toggleProduct(id: string, is_active: boolean): Promise<ActionState> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ is_active }).eq("id", id);
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return { ok: is_active ? "Item is on sale again." : "Item hidden." };
}


export async function adjustStock({
  productId,
  mode,
  qty,
  note,
  unitCost = null,
  reason = null,
}: {
  productId: string;
  mode: "receive" | "write_off" | "count";
  qty: number | null;
  note: string;
  unitCost?: number | null;
  reason?: string | null;
}): Promise<ActionState> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_product_id: productId,
    p_mode: mode,
    p_qty: sqlNull(qty),
    p_note: note.trim() || undefined,
    p_unit_cost: unitCost ?? undefined,
    p_reason: reason ?? undefined,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Stock updated." };
}
