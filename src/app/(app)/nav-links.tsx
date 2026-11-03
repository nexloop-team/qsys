"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Contact,
  LayoutGrid,
  Menu,
  Monitor,
  ReceiptText,
  Settings,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/overlay";
import { cx } from "@/components/ui";

type NavItem = { href: string; label: string; icon: LucideIcon };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { href: "/dashboard", label: "Floor", icon: LayoutGrid },
      { href: "/bills", label: "Bills", icon: ReceiptText },
      { href: "/players", label: "Players", icon: Contact },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "Setup",
    items: [
      { href: "/stations", label: "Stations", icon: Monitor },
      { href: "/pricing", label: "Pricing", icon: Tags },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const MOBILE_PRIMARY = GROUPS[0].items;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  return <SidebarList pathname={usePathname()} />;
}

// Rendered in the static shell before the URL is known (no active highlight).
export function SidebarNavFallback() {
  return <SidebarList pathname="" />;
}

function SidebarList({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-5 px-2.5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cx(
                    "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    isActive(pathname, href) ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function MobileNav() {
  return <MobileList pathname={usePathname()} />;
}

export function MobileNavFallback() {
  return <MobileList pathname="" />;
}

function MobileList({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const inMore = !MOBILE_PRIMARY.some((i) => isActive(pathname, i.href));

  return (
    <>
      <ul className="grid grid-cols-4">
        {MOBILE_PRIMARY.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={cx(
                "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                isActive(pathname, href) ? "text-fg" : "text-muted",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              {label}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cx(
              "flex w-full flex-col items-center gap-1 py-2 text-[11px] font-medium",
              inMore ? "text-fg" : "text-muted",
            )}
          >
            <Menu className="size-5" strokeWidth={1.75} />
            More
          </button>
        </li>
      </ul>
      <Sheet open={open} onOpenChange={setOpen} title="Menu">
        <div onClick={() => setOpen(false)}>
          <SidebarNav />
        </div>
      </Sheet>
    </>
  );
}
