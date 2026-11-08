"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/styles";

const TABS = [
  { href: "/settings", label: "Venue" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/branches", label: "Branches" },
  { href: "/settings/pc", label: "PC app" },
  { href: "/settings/online", label: "Online" },
  { href: "/settings/activity", label: "Activity" },
  { href: "/settings/account", label: "Account" },
] as const;

export function SettingsNav() {
  return <TabList pathname={usePathname()} />;
}

export function SettingsNavFallback() {
  return <TabList pathname="" />;
}

// Tabs across the top on every screen size; they scroll sideways on a phone.
function TabList({ pathname }: { pathname: string }) {
  // On a phone the later tabs start off-screen: bring the current one into view.
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Settings" className="swipe-row -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 border-b border-line">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                ref={active ? activeRef : undefined}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "-mb-px block whitespace-nowrap rounded-t-md border-b-2 px-3 py-2.5 text-[13px] transition-colors focus-visible:outline-offset-[-2px] pointer-coarse:py-3",
                  active ? "border-fg font-semibold text-fg" : "border-transparent font-medium text-muted hover:text-fg",
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
