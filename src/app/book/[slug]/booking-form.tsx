"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarCheck, Loader2, MapPin, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { nextDay } from "@/lib/format";
import { STATION_TYPE_LABEL, MULTIPLAYER_TYPES, type StationType } from "@/lib/constants";
import { Button, ErrorText, Field, Input, Textarea, cx } from "@/components/ui";

type Info =
  | { ok: false; error: string }
  | {
      ok: true;
      venue: string;
      branch: string;
      address: string | null;
      phone: string | null;
      timezone: string;
      opens: string;
      closes: string;
      days: number;
      note: string | null;
      today: string;
      types: { type: StationType; count: number }[];
    };
type Slot = { time: string; starts_at: string; free: number };

const LENGTHS = [30, 60, 90, 120, 180] as const;
const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}½ hr` : `${m / 60} hr`);

// "Today", "Tomorrow", then "Sat 14".
function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === nextDay(today)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

// 24-hour "18:30" → "6:30 pm".
function time12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const chip = (active: boolean, disabled = false) =>
  cx(
    "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
    disabled
      ? "border-line text-faint line-through"
      : active
        ? "border-accent bg-accent text-accent-fg"
        : "border-line-strong bg-panel hover:bg-hover",
  );

export function BookingForm({ slug }: { slug: string }) {
  const [supabase] = useState(createClient);
  const [info, setInfo] = useState<Info | null>(null);
  const [type, setType] = useState<StationType | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [slots, setSlots] = useState<{ key: string; list: Slot[] } | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const detailsRef = useRef<HTMLElement>(null);
  const [trap, setTrap] = useState(""); // hidden field: only bots fill it
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void supabase.rpc("public_booking_info", { p_slug: slug }).then(({ data, error }) => {
      if (error) return setInfo({ ok: false, error: friendlyError(error, "Couldn't load this page.") });
      const v = data as unknown as Info;
      setInfo(v);
      if (v.ok) {
        setDate(v.today);
        setType(v.types[0]?.type ?? null);
        // A returning player doesn't type their name and number again.
        try {
          const saved = JSON.parse(localStorage.getItem("qs-booker") ?? "null") as { name?: string; phone?: string } | null;
          if (saved?.name) setName(saved.name);
          if (saved?.phone) setPhone(saved.phone);
        } catch {}
      }
    });
  }, [supabase, slug]);

  const slotKey = type && date ? `${type}|${date}|${minutes}` : null;
  useEffect(() => {
    if (!slotKey) return;
    let cancelled = false;
    const [t, d, m] = slotKey.split("|");
    void supabase
      .rpc("public_booking_slots", { p_slug: slug, p_type: t as StationType, p_date: d, p_minutes: Number(m) })
      .then(({ data }) => {
        if (!cancelled) setSlots({ key: slotKey, list: (data ?? []) as unknown as Slot[] });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, slug, slotKey]);

  if (!info) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (!info.ok) {
    return (
      <div className="mt-16 rounded-xl border border-line bg-panel p-6 text-center text-sm">{info.error}</div>
    );
  }

  const days = Array.from({ length: info.days + 1 }, (_, i) => nextDay(info.today, i));
  const slotList = slots?.key === slotKey ? slots.list : null;
  const picked = slotList?.find((s) => s.starts_at === startsAt);
  const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const phoneOk = /^[6-9]\d{9}$/.test(digits);
  const ready = Boolean(type && picked && picked.free > 0 && name.trim().length >= 2 && phoneOk);
  // The button says what's still missing, so nobody taps a dead button wondering why.
  const buttonText = pending
    ? "Sending…"
    : !picked || !date
      ? "Pick a start time"
      : name.trim().length < 2
        ? "Add your name"
        : !phoneOk
          ? "Add your 10-digit mobile number"
          : `Request ${dayLabel(date, info.today)}, ${time12(picked.time)}`;

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      if (trap) return setDone(true);
      const { error } = await supabase.rpc("public_create_booking", {
        p_slug: slug,
        p_type: type!,
        p_starts_at: picked!.starts_at,
        p_minutes: minutes,
        // Staff can change the player count on arrival; this just picks a sensible default.
        p_players: type && MULTIPLAYER_TYPES.has(type) ? 2 : 1,
        p_name: name.trim(),
        p_phone: digits,
        p_note: note.trim() || null,
      });
      if (error) return setError(friendlyError(error));
      try {
        localStorage.setItem("qs-booker", JSON.stringify({ name: name.trim(), phone: digits }));
      } catch {}
      setDone(true);
    });

  if (done) {
    return (
      <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-line bg-panel p-6 text-center">
        <CalendarCheck className="size-8 text-ok" />
        <h1 className="text-lg font-semibold">Booking request sent</h1>
        <p className="text-sm text-muted">
          {info.venue} will confirm your booking
          {picked && date ? ` for ${dayLabel(date, info.today).toLowerCase()} at ${time12(picked.time)}` : ""} by call or
          WhatsApp.
        </p>
        {info.phone && (
          <a href={`tel:${info.phone.replace(/[^\d+]/g, "")}`} className="text-sm font-medium underline underline-offset-4">
            Call {info.phone}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Book at</p>
        <h1 className="text-[24px] font-semibold leading-tight tracking-tight">{info.venue}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {info.address && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {info.address}
            </span>
          )}
          {info.phone && (
            <a href={`tel:${info.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-fg">
              <Phone className="size-3.5" /> {info.phone}
            </a>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          Open {time12(info.opens)} – {time12(info.closes)}
        </p>
        {info.note && <p className="mt-3 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm">{info.note}</p>}
      </header>

      {info.types.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-5 text-center text-sm text-muted">
          Nothing to book right now. Please call the venue.
        </p>
      ) : (
        <>
          {info.types.length > 1 && (
            <section className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">What do you want to play?</span>
              <div className="flex flex-wrap gap-2">
                {info.types.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className={chip(type === t.type)}
                    onClick={() => {
                      setType(t.type);
                      setStartsAt(null);
                    }}
                  >
                    {STATION_TYPE_LABEL[t.type]}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Which day?</span>
            <div className="swipe-row -mx-4 flex gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none]">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={cx(chip(date === d), "shrink-0")}
                  onClick={() => {
                    setDate(d);
                    setStartsAt(null);
                  }}
                >
                  {dayLabel(d, info.today)}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">How long?</span>
            <div className="flex flex-wrap gap-2">
              {LENGTHS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={chip(minutes === m)}
                  onClick={() => {
                    setMinutes(m);
                    setStartsAt(null);
                  }}
                >
                  {lengthLabel(m)}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">What time?</span>
            {!slotList ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> Checking free times…
              </p>
            ) : slotList.length === 0 ? (
              <p className="text-sm text-muted">Nothing free on this day for that long. Try another day or a shorter time.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slotList.map((s) => (
                  <button
                    key={s.starts_at}
                    type="button"
                    disabled={s.free <= 0}
                    className={chip(startsAt === s.starts_at, s.free <= 0)}
                    onClick={() => {
                      setStartsAt(s.starts_at);
                      // Next step: their details. Bring it into view on a phone.
                      if (!name || !phone)
                        window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }}
                  >
                    {time12(s.time)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section ref={detailsRef} className="flex scroll-mt-4 flex-col gap-3 border-t border-line pb-2 pt-5">
            <span className="text-[13px] font-medium">Your details</span>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </Field>
            <Field label="Mobile number" hint="The venue calls or WhatsApps this number to confirm.">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value.slice(0, 16))}
                inputMode="tel"
                autoComplete="tel"
                placeholder="98765 43210"
              />
            </Field>
            {noteOpen ? (
              <Field label="Note for the venue">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} autoFocus />
              </Field>
            ) : (
              <button
                type="button"
                className="self-start text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
                onClick={() => setNoteOpen(true)}
              >
                + Add a note (optional)
              </button>
            )}
            {/* Bots fill every field; people never see this one. */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
              name="website"
            />
          </section>

          <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <ErrorText>{error}</ErrorText>
            <Button size="lg" className="mt-2 w-full" disabled={!ready || pending} onClick={submit}>
              {buttonText}
            </Button>
            <p className="mt-2 text-center text-xs text-muted">Nothing to pay now. Your booking is held once the venue confirms.</p>
          </div>
        </>
      )}
    </div>
  );
}
