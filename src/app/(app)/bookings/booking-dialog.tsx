"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { zonedStart } from "@/lib/format";
import { MULTIPLAYER_TYPES, STATION_TYPE_LABEL, playersWord, type StationType } from "@/lib/constants";
import { Modal, StickyActions } from "@/components/overlay";
import { Button, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { PlayerField, type PlayerValue } from "../dashboard/player-field";

type Station = { id: string; name: string; type: StationType };

// A booking taken by phone or at the counter: confirmed straight away.
export function AddBookingButton({
  orgId,
  branch,
  stations,
  types,
  today,
}: {
  orgId: string;
  branch: { id: string; timezone: string };
  stations: Station[];
  types: StationType[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Add booking
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Add booking" description="For a player who called or asked at the counter. It's confirmed straight away.">
        {open && (
          <BookingForm
            orgId={orgId}
            branch={branch}
            stations={stations}
            types={types}
            today={today}
            onDone={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

function BookingForm({
  orgId,
  branch,
  stations,
  types,
  today,
  onDone,
}: {
  orgId: string;
  branch: { id: string; timezone: string };
  stations: Station[];
  types: StationType[];
  today: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [player, setPlayer] = useState<PlayerValue>({ phone: "", name: "", isNew: false, ready: false });
  const [type, setType] = useState<StationType>(types[0] ?? "snooker");
  const [stationId, setStationId] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState("60");
  const [players, setPlayers] = useState(MULTIPLAYER_TYPES.has(types[0] ?? "snooker") ? "2" : "1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const [h, m] = time.split(":").map(Number);
      if (!date || Number.isNaN(h) || Number.isNaN(m)) return setError("Pick a day and a time.");
      const startsAt = new Date(Date.parse(zonedStart(date, branch.timezone)) + (h * 60 + m) * 60_000).toISOString();
      const { error } = await supabase.rpc("save_booking", {
        p_booking_id: null,
        p_branch_id: branch.id,
        p_type: type,
        p_starts_at: startsAt,
        p_minutes: Number(minutes),
        p_players: Number(players) || 1,
        p_phone: player.phone,
        p_name: player.isNew ? player.name : null,
        p_note: note.trim() || null,
        p_station_id: stationId || null,
      });
      if (error) return setError(friendlyError(error));
      router.refresh();
      onDone();
    });

  return (
    <div className="flex flex-col gap-4">
      <PlayerField orgId={orgId} supabase={supabase} onChange={setPlayer} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Game">
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as StationType;
              setType(t);
              setStationId("");
              setPlayers(MULTIPLAYER_TYPES.has(t) ? "2" : "1");
            }}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {STATION_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Station">
          <Select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Any station</option>
            {stations
              .filter((s) => s.type === type)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <Input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="How long">
          <Select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[30, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}½ hr` : `${m / 60} hr`}
              </option>
            ))}
          </Select>
        </Field>
        {MULTIPLAYER_TYPES.has(type) && (
          <Field label={playersWord(type).replace(/^./, (c) => c.toUpperCase())}>
            <Input type="number" inputMode="numeric" min={1} max={16} value={players} onChange={(e) => setPlayers(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Note (optional)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
      </Field>
      <StickyActions>
        <ErrorText>{error}</ErrorText>
        <Button size="lg" className="w-full" disabled={pending || !player.ready} onClick={submit}>
          {pending ? "Saving…" : "Save booking"}
        </Button>
      </StickyActions>
    </div>
  );
}
