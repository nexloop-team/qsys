"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Play, Printer, Trash2, Trophy, UserPlus, Users, X } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { computeBill } from "@/lib/bill";
import { formatDateTime, formatINR } from "@/lib/format";
import { STATION_TYPE_LABEL } from "@/lib/constants";
import { Badge, PageHeader, Panel } from "@/components/card";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, ErrorText, Field, Input, Select, cx } from "@/components/ui";
import { entryWord, seatsPerSide, stationsPerMatch, teamLabel } from "../labels";
import { PlayerField, type PlayerValue } from "../../dashboard/player-field";
import { PaymentFields, type PaymentRow } from "../../dashboard/payment-fields";
import { sqlNull } from "@/lib/sql-null";

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

const isReady = (m: Match) => Boolean(m.player1_id && m.player2_id && !m.winner_id);

export function TournamentView({
  orgId,
  timezone,
  tournament: t,
  players,
  matches,
  gst,
  stations,
  busy,
  canDelete,
}: {
  orgId: string;
  timezone: string;
  tournament: Tables<"tournaments">;
  players: Player[];
  matches: Match[];
  gst: Gst;
  stations: Station[];
  /** Stations with a customer session running right now (from the Floor). */
  busy: string[];
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
  const [result, setResult] = useState<{ match: Match; pick: string } | null>(null);
  const [seating, setSeating] = useState<Match | null>(null);

  const need = stationsPerMatch(t.station_type, t.team_size);
  const byId = new Map(players.map((p) => [p.id, p]));
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const fee = Number(t.entry_fee);
  const paidCount = players.filter((p) => p.paid).length;
  const rounds = matches.reduce((m, x) => Math.max(m, x.round), 0);
  const winner = t.winner_id ? byId.get(t.winner_id) : undefined;
  // The round being played now: the first one with a match still waiting for a result.
  const current =
    t.status === "running"
      ? matches.filter(isReady).reduce((r, m) => Math.min(r, m.round), Infinity)
      : Infinity;
  const unpaid = fee > 0 ? players.length - paidCount : 0;

  // Stations taken by matches being played now (both sides known, no result yet).
  const takenBy = new Map<string, Match>();
  for (const m of matches) if (isReady(m)) for (const s of m.station_ids ?? []) takenBy.set(s, m);

  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await fn();
      if (error) return setError(friendlyError(error));
      after?.();
      router.refresh();
    });

  const description = [
    t.game,
    t.station_type ? `on ${STATION_TYPE_LABEL[t.station_type]}` : null,
    teams ? teamLabel(t.team_size) : null,
    fee > 0 ? `${formatINR(fee)} entry${teams ? " per team" : ""}` : "Free entry",
    t.prize ? `Prize: ${t.prize}` : null,
    t.starts_at ? formatDateTime(t.starts_at, timezone) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Paper copy for the wall or the counter. Everything else on the page stays off the print. */}
      {rounds > 0 && (
        <PrintBracket
          name={t.name}
          description={description}
          rounds={rounds}
          matches={matches}
          byId={byId}
          stationName={stationName}
          winner={winner ? entryName(winner) : null}
        />
      )}
      <div className="print:hidden">
        <PageHeader
          title={t.name}
          description={description}
          actions={
            <>
              {rounds > 0 && (
                <Button size="sm" variant="secondary" onClick={() => window.print()}>
                  <Printer /> Print bracket
                </Button>
              )}
              <Badge tone={t.status === "open" ? "free" : t.status === "running" ? "ending" : "neutral"}>
                {t.status === "open" ? "Taking entries" : t.status === "running" ? "In progress" : "Finished"}
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

          {need > 0 && t.status !== "finished" && (
            <p className="text-sm text-muted">
              Each match takes{" "}
              <span className="font-medium text-fg">
                {need} {stationWord(t.station_type, need)}
              </span>
              {t.station_type === "pc"
                ? `: one per player (${t.team_size} a side).`
                : need === 1 && teams
                  ? `: both teams play on it.`
                  : need === 1
                    ? "."
                    : `: one per player.`}{" "}
              A {stationWord(t.station_type, 1)} can&apos;t be in two matches being played at once.
            </p>
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
                          fee={fee}
                          // A result can change only until the next match is played.
                          locked={
                            Boolean(matches.find((n) => n.round === r + 1 && n.slot === Math.floor(m.slot / 2))?.winner_id) ||
                            (m.round === 1 && (!m.player1_id || !m.player2_id))
                          }
                          pending={pending}
                          need={need}
                          oneWord={stationWord(t.station_type, 1)}
                          perSide={seatsPerSide(t.station_type, t.team_size)}
                          stations={stations}
                          stationName={stationName}
                          takenBy={takenBy}
                          busy={busy}
                          onStation={(id) => run(() => supabase.rpc("set_match_stations", { p_match_id: m.id, p_station_ids: id ? [id] : [] }))}
                          onSeating={() => setSeating(m)}
                          onPickWinner={(id) => setResult({ match: m, pick: id })}
                          onUndo={() => run(() => supabase.rpc("set_match_winner", { p_match_id: m.id, p_winner_id: sqlNull<string>(null) }))}
                        />
                      ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}

          {/* Entries */}
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
                          ? `\n\n${unpaid} ${entryWord(t.team_size, unpaid)} ${unpaid === 1 ? "hasn't" : "haven't"} paid the entry fee yet. The bracket marks them so you can collect before they play.`
                          : ""),
                    ) && run(() => supabase.rpc("start_tournament", { p_tournament_id: t.id }))
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
                {/* No auto focus: on a phone it would pop the keyboard and jump past the bracket. */}
                <PlayerField key={addKey} orgId={orgId} supabase={supabase} onChange={setAdding} autoFocus={false} />
                {teams && (
                  <>
                    <span className="-mb-1 text-[13px] font-medium">The other {t.team_size - 1} players</span>
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
                          placeholder={`Player ${i + 2}`}
                          aria-label={`Team member ${i + 2}`}
                        />
                      ))}
                    </div>
                    <p className="-mt-1 text-xs text-muted">Names can be added later at the desk; the team still needs all {t.team_size} to play.</p>
                  </>
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
                          p_name: adding.isNew ? adding.name : undefined,
                          p_team_name: teams ? teamName.trim() : undefined,
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
                      {teams && (
                        <span className="block truncate text-xs text-muted">
                          {p.members.length > 0 ? `With ${p.members.join(", ")}` : "Other players not named yet"}
                          {p.members.length + 1 < t.team_size && p.members.length > 0
                            ? ` · ${t.team_size - 1 - p.members.length} not named yet`
                            : ""}
                        </span>
                      )}
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

      {result && (
        <ResultDialog
          match={result.match}
          initial={result.pick}
          p1={byId.get(result.match.player1_id ?? "")}
          p2={byId.get(result.match.player2_id ?? "")}
          fee={fee}
          pending={pending}
          onClose={() => setResult(null)}
          onSave={(winnerId, score) =>
            run(
              () => supabase.rpc("set_match_winner", { p_match_id: result.match.id, p_winner_id: winnerId, p_score: score || undefined }),
              () => setResult(null),
            )
          }
        />
      )}

      {seating && (
        <SeatingDialog
          match={seating}
          need={need}
          perSide={seatsPerSide(t.station_type, t.team_size)}
          typeWord={stationWord(t.station_type, 2)}
          p1={byId.get(seating.player1_id ?? "")}
          p2={byId.get(seating.player2_id ?? "")}
          stations={stations}
          takenBy={takenBy}
          busy={busy}
          pending={pending}
          onClose={() => setSeating(null)}
          onSave={(ids) =>
            run(
              () => supabase.rpc("set_match_stations", { p_match_id: seating.id, p_station_ids: ids }),
              () => setSeating(null),
            )
          }
        />
      )}
    </>
  );
}

