import Link from "next/link";
import { marketingFonts } from "@/lib/marketing-fonts";
import { BuildScene } from "./_landing/build-scene";
import { FeatureGrid } from "./_landing/feature-grid";
import { HeroField } from "./_landing/hero-field";
import { PoolBreak } from "./_landing/pool-break";
import { SessionStory } from "./_landing/session-story";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  GLOW_TOP,
  Glow,
  H1,
  H2,
  LEAD,
  PAGE,
  SECTION,
  SiteFooter,
  SiteHeader,
  SplitSection,
  WRAP,
} from "./_landing/site-chrome";

// Landing page, top to bottom:
//   Hero (heading over drifting clock ticks) · Band (what it covers)
//   01 What it replaces · 02 How it works (pinned, PC-04 from start to bill) · 03 Tables too (pool
//   break) · 04 Features (bento grid) · 05 Set up in about two minutes (isometric room)
//   06 Questions · Closing ask · Footer
// Colour only means station status; a soft light sits behind the page; light and dark follow the
// site theme. Phones: no pinning, short lists, nothing scrolls sideways.

const BAND = [
  "PCs",
  "PS5",
  "Xbox",
  "8-ball pool",
  "Snooker",
  "GST invoices",
  "UPI",
  "Player wallets",
  "Snacks & stock",
  "Floor map",
  "Branches",
  "WhatsApp bills",
];

const REPLACES = [
  {
    old: "The register book",
    now: "Every start, pause, move and end is recorded, with who did it.",
  },
  {
    old: "The walk to each PC",
    now: "Start at the counter. The PC unlocks itself, and locks again on time.",
  },
  {
    old: "The argument at the counter",
    now: "A bill to the minute, by your own rules, on paper or WhatsApp.",
  },
];

const SESSION = [
  {
    time: "18:46",
    title: "Start",
    body: "Pick the player and two hours. PC-04 unlocks itself.",
    dot: "bg-busy",
    text: "text-busy",
  },
  {
    time: "20:41",
    title: "5 minutes left",
    body: "Amber on the floor, an alert for staff, a small timer for the player.",
    dot: "bg-ending",
    text: "text-ending",
  },
  {
    time: "20:46",
    title: "Time's up",
    body: "The game is minimised and PC-04 locks, internet or not.",
    dot: "bg-over",
    text: "text-over",
  },
  {
    time: "20:47",
    title: "Bill",
    body: "Time plus snacks, by cash, UPI or wallet. Printed or on WhatsApp.",
    dot: "bg-free",
    text: "text-free",
  },
];

const FAQ = [
  [
    "Will the PC app slow down games?",
    "No. It has no game hooks and no screen capture, and its key blocking only runs while the PC is locked.",
  ],
  [
    "What if our internet goes down?",
    "Running sessions still end on time on the PCs, and staff can keep working from a phone on mobile data.",
  ],
  [
    "Do I need to buy hardware?",
    "No. QueSys runs in the browser. The PC app installs on each Windows gaming PC; consoles and tables are timed from the floor screen.",
  ],
  [
    "Does it handle GST?",
    "Yes. Turn GST on per branch for tax invoices with CGST and SGST, or keep it off for plain receipts.",
  ],
  [
    "Can staff give away free time?",
    "Discounts need a reason and staff have a limit you set. Every discount and write-off is in the activity log.",
  ],
] as const;

