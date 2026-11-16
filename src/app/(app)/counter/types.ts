import type { StationType } from "@/lib/constants";

// Shared by the server page and the client screen. (A "use client" file can't hand plain values
// like the select strings below to a server component, so they live here.)

export type CounterProduct = {
  id: string;
  name: string;
  price: number;
  category: string;
  barcode: string | null;
  /** Sizes and add-ons (see readOptions in lib/menu). */
  options: unknown;
  /** null = not tracked */
  stock: number | null;
};

export const PRODUCT_SELECT = "id, name, price, category, barcode, options, stock";

export const OPEN_SESSION_SELECT = "id, status, customer_name, started_at, stations(name, type)";

export type OpenSessionRow = {
  id: string;
  status: string;
  customer_name: string | null;
  started_at: string;
  stations: { name: string; type: StationType } | null;
};

export type CartLine = {
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  /** Picked size and add-ons; the database prices them again from the item. */
  size?: string;
  addons?: string[];
};

/** Same item, same size, same add-ons: one line in the order. */
export function sameLine(a: CartLine, b: CartLine) {
  return (
    a.productId === b.productId &&
    a.name === b.name &&
    (a.size ?? "") === (b.size ?? "") &&
    (a.addons ?? []).join("|") === (b.addons ?? []).join("|")
  );
}

/** What goes to add_session_items / quick_sale for each line. */
export function lineForSale(l: CartLine) {
  return { product_id: l.productId ?? null, name: l.name, price: l.price, quantity: l.quantity, size: l.size, addons: l.addons };
}
