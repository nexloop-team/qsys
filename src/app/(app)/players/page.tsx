import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Contact } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
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

async function Players({ searchParams }: { searchParams: PageProps<"/players">["searchParams"] }) {
  const { org, role, branch } = await getAppContext();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 40) : "";

  const supabase = await createClient();
  const { data: players, error } = await supabase.rpc("list_customers", { p_org_id: org.id, p_search: q || undefined });
  const editable = isOwner(role);

  return (
    <>
      <PageHeader
        title="Players"
        description="One account per mobile number, for open and fixed time alike. Created the first time someone plays."
        actions={<AddPlayerButton />}
      />

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
                      <Link href={`/players/${p.id}`} className="inline-flex items-center gap-2.5 hover:text-accent-ink">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                      </Link>
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
      </Panel>
    </>
  );
}
