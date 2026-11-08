import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Contact } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { AddPlayerButton, EditPlayerButton, PlayerSearch, TopupWalletButton } from "./player-forms";
import { DuesReminderButton } from "./khata-controls";

export const metadata: Metadata = { title: "Players" };

export default function PlayersPage(props: PageProps<"/players">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Players searchParams={props.searchParams} />
    </Suspense>
  );
}

function formatPhone(p: string) {
  return `${p.slice(0, 5)} ${p.slice(5)}`;
}

const PAGE_SIZE = 50;

async function Players({ searchParams }: { searchParams: PageProps<"/players">["searchParams"] }) {
  const { org, role, branch } = await getAppContext();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 40) : "";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  const supabase = await createClient();
  const [res, { data: orgRow }, { data: owing }] = await Promise.all([
    supabase.rpc("list_customers", {
      p_org_id: org.id,
      p_search: q || undefined,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.from("orgs").select("wallet_offers").eq("id", org.id).single(),
    // Money owed: unpaid sessions across the venue, summed per player below.
    supabase
      .from("sessions")
      .select("customer_id, customer_name, customer_phone, outstanding")
      .eq("org_id", org.id)
      .eq("status", "ended")
      .eq("written_off", false)
      .gt("outstanding", 0)
      .not("customer_id", "is", null)
      .limit(1000),
  ]);
  const dues = [
    ...(owing ?? [])
      .reduce((m, s) => {
        const prev = m.get(s.customer_id!);
        m.set(s.customer_id!, {
          id: s.customer_id!,
          name: s.customer_name ?? "Player",
          phone: s.customer_phone ?? "",
          owed: (prev?.owed ?? 0) + Number(s.outstanding),
        });
        return m;
      }, new Map<string, { id: string; name: string; phone: string; owed: number }>())
      .values(),
  ].sort((a, b) => b.owed - a.owed);
  const duesTotal = dues.reduce((t, d) => t + d.owed, 0);
  const { data: players, error } = res;
  const offers = (orgRow?.wallet_offers ?? []) as { pay: number; bonus: number }[];

  const ids = (players ?? []).map((p) => p.id);
  const { data: balances } = ids.length
    ? await supabase.from("customers").select("id, wallet_balance").in("id", ids)
    : { data: [] as { id: string; wallet_balance: number }[] };
  const walletMap: Record<string, number> = Object.fromEntries(
    (balances ?? []).map((b) => [b.id, Number(b.wallet_balance ?? 0)]),
  );

  const total = Number(players?.[0]?.total_count ?? players?.length ?? 0);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + (players?.length ?? 0) - 1;
  const pageHref = (n: number) => `/players?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;
  const editable = isOwner(role);

  return (
    <>
      <PageHeader
        title="Players"
        description="One account per mobile number, for open and fixed time alike. Created the first time someone plays."
        actions={<AddPlayerButton />}
      />

      {!q && page === 1 && dues.length > 0 && (
        <Panel
          title="Money owed"
          description={`${dues.length} ${dues.length === 1 ? "player owes" : "players owe"} ${formatINR(duesTotal)} in all`}
          className="mb-5"
          flush
        >
          <ul className="divide-y divide-line">
            {dues.slice(0, 10).map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/players/${d.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="num block text-xs text-muted">{d.phone && formatPhone(d.phone)}</span>
                </Link>
                <span className="num shrink-0 font-semibold text-over">{formatINR(d.owed)}</span>
                {d.phone && <DuesReminderButton phone={d.phone} name={d.name} owed={d.owed} venueName={org.name} />}
              </li>
            ))}
          </ul>
          {dues.length > 10 && (
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              And {dues.length - 10} more. Open a player to see their visits.
            </p>
          )}
        </Panel>
      )}

      <div className="mb-3">
        <PlayerSearch initial={q} />
      </div>

      <Panel flush>
        {error ? (
          <p className="px-4 py-6 text-sm text-danger">{error.message}</p>
        ) : !players?.length ? (
          <Empty icon={<Contact />} title={q ? "No players match" : "No players yet"}>
            {!q && "Players are added automatically when you start a session with their mobile number."}
          </Empty>
        ) : (
          <>
          {/* Phones: one card per player, the whole row taps through; wallet top-up stays one tap. */}
          <ul className="divide-y divide-line sm:hidden">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/players/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="num block text-xs text-muted">
                      {formatPhone(p.phone)} · {p.visits} visit{p.visits === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
                <span className={`num shrink-0 text-sm font-semibold ${(walletMap[p.id] ?? 0) > 0 ? "text-ok" : "text-muted"}`}>
                  {formatINR(walletMap[p.id] ?? 0)}
                </span>
                <TopupWalletButton
                  customerId={p.id}
                  playerName={p.name}
                  currentBalance={walletMap[p.id] ?? 0}
                  canRefund={editable}
                  offers={offers}
                  compact
                />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Mobile</th>
                  <th className="px-4 py-2.5 text-right font-medium">Wallet</th>
                  <th className="px-4 py-2.5 text-right font-medium">Visits</th>
                  <th className="px-4 py-2.5 text-right font-medium">Spent</th>
                  <th className="px-4 py-2.5 font-medium">Last visit</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/players/${p.id}`} className="inline-flex items-center gap-2.5 hover:text-accent-ink">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                      </Link>
                    </td>
                    <td className="num px-4 py-2.5 text-muted">{formatPhone(p.phone)}</td>
                    <td className="num px-4 py-2.5 text-right">
                      <span className={`font-semibold ${(walletMap[p.id] ?? 0) > 0 ? "text-ok" : "text-muted"}`}>
                        {formatINR(walletMap[p.id] ?? 0)}
                      </span>
                    </td>
                    <td className="num px-4 py-2.5 text-right">{p.visits}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(p.total_spent)}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {p.last_visit ? formatDateTime(p.last_visit, branch.timezone) : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <TopupWalletButton
                          customerId={p.id}
                          playerName={p.name}
                          currentBalance={walletMap[p.id] ?? 0}
                          canRefund={editable}
                          offers={offers}
                          compact
                        />
                        {editable && <EditPlayerButton player={p} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
            <span className="num">
              {first}–{last} of {total.toLocaleString("en-IN")} player{total === 1 ? "" : "s"}
            </span>
            {total > PAGE_SIZE && (
              <span className="flex items-center gap-1.5">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>
                    <ChevronLeft /> Previous
                  </Link>
                ) : null}
                {last < total ? (
                  <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")}>
                    Next <ChevronRight />
                  </Link>
                ) : null}
              </span>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
