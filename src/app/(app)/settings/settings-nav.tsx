"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/styles";

const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/branches", label: "Branches" },
  { href: "/settings/activity", label: "Activity" },
  { href: "/settings/account", label: "Account" },
] as const;

export function SettingsNav() {
  return <TabList pathname={usePathname()} />;
}

export function SettingsNavFallback() {
  return <TabList pathname="" />;
}

function TabList({ pathname }: { pathname: string }) {
  return (
    <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 border-b border-line md:flex-col md:gap-px md:border-b-0">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block whitespace-nowrap px-3 py-2 text-[13px] font-medium transition-colors md:rounded-lg",
                  active
                    ? "border-b-2 border-accent text-fg md:border-b-0 md:bg-accent-soft"
                    : "border-b-2 border-transparent text-muted hover:text-fg md:border-b-0 md:hover:bg-hover",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
