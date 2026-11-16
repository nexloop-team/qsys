import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { CounterScreen } from "./counter-screen";
import { OPEN_SESSION_SELECT, PRODUCT_SELECT, type CounterProduct, type OpenSessionRow } from "./types";

export const metadata: Metadata = { title: "Counter" };

export default function CounterPage(props: PageProps<"/counter">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Counter searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Counter({ searchParams }: { searchParams: PageProps<"/counter">["searchParams"] }) {
  const sp = await searchParams;
  const { branch, role } = await getAppContext();
  const supabase = await createClient();

  const [products, sessions, settings, top] = await Promise.all([
    supabase.from("products").select(PRODUCT_SELECT).eq("branch_id", branch.id).eq("is_active", true).order("name"),
    supabase.from("sessions").select(OPEN_SESSION_SELECT).eq("branch_id", branch.id).neq("status", "ended").order("started_at"),
    supabase
      .from("branch_settings")
      .select("gst_enabled, gst_rate, prices_include_tax, staff_max_discount_pct")
      .eq("branch_id", branch.id)
      .single(),
    supabase.rpc("top_products", { p_branch_id: branch.id }),
  ]);

  // Without the latest database changes the counter can't load its menu: say so plainly.
  if (products.error) {
    return (
      <div className="rounded-xl border border-line bg-panel p-5 text-sm shadow-card">
        <p className="font-semibold">The counter couldn&apos;t load the menu.</p>
        <p className="mt-1 text-muted">
          {products.error.message}. If you just updated the app, apply the latest database changes
          (npx supabase db push) and reload.
        </p>
      </div>
    );
  }

  const session = typeof sp.session === "string" ? sp.session : undefined;

  return (
    <CounterScreen
      // A different station from the Floor starts a fresh counter.
      key={session ?? "walk-in"}
      branchId={branch.id}
      branchName={branch.name}
      timezone={branch.timezone}
      owner={isOwner(role)}
      initialProducts={(products.data ?? []) as CounterProduct[]}
      initialSessions={(sessions.data ?? []) as unknown as OpenSessionRow[]}
      topSellers={(top.data ?? []).map((r) => r.product_id)}
      initialTarget={session}
      fromFloor={sp.from === "floor"}
      gst={{
        enabled: settings.data?.gst_enabled ?? false,
        rate: Number(settings.data?.gst_rate ?? 18),
        inclusive: settings.data?.prices_include_tax ?? false,
      }}
      discountLimit={isOwner(role) ? null : (settings.data?.staff_max_discount_pct ?? 10)}
    />
  );
}
