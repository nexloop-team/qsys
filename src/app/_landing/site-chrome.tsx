import type React from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { Wordmark } from "./wordmark";

// Top bar, footer and the shared styles of the public pages (home, about, contact, log in).
// One heading style, one button shape, one section rhythm, so every page matches.

export const WRAP = "mx-auto w-full max-w-[1240px] px-4 sm:px-8";
/** Space above every section. */
export const SECTION = "pt-14 sm:pt-28";
export const H1 = "text-[36px] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[64px]";
export const H2 = "text-[28px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-[42px]";
export const H3 = "text-[24px] leading-[1.12] font-semibold tracking-[-0.025em] text-balance sm:text-[32px]";
export const EYEBROW = "mb-3 sm:mb-4 font-plexmono text-[13px] tracking-wide text-muted";
export const LEAD = "text-[17px] text-pretty text-muted sm:text-lg";
const BTN = "inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] transition-colors";
export const BTN_PRIMARY = `${BTN} bg-accent font-semibold text-accent-fg hover:bg-accent/85`;
export const BTN_SECONDARY = `${BTN} border border-line-strong font-medium hover:bg-hover`;

/** The wrapper of every public page. The glows sit behind its content; nothing scrolls sideways. */
export const PAGE = "relative isolate flex flex-1 flex-col overflow-x-clip bg-bg text-[16px] leading-relaxed text-fg";

/**
 * A soft light behind a page or a section, the same light as the closing band: white on the
 * light grey page, faint white on the dark one. Needs an `isolate` ancestor (PAGE has it).
 */
export function Glow({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute -z-10 bg-[radial-gradient(closest-side,var(--glow),transparent)] ${className}`}
    />
  );
}

/** The glow at the top of a page, behind the header and the first heading. */
export const GLOW_TOP = "-top-72 left-1/2 h-[640px] w-[1100px] max-w-[220vw] -translate-x-1/2";

/** A text section: label and heading on the left, the content on the right (stacked on phones). */
export function SplitSection({
  id,
  eyebrow,
  title,
  note,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`${WRAP} ${SECTION} relative grid gap-x-16 gap-y-6 sm:gap-y-8 lg:grid-cols-[340px_minmax(0,1fr)]`}>
      <Glow className="-top-16 -left-72 h-[440px] w-[760px] max-w-[180vw]" />
      <div>
        <p className={EYEBROW}>{eyebrow}</p>
        <h2 className={`${H2} reveal`}>{title}</h2>
        {note && <p className="mt-3 text-[15px] text-muted sm:mt-4">{note}</p>}
      </div>
      <div className="min-w-0 border-t-2 border-fg">{children}</div>
    </section>
  );
}

/**
 * Liquid glass: see-through, blurred and saturated behind, a bright top edge and a soft sheen,
 * like a pane floating over the page.
 */
const GLASS_BAR =
  "relative overflow-hidden rounded-full border border-line-strong/60 bg-panel/55 backdrop-blur-2xl backdrop-saturate-[1.8] " +
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.45),inset_0_-1px_0_rgb(255_255_255/0.06),0_10px_36px_-12px_rgb(0_0_0/0.35)] " +
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[linear-gradient(180deg,rgb(255_255_255/0.22),transparent_55%)] before:content-['']";

/** Height the floating top bar takes, for layouts that fill the first screen. */
export const HEADER_H = "4.75rem";

export function SiteHeader() {
  return (
    // Floats over the page and stays at the top while you scroll.
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-6">
      <div className={`${GLASS_BAR} mx-auto flex h-16 max-w-[1100px] items-center gap-4 pr-2 pl-5 sm:gap-6 sm:pl-6`}>
        <span className="relative">
          <Wordmark />
        </span>
        <nav aria-label="Pages" className="relative hidden gap-1 text-sm text-muted sm:flex">
          <Link href="/about" className="inline-flex h-10 items-center rounded-full px-3 transition-colors hover:bg-hover/70 hover:text-fg">
            About
          </Link>
          <Link href="/contact" className="inline-flex h-10 items-center rounded-full px-3 transition-colors hover:bg-hover/70 hover:text-fg">
            Contact
          </Link>
        </nav>
        <span className="relative ml-auto flex items-center gap-2 sm:gap-1.5">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-hover hover:text-fg max-sm:hidden"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent/85 sm:px-5"
          >
            Get started
          </Link>
        </span>
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  {
    title: "Product",
    links: [
      ["Features", "/#included"],
      ["How it works", "/#how"],
      ["Questions", "/#faq"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Account",
    links: [
      ["Create account", "/signup"],
      ["Log in", "/login"],
      ["Join with invite code", "/onboarding"],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className={`${WRAP} flex flex-wrap justify-between gap-x-16 gap-y-8 pt-10 pb-6 sm:gap-y-10 sm:pt-12 sm:pb-10`}>
        <div className="max-w-[340px]">
          <Wordmark />
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Timers, PC control, billing and bookings for gaming lounges and pool &amp; snooker halls. Made for Indian venues.
          </p>
        </div>
        <nav aria-label="Footer" className="grid w-full grid-cols-3 gap-x-4 sm:w-auto sm:gap-x-12">
          {FOOTER_LINKS.map((group) => (
            <div key={group.title} className="flex flex-col">
              <p className="mb-1.5 text-xs font-semibold text-muted">{group.title}</p>
              {group.links.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-9 items-center text-sm leading-snug text-fg/80 hover:text-fg pointer-coarse:min-h-11"
                >
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className={`${WRAP} border-t border-line py-4 font-plexmono text-xs text-muted sm:py-5`}>
        QueSys · made for gaming and cue-sports venues in India
      </div>
    </footer>
  );
}
