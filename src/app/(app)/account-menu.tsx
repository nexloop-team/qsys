import Link from "next/link";
import { LogOut } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/constants";
import { todayIn } from "@/lib/format";
import { countDueExpenses } from "@/lib/expenses-due";
import { logout } from "@/app/(auth)/actions";
import { BranchSwitcher } from "./branch-switcher";
import { SidebarNav } from "./nav-links";
import { SearchButton } from "./search";

export async function AccountMenu() {
  const { org, user, role } = await getAppContext();
  const initials = (user.fullName || user.email).slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
      <Link
        href="/settings/account"
        title="Your account"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-fg ring-1 ring-line"
      >
        {initials}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{user.fullName || user.email}</p>
        <p className="truncate text-[11px] text-muted">
          {ROLE_LABEL[role]} · {org.name}
        </p>
      </div>
      <form action={logout}>
        <button
          type="submit"
          title="Log out"
          aria-label="Log out"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );
}

// Venue + branch at the top of the sidebar; switching branch happens here.
export async function VenueCard() {
  const { org, branch, branches } = await getAppContext();
  const initials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-bg px-2.5 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-[12px] font-semibold text-accent-fg">
        {initials || "Q"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{org.name}</p>
        {branches.length > 1 ? (
          <BranchSwitcher branches={branches} activeId={branch.id} />
        ) : (
          <p className="truncate text-xs text-muted">{branch.name}</p>
        )}
      </div>
    </div>
  );
}

// Sidebar links with live counts: sessions running now, and (owner) monthly costs still due.
export async function SidebarNavWithBadges() {
  const { org, branch, role } = await getAppContext();
  const supabase = await createClient();
  const monthStart = `${todayIn(branch.timezone).slice(0, 7)}-01`;
  const [{ count: live }, due] = await Promise.all([
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branch.id)
      .neq("status", "ended"),
    isOwner(role) ? countDueExpenses(supabase, org.id, branch.id, monthStart) : Promise.resolve(0),
  ]);
  return <SidebarNav badges={{ live: live ?? 0, due }} />;
}

// Search button for the top bar; needs the venue and branch to search in.
export async function TopbarSearch() {
  const { org, branch } = await getAppContext();
  return <SearchButton orgId={org.id} branchId={branch.id} />;
}