function stationWord(type: string | null, n: number) {
  const one: Record<string, string> = { pc: "PC", ps5: "PS5", xbox: "Xbox", snooker: "table", pool: "table" };
  const w = (type && one[type]) ?? "station";
  if (n === 1) return w;
  return w === "Xbox" ? "Xboxes" : `${w}s`;
}

/** "PC-01, PC-02" from station ids, in seat order. */
function names(ids: string[], stationName: Map<string, string>) {
  return ids.map((id) => stationName.get(id) ?? "a station").join(", ");
}

function MatchCard({
  match: m,
  p1,
  p2,
  fee,
  locked,
  pending,
  need,
  oneWord,
  perSide,
  stations,
  stationName,
  takenBy,
  busy,
  onStation,
  onSeating,
  onPickWinner,
  onUndo,
}: {
  match: Match;
  p1?: Player;
  p2?: Player;
  fee: number;
  locked: boolean;
  pending: boolean;
  need: number;
  oneWord: string;
  perSide: boolean;
  stations: Station[];
  stationName: Map<string, string>;
  takenBy: Map<string, Match>;
  busy: string[];
  onStation: (stationId: string | null) => void;
  onSeating: () => void;
  onPickWinner: (playerId: string) => void;
  onUndo: () => void;
}) {
  const bye = m.round === 1 && Boolean(p1) !== Boolean(p2);
  const ready = Boolean(p1 && p2);
  const ids = m.station_ids ?? [];
  const half = Math.floor(need / 2);
  // Stations this match shares with another match being played (possible when booked ahead).
  const clash = ready && !m.winner_id ? ids.filter((id) => takenBy.get(id) && takenBy.get(id)!.id !== m.id) : [];
  const atSession = !m.winner_id ? ids.filter((id) => busy.includes(id)) : [];

  const row = (p: Player | undefined, placeholder: string, seats: string[]) => {
    const won = p && m.winner_id === p.id;
    const lost = p && m.winner_id && m.winner_id !== p.id;
    return (
      <button
        type="button"
        disabled={!ready || !p || pending || locked || Boolean(m.winner_id)}
        onClick={() => p && onPickWinner(p.id)}
        className={cx(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors",
          won ? "border-ok/40 bg-ok/8 font-semibold" : "border-line",
          lost && "text-faint line-through",
          ready && !m.winner_id && !locked && "hover:border-accent hover:bg-accent-soft",
          !p && "text-faint",
        )}
      >
        <span className="min-w-0">
          <span className="block truncate">{p ? entryName(p) : placeholder}</span>
          {p && !m.winner_id && (seats.length > 0 || (fee > 0 && !p.paid)) && (
            <span className="block truncate text-xs font-normal text-muted">
              {seats.length > 0 && <>On {names(seats, stationName)}</>}
              {seats.length > 0 && fee > 0 && !p.paid && " · "}
              {fee > 0 && !p.paid && <span className="font-medium text-ending">entry not paid</span>}
            </span>
          )}
        </span>
        {won && <Check className="size-4 shrink-0 text-ok" />}
      </button>
    );
  };

  return (
    <li className="flex flex-col gap-1.5 bg-panel p-3">
      {row(p1, bye ? "No opponent" : "To be decided", perSide ? ids.slice(0, half) : [])}
      {row(p2, bye ? "No opponent" : "To be decided", perSide ? ids.slice(half) : [])}

      {/* Where it's played: only for a match still to be played, in a tournament linked to stations. */}
      {need > 0 && !bye && !m.winner_id && (
        need === 1 ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <MapPin className="size-3.5 shrink-0" />
            <Select
              value={ids[0] ?? ""}
              onChange={(e) => onStation(e.target.value || null)}
              disabled={pending}
              className="h-9 min-w-0 flex-1 text-[13px]"
              aria-label="Where this match is played"
            >
              <option value="">No {oneWord} yet</option>
              {stations.map((s) => {
                const other = takenBy.get(s.id);
                const taken = ready && other && other.id !== m.id;
                return (
                  <option key={s.id} value={s.id} disabled={Boolean(taken)}>
                    {s.name}
                    {taken ? " · in another match" : busy.includes(s.id) ? " · has a session now" : ""}
                  </option>
                );
              })}
            </Select>
          </label>
        ) : (
          <button
            type="button"
            onClick={onSeating}
            disabled={pending}
            className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-line px-3 text-left text-xs text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <MapPin className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {ids.length === 0
                ? `Seat the players (${need} needed)`
                : ids.length < need
                  ? `${ids.length} of ${need} seated · finish seating`
                  : `Seated on ${need} · change`}
            </span>
          </button>
        )
      )}
      {(clash.length > 0 || atSession.length > 0) && (
        <p className="text-xs font-medium text-ending">
          {clash.length > 0 && `${names(clash, stationName)} is also in another match being played. `}
          {atSession.length > 0 && `${names(atSession, stationName)} has a customer session running on the Floor.`}
        </p>
      )}
      {m.winner_id && ids.length > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <MapPin className="size-3.5" /> Played on {names(ids, stationName)}
        </span>
      )}

      <div className="flex min-h-5 items-center justify-between text-xs text-muted">
        <span>
          {bye
            ? "Goes through (no opponent)"
            : m.winner_id
              ? `Done${m.score ? ` · ${m.score === "W/O" ? "walkover" : m.score}` : ""}`
              : ready
                ? "Tap the winner"
                : "Waiting for the earlier matches"}
        </span>
        {m.winner_id && !locked && !bye && (
          <button type="button" className="underline-offset-4 hover:text-fg hover:underline" onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
    </li>
  );
}