export default function Home() {
  return (
    <div className={`${marketingFonts} ${PAGE}`}>
      <Glow className={GLOW_TOP} />
      <SiteHeader />

      <main className="flex-1">
        {/* Hero: fills the first screen, the heading over a field of drifting clock ticks, the band
            along the bottom edge. */}
        <section id="try" className="relative flex min-h-[calc(100svh-4.75rem-2.75rem)] flex-col overflow-hidden">
          <HeroField />
          <Glow className="top-1/2 left-1/2 h-[560px] w-[1000px] max-w-[200vw] -translate-x-1/2 -translate-y-1/2" />
          <div className={`${WRAP} my-auto py-16 sm:py-20 sm:text-center`}>
            <h1 className="mx-auto max-w-[1000px] text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance max-sm:mx-0 sm:text-[60px] lg:text-[84px]">
              Every station, every minute, on one screen.
            </h1>
            <p className={`${LEAD} mt-4 max-w-[560px] sm:mx-auto sm:mt-5`}>
              Timers that run on the server, PCs that lock themselves, and bills to the minute: cash, UPI or wallet.
            </p>
            <div className="mt-7 grid gap-2.5 sm:mt-8 sm:flex sm:justify-center">
              <Link href="/signup" className={BTN_PRIMARY}>
                Set up your venue
              </Link>
              {/* Phones: the top bar has no Log in, so it is here instead. */}
              <Link href="/login" className={`${BTN_SECONDARY} sm:hidden`}>
                Staff log in
              </Link>
              <a href="#how" className={`${BTN_SECONDARY} max-sm:hidden`}>
                See how it works
              </a>
            </div>
          </div>
        </section>

        {/* Band: what QueSys covers, drifting sideways (still when the visitor prefers less motion) */}
        <div
          aria-label="What QueSys covers"
          className="overflow-hidden border-y border-line [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
        >
          <div className="marquee flex w-max">
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1}
                className="flex shrink-0 items-center gap-6 py-3.5 pr-6 font-plexmono text-[13px] whitespace-nowrap text-fg/70"
              >
                {[...BAND, ...BAND].map((w, i) => (
                  <li key={`${w}-${i}`} className="flex items-center gap-6">
                    {w}
                    <span aria-hidden className="size-1 rounded-full bg-line-strong" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <SplitSection id="replaces" eyebrow="01 · Before and after" title="What it replaces">
          <ul>
            {REPLACES.map((r) => (
              <li
                key={r.old}
                className="grid gap-1 border-b border-line py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6 sm:py-6"
              >
                <span className="font-plexmono text-[13px] text-muted line-through sm:pt-1">{r.old}</span>
                <span className="text-[17px] leading-snug font-medium sm:text-lg">{r.now}</span>
              </li>
            ))}
          </ul>
        </SplitSection>

        {/* How it works. Tablet and up: pinned while you scroll, the steps lighting up one by one
            next to PC-04. Phones: the same steps as a short list. */}
        <div id="how">
          <div className="md:hidden">
            <SplitSection
              eyebrow="02 · Every session"
              title="How it works"
              note="A two-hour booking on PC-04, start to bill."
            >
              <ol className="grid sm:grid-cols-2 xl:grid-cols-4">
                {SESSION.map((s) => (
                  <li key={s.time} className="border-b border-line py-4 sm:py-6 sm:pr-6">
                    <span
                      className={`inline-flex items-center gap-2 font-plexmono text-[13px] font-semibold ${s.text}`}
                    >
                      <span aria-hidden className={`size-2 rounded-[2px] ${s.dot}`} />
                      {s.time}
                    </span>
                    <b className="mt-1.5 block text-[17px] font-semibold sm:mt-2">{s.title}</b>
                    <span className="mt-1 block text-[15px] text-muted">{s.body}</span>
                  </li>
                ))}
              </ol>
            </SplitSection>
          </div>
          <section aria-label="How it works" className="max-md:hidden">
            <SessionStory steps={SESSION} note="A two-hour booking on PC-04, start to bill." />
          </section>
        </div>

        {/* 03 · Tables: a pool break played by scrolling, the table clock starting on the break */}
        <section aria-label="Pool table timing" className="pt-14 sm:pt-20 md:pt-0">
          <PoolBreak />
        </section>

        {/* 04 · Features: a bento grid, each card with a small live picture of the feature */}
        <section id="included" className={`${WRAP} ${SECTION}`}>
          <div className="mb-8 grid gap-x-16 gap-y-4 sm:mb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end">
            <div>
              <p className={EYEBROW}>04 · Features</p>
              <h2 className={`${H2} reveal`}>
                Everything the counter needs. <span className="text-muted">Nothing it doesn&apos;t.</span>
              </h2>
            </div>
            <p className="text-[15px] text-muted sm:text-base">
              One screen for time, money and stock, for one branch or several, on a laptop at the counter or a phone on
              the floor.
            </p>
          </div>
          <FeatureGrid />
        </section>

        {/* 05 · Setup, built while you scroll: the floor, the stations, prices, then live */}
        <section aria-label="Setting up your venue" className="pt-14 sm:pt-20 md:pt-0">
          <BuildScene />
        </section>

        <SplitSection id="faq" eyebrow="06 · Questions" title="Asked at every counter">
          {/* Tap a question to open its answer (works with a keyboard too). */}
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b border-line">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold sm:min-h-16 sm:gap-6 sm:py-5 sm:text-[17px] [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden
                  className="shrink-0 text-xl leading-none font-normal text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="-mt-1 pr-8 pb-4 text-[15px] text-muted sm:pr-10 sm:pb-5">{a}</p>
            </details>
          ))}
        </SplitSection>

        {/* Close: the last ask, with a soft light rising from below. Follows the theme. */}
        <section className="relative mt-14 overflow-hidden border-t border-line px-4 py-16 text-center sm:mt-20 sm:py-28">
          <Glow className="-bottom-80 left-1/2 h-[640px] w-[1000px] max-w-[160vw] -translate-x-1/2" />
          <h2 className={`${H1} reveal mx-auto max-w-[860px]`}>Ready for your next player?</h2>
          <div className="mx-auto mt-7 grid max-w-sm gap-2.5 sm:mt-9 sm:flex sm:max-w-none sm:justify-center">
            <Link href="/signup" className={BTN_PRIMARY}>
              Create your account
            </Link>
            <Link href="/login" className={BTN_SECONDARY}>
              Staff log in
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
