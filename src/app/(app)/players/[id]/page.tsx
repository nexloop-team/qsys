import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { SESSION_MODE_LABEL, STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { formatDateTime, formatINR, formatMinutes } from "@/lib/format";
import { Badge, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { PcPinButton, TopupWalletButton } from "../player-forms";

export const metadata: Metadata = { title: "Player" };

const LEDGER_LABEL: Record<string, string> = {
  cash: "Top-up · cash",
  upi: "Top-up · UPI",
  bonus: "Bonus credit",
  gameplay: "Paid a bill",
  void: "Bill cancelled, refunded",
};

const HISTORY = 100;

export default function PlayerPage(props: PageProps<"/players/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Player params={props.params} />
    </Suspense>
  );
}

function playedMinutes(s: {
  started_at: string;
  ended_at: string | null;
  session_pauses: { started_at: string; ended_at: string | null }[];
}) {
  const end = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  const paused = s.session_pauses.reduce(
    (sum, p) => sum + ((p.ended_at ? Date.parse(p.ended_at) : end) - Date.parse(p.started_at)),
    0,
  );
  return Math.max(0, Math.round((end - Date.parse(s.started_at) - paused) / 60000));
}

async function Player({ params }: { params: PageProps<"/players/[id]">["params"] }) {
  const { id } = await params;
  const { branch, org, role } = await getAppContext();
  const supabase = await createClient();

  let player: { id: string; name: string; phone: string; created_at: string; wallet_balance?: number; pin_set?: boolean } | null = null;

  const [{ data: rawPlayer, error: playerErr }, { data: sessions }, { data: summary }, { data: orgRow }, { data: rawTxns }] =
    await Promise.all([
    supabase.from("customers").select("id, name, phone, wallet_balance, pin_set, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("sessions")
      .select(
        "id, mode, status, started_at, ended_at, charge_amount, billed_amount, outstanding, written_off, stations(name, type), session_pauses(started_at, ended_at)",
      )
      .eq("customer_id", id)
      .order("started_at", { ascending: false })
      .limit(HISTORY),
    // Lifetime totals are summed in the database, not limited to the history shown.
    supabase.rpc("player_summary", { p_customer_id: id }),
    supabase.from("orgs").select("wallet_offers").eq("id", org.id).single(),
    supabase
      .from("wallet_transactions")
      .select("id, amount, balance_after, method, note, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (rawPlayer && !playerErr) {
    player = rawPlayer;
  } else {
    // Graceful fallback if wallet_balance column is not yet migrated in database
    const { data: fallbackPlayer } = await supabase
      .from("customers")
      .select("id, name, phone, created_at")
      .eq("id", id)
      .maybeSingle();
    if (fallbackPlayer) {
      player = { ...fallbackPlayer, wallet_balance: 0 };
    }
  }

  if (!player) notFound();

  const offers = (orgRow?.wallet_offers ?? []) as { pay: number; bonus: number }[];
  const list = sessions ?? [];
  const totals = (summary ?? {}) as {
    visits?: number;
    played_minutes?: number;
    paid?: number;
    owed?: number;
    favourite_type?: StationType | null;
  };
  const visits = Number(totals.visits ?? list.length);
  const minutes = Number(totals.played_minutes ?? list.reduce((sum, s) => sum + playedMinutes(s), 0));
  const spent = Number(totals.paid ?? 0);
  const owed = Number(totals.owed ?? 0);
  const favourite = totals.favourite_type ?? undefined;
  // The balance column is the source of truth; the ledger below explains it.
  const wallet = Number(player.wallet_balance ?? 0);

  return (
    <>
      <Link href="/players" className={buttonClass("ghost", "sm", "mb-3")}>
        <ArrowLeft /> Players
      </Link>
      <PageHeader
        title={player.name}
        description={`${player.phone.slice(0, 5)} ${player.phone.slice(5)} · player since ${new Date(player.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: branch.timezone })}`}
        actions={
          <>
            <PcPinButton customerId={player.id} playerName={player.name} pinSet={Boolean(player.pin_set)} />
            <TopupWalletButton
              customerId={player.id}
              playerName={player.name}
              currentBalance={wallet}
              canRefund={role === "owner"}
              offers={offers}
            />
          </>
        }
      />

      {/* What staff act on (wallet, money owed) stands out; the rest is one line of context. */}
      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-card">
        <div>
          <p className="text-xs text-muted">Wallet</p>
          <p className={`num text-xl font-semibold ${wallet > 0 ? "text-ok" : ""}`}>{formatINR(wallet)}</p>
        </div>
        {owed > 0 && (
          <div>
            <p className="text-xs text-muted">Owes</p>
            <p className="num text-xl font-semibold text-over">{formatINR(owed)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-muted">PC login</p>
          <p className="text-sm font-medium">{player.pin_set ? "PIN set" : "No PIN"}</p>
        </div>
        <p className="text-sm text-muted">
          <span className="num text-fg">{visits.toLocaleString("en-IN")}</span> visit{visits === 1 ? "" : "s"} ·{" "}
          <span className="num text-fg">{formatMinutes(minutes)}</span> played ·{" "}
          <span className="num text-fg">{formatINR(spent)}</span> paid
          {favourite && <> · plays {STATION_TYPE_LABEL[favourite]} most</>}
        </p>
      </div>

      <Panel
        title="Visit history"
        description={visits > list.length ? `Latest ${list.length} of ${visits.toLocaleString("en-IN")} visits` : undefined}
        flush
      >
        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Started</th>
                  <th className="px-4 py-2.5 font-medium">Station</th>
                  <th className="px-4 py-2.5 font-medium">Timer</th>
                  <th className="px-4 py-2.5 text-right font-medium">Played</th>
                  <th className="px-4 py-2.5 text-right font-medium">Charge</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{formatDateTime(s.started_at, branch.timezone)}</td>
                    <td className="px-4 py-2.5 font-medium">{s.stations?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{SESSION_MODE_LABEL[s.mode]}</td>
                    <td className="num px-4 py-2.5 text-right">{formatMinutes(playedMinutes(s))}</td>
                    <td className="num px-4 py-2.5 text-right">
                      {s.charge_amount != null ? formatINR(s.charge_amount) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {s.status !== "ended" ? (
                        <Badge tone="busy">Playing</Badge>
                      ) : s.written_off ? (
                        <Badge tone="danger">Written off</Badge>
                      ) : Number(s.outstanding) > 0 ? (
                        <Badge tone="over">Unpaid</Badge>
                      ) : (
                        <Badge tone="ok">Paid</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Wallet activity" flush className="mt-4">
        {!rawTxns?.length ? (
          <p className="px-4 py-4 text-xs text-muted">No wallet transactions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Balance After</th>
                  <th className="px-4 py-2 font-medium">Mode</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rawTxns.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2">{formatDateTime(t.created_at, branch.timezone)}</td>
                    <td className={`num px-4 py-2 text-right font-semibold ${Number(t.amount) >= 0 ? "text-ok" : "text-over"}`}>
                      {Number(t.amount) >= 0 ? `+${formatINR(t.amount)}` : formatINR(t.amount)}
                    </td>
                    <td className="num px-4 py-2 text-right font-medium">{formatINR(t.balance_after)}</td>
                    <td className="px-4 py-2">
                      {Number(t.amount) < 0 && (t.method === "cash" || t.method === "upi")
                        ? `Refund · ${t.method === "upi" ? "UPI" : "cash"}`
                        : (LEDGER_LABEL[t.method] ?? t.method)}
                    </td>
                    <td className="px-4 py-2 text-muted">{t.note ?? "—"}</td>
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
