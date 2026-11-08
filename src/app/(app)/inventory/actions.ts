"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(1, "Enter a product name.").max(80),
  category: z.enum(["beverage", "snack", "food", "accessory", "other"]),
  price: z.coerce.number().min(0, "Price can't be negative.").max(50000),
  is_active: z.boolean().default(true),
  low_stock_at: z.coerce.number().int().min(0).max(10000).default(5),
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

  const { id, stock, ...values } = parsed.data;
  const supabase = await createClient();

  const { error } = id
    ? await supabase.from("products").update(values).eq("id", id)
    : await supabase.from("products").insert({ ...values, stock: stock ?? null, org_id: org.id, branch_id: branch.id });

  if (error) return { error: friendlyDbError(error) };

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


export async function adjustStock(
  productId: string,
  mode: "receive" | "count",
  qty: number | null,
  note: string,
): Promise<ActionState> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_product_id: productId,
    p_mode: mode,
    p_qty: qty,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Stock updated." };
}