// Confirm a result before it knocks a side out, with an optional score or a walkover.
function ResultDialog({
  match,
  initial,
  p1,
  p2,
  fee,
  pending,
  onClose,
  onSave,
}: {
  match: Match;
  initial: string;
  p1?: Player;
  p2?: Player;
  fee: number;
  pending: boolean;
  onClose: () => void;
  onSave: (winnerId: string, score: string) => void;
}) {
  const [pick, setPick] = useState(initial);
  const [score, setScore] = useState("");
  const [walkover, setWalkover] = useState(false);
  const sides = [p1, p2].filter((p): p is Player => Boolean(p));
  const won = sides.find((p) => p.id === pick);
  const lost = sides.find((p) => p.id !== pick);
  const unpaid = fee > 0 ? sides.filter((p) => !p.paid) : [];

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Who won?" description={`Match ${match.slot + 1} of round ${match.round}`}>
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Winner" className="grid grid-cols-2 gap-2">
          {sides.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pick === p.id}
              onClick={() => setPick(p.id)}
              className={cx(
                "flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 text-left transition-colors",
                pick === p.id ? "border-fg bg-fg text-bg" : "border-line hover:bg-hover",
              )}
            >
              <span className="text-sm font-semibold">{entryName(p)}</span>
              <span className={cx("text-xs", pick === p.id ? "text-bg/75" : "text-muted")}>{pick === p.id ? "Winner" : "Tap if they won"}</span>
            </button>
          ))}
        </div>
        <Field label="Score (optional)" hint="Frames, games or rounds, winner first. For example 3-1 or 13-9.">
          <Input
            value={walkover ? "" : score}
            onChange={(e) => setScore(e.target.value)}
            disabled={walkover}
            maxLength={20}
            placeholder="3-1"
            inputMode="numeric"
          />
        </Field>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={walkover} onChange={(e) => setWalkover(e.target.checked)} />
          <span>
            {lost ? entryName(lost) : "The other side"} didn&apos;t turn up (walkover)
          </span>
        </label>
        {unpaid.length > 0 && (
          <p className="text-sm text-ending">
            {unpaid.map(entryName).join(" and ")} {unpaid.length === 1 ? "hasn't" : "haven't"} paid the entry fee yet.
          </p>
        )}
        <StickyActions>
          <Button size="lg" className="w-full" disabled={pending || !won} onClick={() => won && onSave(won.id, walkover ? "W/O" : score.trim())}>
            {pending ? "Saving…" : `${won ? entryName(won) : "They"} won${lost ? `, ${entryName(lost)} is out` : ""}`}
          </Button>
        </StickyActions>
      </div>
    </Modal>
  );
}

