import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Contact } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { AddPlayerButton, EditPlayerButton, PlayerSearch } from "./player-forms";

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

type Sort = "recent" | "spent" | "owes";
const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "spent", label: "Top spenders" },
  { key: "owes", label: "Owes money" },
];

async function Players({ searchParams }: { searchParams: PageProps<"/players">["searchParams"] }) {
  const { org, role, branch } = await getAppContext();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 40) : "";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const sort = SORTS.some((x) => x.key === sp.sort) ? (sp.sort as Sort) : "recent";

  const supabase = await createClient();
  const { data: players, error } = await supabase.rpc("list_customers", {
    p_org_id: org.id,
    p_search: q || undefined,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_sort: sort,
  });
  const total = Number(players?.[0]?.total_count ?? 0);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + (players?.length ?? 0) - 1;
  const hrefWith = (over: Record<string, string>) =>
    `/players?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== "recent" ? { sort } : {}), ...over })}`;
  const pageHref = (n: number) => hrefWith({ page: String(n) });
  const editable = isOwner(role);

  return (
    <>
      <PageHeader
        title="Players"
        description="One account per mobile number, for open and fixed time alike. Created the first time someone plays."
        actions={<AddPlayerButton />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PlayerSearch initial={q} />
        <nav aria-label="Sort players" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
          {SORTS.map((x) => (
            <Link
              key={x.key}
              href={x.key === "recent" ? `/players${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/players?${new URLSearchParams({ ...(q ? { q } : {}), sort: x.key })}`}
              aria-current={sort === x.key ? "page" : undefined}
              className={
                sort === x.key
                  ? "rounded-md bg-panel px-3 py-1.5 text-[13px] font-semibold shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.06)]"
                  : "rounded-md px-3 py-1.5 text-[13px] font-medium text-muted hover:text-fg"
              }
            >
              {x.label}
            </Link>
          ))}
        </nav>
      </div>

      <Panel flush>
        {error ? (
          <p className="px-4 py-6 text-sm text-danger">{error.message}</p>
        ) : !players?.length ? (
          <Empty
            icon={<Contact />}
            title={q ? "No players match" : sort === "owes" ? "Nobody owes money" : "No players yet"}
          >
            {!q && sort !== "owes" && "Players are added automatically when you start a session with their mobile number."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Mobile</th>
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
                      <Link href={`/players/${p.id}`} className="inline-flex items-center gap-2.5 hover:underline hover:underline-offset-4">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-[11px] font-semibold text-fg ring-1 ring-line">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                      </Link>
                      {Number(p.owed) > 0 && (
                        <span className="num ml-2 rounded-md bg-over/10 px-1.5 py-px text-[11px] font-semibold text-over">
                          Owes {formatINR(p.owed)}
                        </span>
                      )}
                    </td>
                    <td className="num px-4 py-2.5 text-muted">{formatPhone(p.phone)}</td>
                    <td className="num px-4 py-2.5 text-right">{p.visits}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(p.total_spent)}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {p.last_visit ? formatDateTime(p.last_visit, branch.timezone) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {editable && <EditPlayerButton player={p} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
