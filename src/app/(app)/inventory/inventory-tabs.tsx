import Link from "next/link";
import { cx } from "@/components/styles";

// Snacks & drinks has two pages for the owner: the items, and every stock change.
export function InventoryTabs({ active }: { active: "items" | "history" }) {
  const tabs = [
    { key: "items", href: "/inventory", label: "Items" },
    { key: "history", href: "/inventory/history", label: "Stock history" },
  ] as const;
  return (
    <nav aria-label="Snacks and drinks" className="mb-5 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors",
            active === t.key ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
