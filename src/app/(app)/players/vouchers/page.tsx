import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Ticket } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR, todayIn } from "@/lib/format";
import { Badge, Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { CreateVouchersButton, VoidVoucherButton, showCode } from "../voucher-forms";

export const metadata: Metadata = { title: "Vouchers" };

export default function VouchersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Vouchers />
    </Suspense>
  );
}

async function Vouchers() {
  const { org, branch, role } = await getAppContext();
  const supabase = await createClient();
  const { data: vouchers } = await supabase
    .from("vouchers")
    .select("id, code, amount, note, expires_on, created_at, redeemed_at, voided_at, customers(id, name)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(300);

  const today = todayIn(branch.timezone);
  const list = (vouchers ?? []).map((v) => ({
    ...v,
    status: v.voided_at
      ? ("cancelled" as const)
      : v.redeemed_at
        ? ("used" as const)
        : v.expires_on && v.expires_on < today
          ? ("expired" as const)
          : ("unused" as const),
  }));
  const unused = list.filter((v) => v.status === "unused");
  const owner = isOwner(role);

  return (
    <>
      <Link href="/players" className={buttonClass("ghost", "sm", "mb-3")}>
        <ArrowLeft /> Players
      </Link>
      <PageHeader
        title="Vouchers"
        description={`One-time codes that add money to a player's wallet: contest prizes, a free hour for a regular who had a bad night. ${unused.length} unused worth ${formatINR(unused.reduce((t, v) => t + Number(v.amount), 0))}.`}
        actions={owner ? <CreateVouchersButton venueName={org.name} /> : undefined}
      />
      <Panel flush>
        {list.length === 0 ? (
          <Empty icon={<Ticket />} title="No vouchers yet">
            {owner ? "Make a few for your next Instagram contest." : "The owner makes vouchers here."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((v) => {
              const customer = Array.isArray(v.customers) ? v.customers[0] : v.customers;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className={`num w-28 font-medium tracking-[0.08em] ${v.status === "unused" ? "" : "text-muted"}`}>
                    {showCode(v.code)}
                  </span>
                  <span className="num w-20 font-semibold">{formatINR(v.amount)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {v.status === "used" && v.redeemed_at ? (
                      <>
                        Used {formatDateTime(v.redeemed_at, branch.timezone)}
                        {customer && (
                          <>
                            {" by "}
                            <Link href={`/players/${customer.id}`} className="text-fg hover:underline">
                              {customer.name}
                            </Link>
                          </>
                        )}
                      </>
                    ) : (
                      [v.note, v.expires_on ? `until ${new Date(`${v.expires_on}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}` : null]
                        .filter(Boolean)
                        .join(" · ")
                    )}
                  </span>
                  <Badge tone={v.status === "unused" ? "free" : v.status === "used" ? "neutral" : "ending"}>{v.status}</Badge>
                  {owner && v.status === "unused" && <VoidVoucherButton voucherId={v.id} code={v.code} />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
