"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Play, Trash2, Trophy, UserPlus, Users, X } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { computeBill } from "@/lib/bill";
import { formatDateTime, formatINR } from "@/lib/format";
import { STATION_TYPE_LABEL } from "@/lib/constants";
import { Badge, PageHeader, Panel } from "@/components/card";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, ErrorText, Field, Input, Select, cx } from "@/components/ui";
import { entryWord, teamLabel } from "../labels";
import { PlayerField, type PlayerValue } from "../../dashboard/player-field";
import { PaymentFields, type PaymentRow } from "../../dashboard/payment-fields";

export type Player = {
  id: string;
  customer_id: string;
  name: string;
  phone: string;
  invoice_id: string | null;
  /** Team entries: the team's name; name / phone are the captain's. */
  team_name: string | null;
  members: string[];
  paid: boolean;
};
type Station = { id: string; name: string };

// What the bracket shows for an entry: the team name, or the player's name.
const entryName = (p: Player) => p.team_name ?? p.name;
export type Match = Tables<"tournament_matches">;
type Gst = { enabled: boolean; rate: number; inclusive: boolean };

function roundName(round: number, rounds: number) {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return "Quarter-finals";
  return `Round ${round}`;
}

export function TournamentView({
  orgId,
  timezone,
  tournament: t,
  players,
  matches,
  gst,
  stations,
  canDelete,
}: {
  orgId: string;
  timezone: string;
  tournament: Tables<"tournaments">;
  players: Player[];
  matches: Match[];
  gst: Gst;
  stations: Station[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState<PlayerValue>({ phone: "", name: "", isNew: false, ready: false });
  const [addKey, setAddKey] = useState(0);
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const teams = t.team_size > 1;
  const [paying, setPaying] = useState<Player | null>(null);

  const byId = new Map(players.map((p) => [p.id, p]));
  const fee = Number(t.entry_fee);
  const paidCount = players.filter((p) => p.paid).length;
  const rounds = matches.reduce((m, x) => Math.max(m, x.round), 0);
  const winner = t.winner_id ? byId.get(t.winner_id) : undefined;
  // The round being played now: the first one with a match still waiting for a result.
  const current = t.status === "running"
    ? matches
        .filter((m) => !m.winner_id && m.player1_id && m.player2_id)
        .reduce((r, m) => Math.min(r, m.round), Infinity)
    : Infinity;
  const unpaid = fee > 0 ? players.length - paidCount : 0;

  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await fn();
      if (error) return setError(friendlyError(error));
      after?.();
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title={t.name}
        description={[
          t.game,
          t.station_type ? `on ${STATION_TYPE_LABEL[t.station_type]}` : null,
          teams ? teamLabel(t.team_size) : null,
          fee > 0 ? `${formatINR(fee)} entry${teams ? " per team" : ""}` : "Free entry",
          t.prize ? `Prize: ${t.prize}` : null,
          t.starts_at ? formatDateTime(t.starts_at, timezone) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Badge tone={t.status === "open" ? "free" : t.status === "running" ? "ending" : "neutral"}>
              {t.status === "open" ? "Taking players" : t.status === "running" ? "In progress" : "Finished"}
            </Badge>
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete tournament"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Delete ${t.name}? Entry-fee bills stay under Bills.`)) return;
                  startTransition(async () => {
                    const { error } = await supabase.rpc("delete_tournament", { p_tournament_id: t.id });
                    if (error) return setError(friendlyError(error));
                    router.push("/tournaments");
                  });
                }}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <ErrorText>{error}</ErrorText>

        {winner && (
          <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/8 px-4 py-3">
            <Trophy className="size-5 text-ok" />
            <p className="text-sm">
              <span className="font-semibold">{entryName(winner)}</span> wins {t.name}
              {t.prize ? ` · ${t.prize}` : ""}
            </p>
          </div>
        )}

        {/* Bracket, in playing order. The round in play is marked. */}
        {rounds > 0 && (
          <div className="flex flex-col gap-5">
            {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
              <Panel
                key={r}
                title={
                  <span className="flex items-center gap-2">
                    {roundName(r, rounds)}
                    {r === current && <Badge tone="ending">Playing now</Badge>}
                  </span>
                }
                flush
              >
                <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:gap-px sm:bg-line lg:grid-cols-3">
                  {matches
                    .filter((m) => m.round === r)
                    .map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        p1={m.player1_id ? byId.get(m.player1_id) : undefined}
                        p2={m.player2_id ? byId.get(m.player2_id) : undefined}
                        // A result can change only until the next match is played.
                        locked={
                          Boolean(
                            matches.find((n) => n.round === r + 1 && n.slot === Math.floor(m.slot / 2))?.winner_id,
                          ) || (m.round === 1 && (!m.player1_id || !m.player2_id))
                        }
                        pending={pending}
                        stations={stations}
                        onStation={(id) => run(() => supabase.rpc("set_match_station", { p_match_id: m.id, p_station_id: id }))}
                        onWinner={(id) => run(() => supabase.rpc("set_match_winner", { p_match_id: m.id, p_winner_id: id }))}
                      />
                    ))}
                </ul>
              </Panel>
            ))}
          </div>
        )}

        {/* Players */}
        <Panel
          title={`${teams ? "Teams" : "Players"} · ${players.length}`}
          description={fee > 0 ? `${paidCount} of ${players.length} paid the entry fee` : undefined}
          action={
            t.status === "open" && (
              <Button
                size="sm"
                disabled={pending || players.length < 2}
                onClick={() =>
                  window.confirm(
                    `Start with ${players.length} ${entryWord(t.team_size, players.length)}? The draw is random and nobody can join after.` +
                      (unpaid > 0
                        ? `\n\n${unpaid} ${entryWord(t.team_size, unpaid)} ${unpaid === 1 ? "hasn't" : "haven't"} paid the entry fee yet. You can still collect it later.`
                        : ""),
                  ) &&
                  run(() => supabase.rpc("start_tournament", { p_tournament_id: t.id }))
                }
              >
                <Play /> Start &amp; draw
              </Button>
            )
          }
          flush
        >
          {t.status === "open" && (
            <div className="flex flex-col gap-3 border-b border-line p-4">
              {teams && (
                <Field label="Team name">
                  <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} placeholder="Night Owls" />
                </Field>
              )}
              {teams && <span className="-mb-1 text-[13px] font-medium">Captain (pays the entry fee)</span>}
              <PlayerField key={addKey} orgId={orgId} supabase={supabase} onChange={setAdding} />
              {teams && (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: t.team_size - 1 }, (_, i) => (
                    <Input
                      key={`${addKey}-${i}`}
                      value={members[i] ?? ""}
                      onChange={(e) => {
                        const next = [...members];
                        next[i] = e.target.value;
                        setMembers(next);
                      }}
                      maxLength={40}
                      placeholder={`Player ${i + 2} (optional)`}
                      aria-label={`Team member ${i + 2}`}
                    />
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={pending || !adding.ready || (teams && teamName.trim().length < 2)}
                onClick={() =>
                  run(
                    () =>
                      supabase.rpc("add_tournament_player", {
                        p_tournament_id: t.id,
                        p_phone: adding.phone,
                        p_name: adding.isNew ? adding.name : null,
                        p_team_name: teams ? teamName.trim() : null,
                        p_members: teams ? members.filter((m) => m.trim()) : [],
                      }),
                    () => {
                      setAddKey((k) => k + 1);
                      setTeamName("");
                      setMembers([]);
                    },
                  )
                }
              >
                {teams ? <Users /> : <UserPlus />}
                {teams ? `Add ${teamName.trim() || "team"}` : `Add ${adding.name || "player"}`}
              </Button>
            </div>
          )}
          {players.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">
              {teams
                ? "No teams yet. Add each team with its captain's mobile number. You need at least 2 to start."
                : "No players yet. Add each one by mobile number. You need at least 2 to start."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {entryName(p)}
                      {t.winner_id === p.id && <Trophy className="ml-1.5 inline size-3.5 text-ok" />}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {p.team_name && <>Captain {p.name} · </>}
                      <span className="num">
                        {p.phone.slice(0, 5)} {p.phone.slice(5)}
                      </span>
                    </span>
                    {p.members.length > 0 && <span className="block truncate text-xs text-muted">With {p.members.join(", ")}</span>}
                  </span>
                  {fee > 0 &&
                    (p.paid ? (
                      <Badge tone="ok">
                        <Check className="size-3" /> Paid
                      </Badge>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setPaying(p)}>
                        Collect {formatINR(fee)}
                      </Button>
                    ))}
                  {t.status === "open" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${entryName(p)}`}
                      disabled={pending}
                      onClick={() => run(() => supabase.rpc("remove_tournament_player", { p_player_id: p.id }))}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {paying && (
        <EntryFeeDialog
          player={paying}
          fee={fee}
          gst={gst}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function MatchCard({
  match: m,
  p1,
  p2,
  locked,
  pending,
  stations,
  onStation,
  onWinner,
}: {
  match: Match;
  p1?: Player;
  p2?: Player;
  locked: boolean;
  pending: boolean;
  stations: Station[];
  onStation: (stationId: string | null) => void;
  onWinner: (playerId: string | null) => void;
}) {
  const bye = m.round === 1 && Boolean(p1) !== Boolean(p2);
  const ready = Boolean(p1 && p2);
  const row = (p: Player | undefined, placeholder: string) => {
    const won = p && m.winner_id === p.id;
    const lost = p && m.winner_id && m.winner_id !== p.id;
    return (
      <button
        type="button"
        disabled={!ready || !p || pending || locked || Boolean(m.winner_id)}
        onClick={() => p && onWinner(p.id)}
        className={cx(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors",
          won ? "border-ok/40 bg-ok/8 font-semibold" : "border-line",
          lost && "text-faint line-through",
          ready && !m.winner_id && !locked && "hover:border-accent hover:bg-accent-soft",
          !p && "text-faint",
        )}
      >
        <span className="truncate">{p ? entryName(p) : placeholder}</span>
        {won && <Check className="size-4 shrink-0 text-ok" />}
      </button>
    );
  };

  return (
    <li className="flex flex-col gap-1.5 bg-panel p-3">
      {row(p1, bye ? "No opponent" : "To be decided")}
      {row(p2, bye ? "No opponent" : "To be decided")}
      {/* Where to play it: only for a match still to be played, in a tournament linked to stations. */}
      {stations.length > 0 && !bye && !m.winner_id && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <MapPin className="size-3.5 shrink-0" />
          <Select
            value={m.station_id ?? ""}
            disabled={pending}
            onChange={(e) => onStation(e.target.value || null)}
            className="h-9 min-w-0 flex-1 text-[13px]"
            aria-label="Station for this match"
          >
            <option value="">No station yet</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {m.winner_id && m.station_id && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <MapPin className="size-3.5" /> Played on {stations.find((s) => s.id === m.station_id)?.name ?? "a station"}
        </span>
      )}
      <div className="flex min-h-5 items-center justify-between text-xs text-muted">
        <span>{bye ? "Goes through (no opponent)" : m.winner_id ? "Done" : ready ? "Tap the winner" : "Waiting for the earlier matches"}</span>
        {m.winner_id && !locked && !bye && (
          <button type="button" className="underline-offset-4 hover:text-fg hover:underline" onClick={() => onWinner(null)}>
            Undo
          </button>
        )}
      </div>
    </li>
  );
}

function EntryFeeDialog({
  player,
  fee,
  gst,
  onClose,
  onPaid,
}: {
  player: Player;
  fee: number;
  gst: Gst;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [supabase] = useState(createClient);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [wallet, setWallet] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const bill = computeBill([{ amount: fee, gstRate: gst.rate }], 0, {
    gstEnabled: gst.enabled,
    pricesIncludeTax: gst.inclusive,
  });

  // The player's wallet can pay the entry fee.
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("customers")
      .select("wallet_balance")
      .eq("id", player.customer_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWallet(Number(data?.wallet_balance ?? 0));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, player.customer_id]);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Entry fee · ${player.team_name ?? player.name}`}
      description={player.team_name ? `Billed to the captain, ${player.name}.` : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">To collect</span>
          <span className="num text-2xl font-semibold">{formatINR(bill.total)}</span>
        </div>
        <PaymentFields total={bill.total} onChange={setPayments} walletBalance={wallet} playerName={player.name} />
        <StickyActions>
          <ErrorText>{error}</ErrorText>
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(undefined);
                const { error } = await supabase.rpc("pay_tournament_entry", {
                  p_player_id: player.id,
                  p_payments: payments,
                });
                if (error) return setError(friendlyError(error));
                onPaid();
              })
            }
          >
            {pending ? "Saving…" : `Mark paid ${formatINR(bill.total)}`}
          </Button>
        </StickyActions>
      </div>
    </Modal>
  );
}
