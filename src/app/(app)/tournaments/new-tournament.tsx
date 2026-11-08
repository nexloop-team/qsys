"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { zonedStart } from "@/lib/format";
import { STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, ErrorText, Field, Input, Select } from "@/components/ui";
import { teamLabel } from "./labels";

// Suggestions for the Game box, by what it's played on. Any game can still be typed.
const GAMES: Record<StationType | "none", string[]> = {
  none: ["Snooker", "8-ball pool", "FIFA", "Tekken", "Valorant"],
  pc: ["Valorant", "Counter-Strike 2", "Free Fire", "Dota 2", "EA FC"],
  ps5: ["EA FC", "Tekken 8", "Mortal Kombat 1", "Call of Duty", "Rocket League"],
  xbox: ["EA FC", "Call of Duty", "Halo", "Forza"],
  snooker: ["Snooker"],
  pool: ["8-ball pool", "9-ball pool"],
  other: [],
};

export function NewTournamentButton({
  branchId,
  timezone,
  types,
}: {
  branchId: string;
  timezone: string;
  /** The station types this venue has. */
  types: StationType[];
}) {
  const router = useRouter();
  const first = types.length === 1 ? types[0] : "";
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [on, setOn] = useState<StationType | "">(first);
  const [game, setGame] = useState(GAMES[first || "none"][0] ?? "");
  const [teamSize, setTeamSize] = useState(1);
  const [fee, setFee] = useState("");
  const [prize, setPrize] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const suggestions = GAMES[on || "none"];

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      // datetime-local is the venue's local time.
      let startsAt: string | null = null;
      if (when) {
        const [d, t] = when.split("T");
        const [h, m] = t.split(":").map(Number);
        startsAt = new Date(Date.parse(zonedStart(d, timezone)) + (h * 60 + m) * 60_000).toISOString();
      }
      const { data, error } = await createClient().rpc("create_tournament", {
        p_branch_id: branchId,
        p_name: name.trim(),
        p_game: game.trim(),
        p_entry_fee: Number(fee) || 0,
        p_prize: prize.trim() || null,
        p_starts_at: startsAt,
        p_team_size: teamSize,
        p_station_type: on || null,
      });
      if (error || !data) return setError(friendlyError(error, "Couldn't create the tournament."));
      // Replace (not push) the dialog's own history entry, and leave the dialog open: closing it
      // here would step Back in history and undo the move to the new tournament.
      router.replace(`/tournaments/${data}`);
    });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New tournament
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="New tournament" description="Knockout: lose once and you're out.">
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday Snooker Cup" maxLength={80} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Played on" hint="Lets you send each match to a station.">
              <Select
                value={on}
                onChange={(e) => {
                  const next = e.target.value as StationType | "";
                  setOn(next);
                  // Swap the game for a fitting one, unless they typed their own.
                  if (!game || suggestions.includes(game)) setGame(GAMES[next || "none"][0] ?? "");
                }}
              >
                <option value="">Not linked</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {STATION_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Game">
              <Input value={game} onChange={(e) => setGame(e.target.value)} list="tournament-games" maxLength={40} />
              <datalist id="tournament-games">
                {suggestions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field
            label="Format"
            hint={teamSize > 1 ? "Each team has a captain (by mobile) who pays the entry fee for the team." : undefined}
          >
            <Select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {teamLabel(n)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={teamSize > 1 ? "Entry fee per team (₹)" : "Entry fee (₹)"} hint="Leave empty if free.">
              <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Starts (optional)">
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
          <Field label="Prize (optional)" hint="For example ₹2,000 and a trophy.">
            <Input value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={120} />
          </Field>
          <StickyActions>
            <ErrorText>{error}</ErrorText>
            <Button
              size="lg"
              className="w-full"
              disabled={pending || name.trim().length < 2 || game.trim().length < 2}
              onClick={submit}
            >
              {pending ? "Creating…" : teamSize > 1 ? "Create and add teams" : "Create and add players"}
            </Button>
          </StickyActions>
        </div>
      </Modal>
    </>
  );
}