// Seat a match that needs several stations: one per player on PCs (a 5 v 5 takes 10). The first
// half seats the top entry, the second half the bottom one.
function SeatingDialog({
  match,
  need,
  perSide,
  typeWord,
  p1,
  p2,
  stations,
  takenBy,
  busy,
  pending,
  onClose,
  onSave,
}: {
  match: Match;
  need: number;
  perSide: boolean;
  typeWord: string;
  p1?: Player;
  p2?: Player;
  stations: Station[];
  takenBy: Map<string, Match>;
  busy: string[];
  pending: boolean;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(match.station_ids ?? []);
  const ready = Boolean(match.player1_id && match.player2_id);
  const half = Math.floor(need / 2);
  const isTaken = (id: string) => {
    const other = takenBy.get(id);
    return Boolean(ready && other && other.id !== match.id);
  };
  const free = stations.filter((s) => !isTaken(s.id) && !busy.includes(s.id));
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < need ? [...p, id] : p));
  const side = (i: number) => (perSide ? (i < half ? (p1 ? entryName(p1) : "Top") : p2 ? entryName(p2) : "Bottom") : null);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} wide title={`Seat the players · ${need} ${typeWord}`} description="Tap them in seat order.">
      <div className="flex flex-col gap-4">
        {perSide && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[0, half].map((from, k) => (
              <div key={k} className="rounded-xl border border-line p-3">
                <p className="font-semibold">{side(from)}</p>
                <p className="text-xs text-muted">
                  {picked.slice(from, from + half).length
                    ? picked
                        .slice(from, from + half)
                        .map((id) => stations.find((s) => s.id === id)?.name)
                        .join(", ")
                    : `${half} to pick`}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={free.length < need}
            onClick={() => setPicked(free.slice(0, need).map((s) => s.id))}
          >
            Fill with the first {need} free
          </Button>
          <Button size="sm" variant="ghost" disabled={picked.length === 0} onClick={() => setPicked([])}>
            Clear
          </Button>
          <span className="ml-auto text-sm font-medium">
            {picked.length} of {need}
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {stations.map((s) => {
            const i = picked.indexOf(s.id);
            const taken = isTaken(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={taken || (i < 0 && picked.length >= need)}
                  onClick={() => toggle(s.id)}
                  className={cx(
                    "relative flex min-h-14 w-full flex-col items-start justify-center rounded-xl border px-2.5 text-left text-sm transition-colors disabled:opacity-40",
                    i >= 0 ? "border-fg bg-fg text-bg" : "border-line hover:bg-hover",
                  )}
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className={cx("text-[11px]", i >= 0 ? "text-bg/75" : "text-muted")}>
                    {i >= 0 ? (perSide ? `${side(i)} · seat ${(i % half) + 1}` : `Seat ${i + 1}`) : taken ? "In another match" : busy.includes(s.id) ? "Session running" : "Free"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {stations.length < need && (
          <p className="text-sm text-ending">
            This branch has {stations.length} {typeWord}, and a match takes {need}.
          </p>
        )}
        <StickyActions>
          <Button size="lg" className="w-full" disabled={pending} onClick={() => onSave(picked)}>
            {pending ? "Saving…" : picked.length === need ? "Save seating" : picked.length === 0 ? "Clear seating" : `Save ${picked.length} of ${need} for now`}
          </Button>
        </StickyActions>
      </div>
    </Modal>
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

// The bracket on paper: one column per round, each match with its two entries (the winner in
// bold), score, stations, and blank lines where the result isn't known yet, to fill in by hand.
function PrintBracket({
  name,
  description,
  rounds,
  matches,
  byId,
  stationName,
  winner,
}: {
  name: string;
  description: string;
  rounds: number;
  matches: Match[];
  byId: Map<string, Player>;
  stationName: Map<string, string>;
  winner: string | null;
}) {
  const line = (id: string | null, m: Match, bye: boolean) => {
    const p = id ? byId.get(id) : undefined;
    const won = Boolean(p && m.winner_id === p.id);
    return (
      <div className={cx("flex h-7 items-end border-b border-black/60 px-1 text-[11pt]", won && "font-bold")}>
        {p ? entryName(p) : bye ? <span className="text-black/50">No opponent</span> : ""}
        {won && <span className="ml-auto text-[9pt]">✓ {m.score && m.score !== "W/O" ? m.score : m.score === "W/O" ? "walkover" : ""}</span>}
      </div>
    );
  };
  return (
    <div className="hidden text-black print:block">
      {/* Wide paper for a bracket; only while this page is open (bills keep their own size). */}
      <style>{"@page { size: A4 landscape; margin: 12mm; }"}</style>
      <h1 className="text-[18pt] font-bold">{name}</h1>
      <p className="mb-4 text-[10pt]">{description}</p>
      <div className="flex items-stretch gap-4">
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} className="flex min-w-0 flex-1 flex-col">
            <p className="mb-2 text-[10pt] font-bold uppercase tracking-wide">{roundName(r, rounds)}</p>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {matches
                .filter((m) => m.round === r)
                .map((m) => {
                  const bye = m.round === 1 && Boolean(m.player1_id) !== Boolean(m.player2_id);
                  const ids = m.station_ids ?? [];
                  return (
                    <div key={m.id} className="break-inside-avoid">
                      {line(m.player1_id, m, bye)}
                      {line(m.player2_id, m, bye)}
                      {ids.length > 0 && <p className="mt-0.5 text-[8pt]">{names(ids, stationName)}</p>}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
        <div className="flex w-32 shrink-0 flex-col justify-center">
          <p className="mb-2 text-[10pt] font-bold uppercase tracking-wide">Winner</p>
          <div className="flex h-8 items-end border-b-2 border-black px-1 text-[12pt] font-bold">{winner ?? ""}</div>
        </div>
      </div>
    </div>
  );
}
