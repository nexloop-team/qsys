import Link from "next/link";
import type { Metadata } from "next";
import { marketingFonts } from "@/lib/marketing-fonts";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  Glow,
  GLOW_TOP,
  H1,
  H2,
  LEAD,
  PAGE,
  SECTION,
  SiteFooter,
  SiteHeader,
  SplitSection,
  WRAP,
} from "../_landing/site-chrome";

export const metadata: Metadata = {
  title: "About",
  description: "QueSys is timers, PC control, billing and bookings for gaming lounges and pool & snooker halls in India.",
};

const FOR = [
  ["Gaming lounges", "PCs, PS5 and Xbox, timed by the minute, with PCs that lock and unlock themselves."],
  ["Pool and snooker halls", "Every table on one board, by the minute or by the frame, 2 or 4 players at your price, and the bill to the losing side."],
  ["One branch or several", "Each branch has its own floor, prices, bills and booking page. Players and team are shared."],
] as const;

const PRINCIPLES = [
  [
    "Time is kept in one place",
    "Every timer runs on the server. The counter, each staff phone and every PC show the same minute, and changing a PC's clock changes nothing.",
  ],
  [
    "The counter comes first",
    "Starting, extending and billing take a tap or two, on a laptop or a phone, because that is where the evening is busiest.",
  ],
  [
    "The owner stays in control",
    "Discounts need a reason, staff have limits, and every change lands in an activity log only the owner sees.",
  ],
  ["Nothing that slows a game", "The PC app has no game hooks and no screen capture. Its key blocking only runs while the PC is locked."],
  ["Made for Indian venues", "Rupees, UPI and cash, GST on or off, pay later with a limit, and bills and reminders on WhatsApp or an 80 mm printer."],
] as const;

export default function AboutPage() {
  return (
    <div className={`${marketingFonts} ${PAGE}`}>
      <Glow className={GLOW_TOP} />
      <SiteHeader />
      <main className="flex-1">
        <section className={`${WRAP} pt-14 sm:pt-20`}>
          <p className={EYEBROW}>About QueSys</p>
          <h1 className={`${H1} max-w-[860px]`}>Built for the counter of a gaming venue.</h1>
          <div className={`${LEAD} mt-6 grid max-w-[760px] gap-4`}>
            <p>
              At most gaming lounges and pool halls, someone still walks to each PC to unlock it, writes start times in a
              register, and argues about minutes when the bill comes. It costs money in missed minutes and it costs the
              staff their evening.
            </p>
            <p>
              QueSys puts every PC, console and table on one board, keeps the time on the server, locks PCs when time is up,
              and turns every minute into a bill that is paid by cash, UPI or wallet. Players can book a time online, and
              order snacks or ask for more time from a QR code on their station.
            </p>
          </div>
        </section>

        <SplitSection eyebrow="01 · Who it's for" title="Venues that sell time">
          <ul>
            {FOR.map(([title, body]) => (
              <li key={title} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6 sm:py-6">
                <b className="text-[17px] font-semibold">{title}</b>
                <span className="text-[15px] text-muted">{body}</span>
              </li>
            ))}
          </ul>
        </SplitSection>

        <SplitSection eyebrow="02 · Principles" title="How we build it">
          <ol>
            {PRINCIPLES.map(([title, body], i) => (
              <li key={title} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-6 sm:py-6">
                <span className="font-plexmono text-[13px] text-muted sm:pt-1">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <b className="block text-[17px] font-semibold">{title}</b>
                  <span className="mt-1 block text-[15px] text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </SplitSection>

        <section className={`${WRAP} ${SECTION} pb-14 sm:pb-28`}>
          <div className="flex flex-wrap items-end justify-between gap-6 border-t-2 border-fg pt-8 sm:gap-8 sm:pt-10">
            <h2 className={`${H2} max-w-[640px]`}>See it on your own floor.</h2>
            <div className="grid w-full gap-2.5 sm:flex sm:w-auto">
              <Link href="/signup" className={BTN_PRIMARY}>
                Set up your venue
              </Link>
              <Link href="/contact" className={BTN_SECONDARY}>
                Contact us
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
