"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronRight,
  Coffee,
  Contact,
  LayoutGrid,
  LogOut,
  Menu,
  Monitor,
  ReceiptText,
  Settings,
  Tags,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/overlay";
import { logout } from "@/app/(auth)/actions";
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
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/expenses", label: "Expenses", icon: Wallet },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/stations", label: "Stations", icon: Monitor },
      { href: "/pricing", label: "Pricing", icon: Tags },
      { href: "/inventory", label: "Snacks & Drinks", icon: Coffee },
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
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-accent-soft text-fg"
                        : "text-muted hover:bg-hover hover:text-fg",
                    )}
                  >
                    <Icon
                      className={cx("size-4", active ? "text-accent-ink" : "text-faint group-hover:text-muted")}
                      strokeWidth={1.9}
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
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
  const inMore = pathname !== "" && !MOBILE_PRIMARY.some((i) => isActive(pathname, i.href));

  return (
    <>
      <ul className="grid grid-cols-4">
        {MOBILE_PRIMARY.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                isActive(pathname, href) ? "text-accent-ink" : "text-muted",
              )}
            >
              <Icon className="size-5" strokeWidth={1.9} />
              {label}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cx(
              "flex min-h-14 w-full flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
              inMore ? "text-accent-ink" : "text-muted",
            )}
          >
            <Menu className="size-5" strokeWidth={1.9} />
            More
          </button>
        </li>
      </ul>
      <Sheet open={open} onOpenChange={setOpen} title="More">
        <MoreMenu pathname={pathname} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

// Phone "More" sheet. Only what the bottom bar doesn't already show; 48px rows for thumbs;
// account first and log out last (the sidebar's account box isn't on phones).
function MoreMenu({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const row = "flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors";
  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/settings/account"
        onClick={onNavigate}
        className={cx(row, "border border-line", isActive(pathname, "/settings/account") ? "bg-accent-soft" : "hover:bg-hover")}
      >
        <UserRound className="size-5 text-muted" strokeWidth={1.9} />
        <span className="flex-1">Your account</span>
        <ChevronRight className="size-4 text-faint" />
      </Link>

      {GROUPS.slice(1).map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{group.label}</p>
          <ul className="flex flex-col">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(row, active ? "bg-accent-soft text-fg" : "text-fg hover:bg-hover")}
                  >
                    <Icon className={cx("size-5", active ? "text-fg" : "text-muted")} strokeWidth={1.9} />
                    <span className="flex-1">{label}</span>
                    <ChevronRight className="size-4 text-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <form action={logout} className="border-t border-line pt-4">
        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-line text-[15px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <LogOut className="size-5" strokeWidth={1.9} /> Log out
        </button>
      </form>
    </div>
  );
}
