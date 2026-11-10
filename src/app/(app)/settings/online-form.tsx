"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, QrCode } from "lucide-react";
import { saveOnlineSettings } from "./actions";
import { Button, Field, FormMessage, Input, SubmitButton, Textarea, Toggle, buttonClass, cx } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

export function OnlineForm({
  settings,
  hours,
  siteUrl,
  disabled,
}: {
  settings: {
    qr_enabled: boolean;
    qr_orders: boolean;
    booking_enabled: boolean;
    booking_slug: string | null;
    booking_days: number;
    booking_note: string | null;
  };
  /** "10:00–23:00" from the venue's opening hours (or the default). */
  hours: string;
  siteUrl: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(saveOnlineSettings, null);
  const [qr, setQr] = useState(settings.qr_enabled);
  const [orders, setOrders] = useState(settings.qr_orders);
  const [booking, setBooking] = useState(settings.booking_enabled);
  const [slug, setSlug] = useState(settings.booking_slug ?? "");
  const host = siteUrl.replace(/^https?:\/\//, "");
  const [copied, setCopied] = useState(false);
  const liveLink = settings.booking_enabled && settings.booking_slug ? `${siteUrl}/book/${settings.booking_slug}` : null;

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection
          title="Player QR page"
          description="Stick a QR code on each station. Players scan it to see their timer and bill, order snacks, ask for 30 more minutes, or call staff. Nothing reaches the bill until staff accept it on the Floor."
          action={
            <Link href="/stations/qr" className={buttonClass("secondary", "sm")}>
              <QrCode /> Print QR codes
            </Link>
          }
        >
          <div className="flex flex-col gap-4">
            <Toggle name="qr_enabled" checked={qr} onChange={setQr} label="Turn on the player page" />
            <div className="border-t border-line pt-4">
              <Toggle
                name="qr_orders"
                checked={orders}
                onChange={setOrders}
                label="Players can order snacks & drinks"
                description="On the QR page and in the games menu of the QueSys PC app (that one works even with the page off). Shows what's in stock; an order goes on the bill when staff accept it."
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Booking page"
          description={`Players pick a time and send a request, and you confirm it under Bookings. There's no payment online. Times follow your opening hours (${hours}), which you can change under Venue.`}
        >
          <div className="flex flex-col gap-4">
            <Toggle name="booking_enabled" checked={booking} onChange={setBooking} label="Take bookings online" />
            <div className={cx("grid gap-3 sm:grid-cols-2", !booking && "opacity-50")}>
              <Field label="Page address" hint={`${host}/book/${slug || "your-venue"}. Letters, numbers and dashes.`} className="sm:col-span-2">
                <Input
                  name="booking_slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40))}
                  placeholder="cue-club-nashik"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
              <Field label="How far ahead (days)">
                <Input name="booking_days" type="number" min={1} max={30} defaultValue={settings.booking_days} />
              </Field>
              <Field label="Note on the page" hint="Optional. For example: We hold a booking for 15 minutes." className="sm:col-span-2">
                <Textarea name="booking_note" defaultValue={settings.booking_note ?? ""} maxLength={300} rows={2} />
              </Field>
            </div>
            {liveLink && (
              <div className="flex flex-wrap gap-2">
                <a href={liveLink} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                  <ExternalLink /> Open the booking page
                </a>
                {/* For the venue's WhatsApp status, Instagram bio or Google listing. */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard?.writeText(liveLink).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    })
                  }
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>
      </fieldset>
      {!disabled && (
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
