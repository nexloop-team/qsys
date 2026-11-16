// Snacks and drinks: categories are the venue's own names ("Energy drinks", "Maggi", "Combos").
// Before 20261203000002 there were five fixed codes; label() still reads those, in case an old
// row or a cached page shows up.

export const SUGGESTED_CATEGORIES = ["Drinks", "Snacks", "Food", "Accessories", "Other"];

const OLD_CODES: Record<string, string> = {
  beverage: "Drinks",
  snack: "Snacks",
  food: "Food",
  accessory: "Accessories",
  other: "Other",
};

export function categoryLabel(category: string) {
  return OLD_CODES[category] ?? category;
}

/** Categories in a sensible order: the suggested ones first (as they appear), then the rest A to Z. */
export function sortCategories(categories: string[]) {
  const unique = [...new Set(categories.map(categoryLabel))];
  const rank = (c: string) => {
    const i = SUGGESTED_CATEGORIES.indexOf(c);
    return i < 0 ? SUGGESTED_CATEGORIES.length : i;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Sizes and add-ons (products.options). The database prices them (private.price_item); this
// mirrors it so the counter shows the same name and price before the sale.
// ---------------------------------------------------------------------------
export type Choice = { name: string; price: number };
export type ProductOptions = { sizes: Choice[]; addons: Choice[] };

export function readOptions(raw: unknown): ProductOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<"sizes" | "addons", unknown>>;
  const list = (v: unknown): Choice[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is { name: string; price: number } => Boolean(x) && typeof x.name === "string")
          .map((x) => ({ name: x.name, price: Number(x.price) || 0 }))
      : [];
  return { sizes: list(o.sizes), addons: list(o.addons) };
}

export function hasChoices(raw: unknown) {
  const o = readOptions(raw);
  return o.sizes.length > 0 || o.addons.length > 0;
}

/** "Maggi (Full) + Extra cheese, Egg" and its price, as the bill will show it. */
export function pricedLine(base: { name: string; price: number; options: unknown }, size?: string, addons: string[] = []) {
  const o = readOptions(base.options);
  let name = base.name;
  let price = Number(base.price);
  const s = o.sizes.find((x) => x.name === size) ?? o.sizes[0];
  if (s) {
    name += ` (${s.name})`;
    price = s.price;
  }
  const picked = o.addons.filter((a) => addons.includes(a.name));
  if (picked.length) {
    name += ` + ${picked.map((a) => a.name).join(", ")}`;
    price += picked.reduce((t, a) => t + a.price, 0);
  }
  return { name, price, size: s?.name, addons: picked.map((a) => a.name) };
}
