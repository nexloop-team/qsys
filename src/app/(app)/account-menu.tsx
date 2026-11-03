import Link from "next/link";
import { LogOut } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/constants";
import { formatINR, nextDay, todayIn, zonedStart } from "@/lib/format";
import { logout } from "@/app/(auth)/actions";
import { BranchSwitcher } from "./branch-switcher";

export async function AccountMenu() {
  const { org, user, role } = await getAppContext();
  const initials = (user.fullName || user.email).slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
      <Link
        href="/settings/account"
        title="Your account"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink ring-1 ring-accent/20"
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

// Top bar: branch, and today's takings (from bills, in the branch's time zone).
export async function TopbarStatus() {
  const { branch, branches } = await getAppContext();
  const supabase = await createClient();
  const today = todayIn(branch.timezone);
  const { data: invoices } = await supabase
    .from("invoices")
    .select("total")
    .eq("branch_id", branch.id)
    .gte("created_at", zonedStart(today, branch.timezone))
    .lt("created_at", zonedStart(nextDay(today), branch.timezone));
  const collected = (invoices ?? []).reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="ml-auto flex items-center gap-2">
      <Link
        href="/bills"
        title="Collected today"
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium shadow-xs transition-colors hover:bg-hover"
      >
        <span className="size-1.5 rounded-full bg-free" aria-hidden />
        <span className="text-muted">Today</span>
        <span className="num text-[13px]">{formatINR(collected)}</span>
      </Link>
      <BranchSwitcher branches={branches} activeId={branch.id} />
    </div>
  );
}
