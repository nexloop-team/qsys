"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ExternalLink, MessageCircle, Phone, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatTime, nextDay } from "@/lib/format";
import { openWhatsApp } from "@/lib/whatsapp";
import { STATION_TYPE_LABEL, playersWord, type StationType } from "@/lib/constants";
import { Badge, Empty, PageHeader, Panel } from "@/components/card";
import { Button, ErrorText, Select, buttonClass, cx } from "@/components/ui";
import { AddBookingButton } from "./booking-dialog";

export type BookingRow = {
  id: string;
  station_type: StationType;
  station_id: string | null;
  name: string;
  phone: string;
  starts_at: string;
  minutes: number;
  players: number;
  note: string | null;
  status: "requested" | "confirmed" | "arrived" | "cancelled" | "no_show";
  source: "online" | "staff";
};
type Station = { id: string; name: string; type: StationType };
type Branch = { id: string; name: string; timezone: string };

const STATUS_BADGE = {
  requested: { label: "To confirm", tone: "ending" },
  confirmed: { label: "Confirmed", tone: "free" },
  arrived: { label: "Arrived", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No-show", tone: "over" },
} as const;

export function BookingsView({
  orgId,
  branch,
  venueName,
  today,
  bookings,
  stations,
  types,
  bookingPage,
}: {
  orgId: string;
  branch: Branch;
  venueName: string;
  today: string;
  bookings: BookingRow[];
  stations: Station[];
  types: StationType[];
  bookingPage: string | null;
}) {
  const router = useRouter();
  // New online requests show up without a reload.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bookings-page:${branch.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `branch_id=eq.${branch.id}` }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [branch.id, router]);

  const requests = bookings.filter((b) => b.status === "requested");
  const rest = bookings.filter((b) => b.status !== "requested");
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: branch.timezone }).format(new Date(iso));
  const days = [...new Set(rest.map((b) => dayOf(b.starts_at)))];

  return (
    <>
      <PageHeader
        title="Bookings"
        description={`${branch.name} · today and the days ahead`}
        actions={
          <>
            {bookingPage ? (
              <a href={bookingPage} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                <ExternalLink /> Booking page
              </a>
            ) : (
              <Link href="/settings/online" className={buttonClass("secondary", "sm")}>
                Take bookings online
              </Link>
            )}
            <AddBookingButton orgId={orgId} branch={branch} stations={stations} types={types} today={today} />
          </>
        }
      />

      {bookings.length === 0 ? (
        <Panel>
          <Empty icon={<CalendarClock />} title="No bookings yet">
            Add bookings you take by phone, or turn on the booking page so players can ask for a time themselves.
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {requests.length > 0 && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-ending blink" /> To confirm
                  <span className="num rounded-full bg-ending/10 px-1.5 text-xs text-ending">{requests.length}</span>
                </span>
              }
              flush
            >
              <ul className="divide-y divide-line">
                {requests.map((b) => (
                  <BookingCard key={b.id} b={b} branch={branch} venueName={venueName} today={today} stations={stations} />
                ))}
              </ul>
            </Panel>
          )}
          {days.map((d) => (
            <Panel key={d} title={dayTitle(d, today)} flush>
              <ul className="divide-y divide-line">
                {rest
                  .filter((b) => dayOf(b.starts_at) === d)
                  .map((b) => (
                    <BookingCard key={b.id} b={b} branch={branch} venueName={venueName} today={today} stations={stations} />
                  ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function dayTitle(date: string, today: string) {
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
  if (date === today) return `Today · ${label}`;
  if (date === nextDay(today)) return `Tomorrow · ${label}`;
  return label;
}

function BookingCard({
  b,
  branch,
  venueName,
  today,
  stations,
}: {
  b: BookingRow;
  branch: Branch;
  venueName: string;
  today: string;
  stations: Station[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [stationId, setStationId] = useState(b.station_id ?? "");
  const tz = branch.timezone;
  const ends = new Date(Date.parse(b.starts_at) + b.minutes * 60_000).toISOString();
  const station = stations.find((s) => s.id === b.station_id);
  const options = stations.filter((s) => s.type === b.station_type);
  const badge = STATUS_BADGE[b.status];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(b.starts_at));
  const when = `${dayTitle(day, today).split(" · ")[0]} at ${formatTime(b.starts_at, tz)}`;
  const faded = b.status === "cancelled" || b.status === "no_show";

  const setStatus = (status: "confirmed" | "arrived" | "cancelled" | "no_show") =>
    startTransition(async () => {
      setError(undefined);
      const { error } = await createClient().rpc("set_booking_status", {
        p_booking_id: b.id,
        p_status: status,
        p_station_id: status === "confirmed" ? stationId || null : undefined,
      });
      if (error) return setError(friendlyError(error));
      router.refresh();
    });

  // Only a confirmed booking gets the "confirmed" message: before that, staff are just getting in touch.
  const message =
    b.status === "confirmed"
      ? `Hi ${b.name}, your booking at ${venueName} is confirmed for ${when.toLowerCase()} (${STATION_TYPE_LABEL[b.station_type]}${
          station ? `, ${station.name}` : ""
        }, ${b.minutes} min). See you!`
      : `Hi ${b.name}, this is ${venueName} about your booking request for ${when.toLowerCase()}.`;

  return (
    <li className={cx("flex flex-col gap-2.5 px-4 py-3", faded && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="num text-sm font-semibold">
            {b.status === "requested" && day !== today ? `${dayTitle(day, today).split(" · ")[0]}, ` : ""}
            {formatTime(b.starts_at, tz)} – {formatTime(ends, tz)}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{b.name}</span>{" "}
            <a href={`tel:${b.phone}`} className="num text-muted underline-offset-4 hover:underline">
              {b.phone.slice(0, 5)} {b.phone.slice(5)}
            </a>
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge>{STATION_TYPE_LABEL[b.station_type]}</Badge>
          {station && <Badge>{station.name}</Badge>}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" /> {b.players} {playersWord(b.station_type, b.players)}
        </span>
        <span>{b.source === "online" ? "Booked online" : "Booked by phone"}</span>
        {b.note && <span className="text-fg">“{b.note}”</span>}
      </p>

      <ErrorText>{error}</ErrorText>

      {(b.status === "requested" || b.status === "confirmed") && (
        <div className="flex flex-wrap items-center gap-2">
          {b.status === "requested" ? (
            <>
              <Select
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                className="h-9 w-auto min-w-36 flex-1 sm:flex-none"
                aria-label="Station"
              >
                <option value="">Any station</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={pending} onClick={() => setStatus("confirmed")}>
                <Check /> Confirm
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={pending} onClick={() => setStatus("arrived")}>
                <Check /> Arrived
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus("no_show")}>
                No-show
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => openWhatsApp(b.phone, message)}>
            <MessageCircle /> WhatsApp
          </Button>
          <a href={`tel:${b.phone}`} className={buttonClass("secondary", "sm")} aria-label={`Call ${b.name}`}>
            <Phone />
          </a>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={pending}
            onClick={() => window.confirm(`Cancel ${b.name}'s booking?`) && setStatus("cancelled")}
          >
            <X /> Cancel
          </Button>
        </div>
      )}
    </li>
  );
}
