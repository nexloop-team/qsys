import Link from "next/link";
import type { ReactNode } from "react";
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
} from "./site-chrome";

/** Public guide pages for one kind of venue (snooker clubs, PS5 lounges, PC cafés) and pricing. */

export type GuideItem = readonly [title: string, body: ReactNode];

export type GuideSection = {
  eyebrow: string;
  title: string;
  note?: string;
  /** A numbered list (steps), a plain list, or free content. */
  steps?: readonly GuideItem[];
  items?: readonly GuideItem[];
  body?: ReactNode;
};

export const GUIDES = [
  ["Snooker & pool clubs", "/snooker-club-software"],
  ["PS5 & console lounges", "/ps5-lounge-software"],
  ["Gaming PC & cyber cafés", "/cyber-cafe-software"],
  ["Pricing", "/plans"],
] as const;

export function GuidePage({
  path,
  eyebrow,
  title,
  lead,
  sections,
  faq,
  cta = "Set it up on your own floor.",
}: {
  path: string;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  sections: GuideSection[];
  faq: readonly (readonly [string, string])[];
  cta?: string;
}) {
  // Questions and answers for search engines (they show them under the result).
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };

  return (
    <div className={`${marketingFonts} ${PAGE}`}>
      <Glow className={GLOW_TOP} />
      <SiteHeader />
      <main className="flex-1">
        <section className={`${WRAP} pt-14 sm:pt-20`}>
          <p className={EYEBROW}>{eyebrow}</p>
          <h1 className={`${H1} max-w-[900px]`}>{title}</h1>
          <div className={`${LEAD} mt-6 grid max-w-[760px] gap-4`}>{lead}</div>
          <div className="mt-8 grid max-w-sm gap-2.5 sm:flex sm:max-w-none">
            <Link href="/signup" className={BTN_PRIMARY}>
              Start free
            </Link>
            {path !== "/plans" && (
              <Link href="/plans" className={BTN_SECONDARY}>
                See pricing
              </Link>
            )}
          </div>
        </section>

        {sections.map((s, i) => (
          <SplitSection key={s.title} eyebrow={`${String(i + 1).padStart(2, "0")} · ${s.eyebrow}`} title={s.title} note={s.note}>
            {s.steps && (
              <ol>
                {s.steps.map(([t, b], j) => (
                  <li key={t} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-6 sm:py-6">
                    <span className="font-plexmono text-[13px] text-muted sm:pt-1">{String(j + 1).padStart(2, "0")}</span>
                    <span>
                      <b className="block text-[17px] font-semibold">{t}</b>
                      <span className="mt-1 block text-[15px] text-muted">{b}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {s.items && (
              <ul>
                {s.items.map(([t, b]) => (
                  <li key={t} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6 sm:py-6">
                    <b className="text-[17px] font-semibold">{t}</b>
                    <span className="text-[15px] text-muted">{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.body && <div className="pt-4 text-[15px] text-muted sm:pt-6">{s.body}</div>}
          </SplitSection>
        ))}

        <SplitSection eyebrow="Questions" title="Asked by owners">
          {faq.map(([q, a]) => (
            <details key={q} className="group border-b border-line">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold sm:min-h-16 sm:gap-6 sm:py-5 sm:text-[17px] [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="shrink-0 text-xl leading-none font-normal text-muted transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="-mt-1 pr-8 pb-4 text-[15px] text-muted sm:pr-10 sm:pb-5">{a}</p>
            </details>
          ))}
        </SplitSection>

        <section className={`${WRAP} ${SECTION}`}>
          <p className={EYEBROW}>More guides</p>
          <ul className="flex flex-wrap gap-2">
            {GUIDES.filter(([, href]) => href !== path).map(([label, href]) => (
              <li key={href}>
                <Link href={href} className={BTN_SECONDARY}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${WRAP} ${SECTION} pb-14 sm:pb-28`}>
          <div className="flex flex-wrap items-end justify-between gap-6 border-t-2 border-fg pt-8 sm:gap-8 sm:pt-10">
            <h2 className={`${H2} max-w-[640px]`}>{cta}</h2>
            <div className="grid w-full gap-2.5 sm:flex sm:w-auto">
              <Link href="/signup" className={BTN_PRIMARY}>
                Set up your venue
              </Link>
              <Link href="/contact" className={BTN_SECONDARY}>
                Talk to us
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        // Our own static text; "<" is escaped so it can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }}
      />
    </div>
  );
}

/** Break-even rate: what one station must earn per busy hour to cover the month's costs. */
export function RateMath({ example }: { example: { costs: number; stations: number; hours: number; busy: number } }) {
  const { costs, stations, hours, busy } = example;
  const busyHours = Math.round(stations * hours * 30 * busy);
  const breakEven = Math.ceil(costs / busyHours);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return (
    <div className="grid gap-4">
      <p>
        Add up a month&apos;s costs: rent, electricity, salaries, internet, repairs and your own time. Divide by the hours
        your stations are actually busy, not the hours you are open. That is the least an hour can cost.
      </p>
      <div className="rounded-2xl border border-line bg-panel p-5 font-plexmono text-[13px] leading-7 text-fg sm:text-sm">
        <p>
          {inr(costs)} a month ÷ ({stations} stations × {hours} h open × 30 days × {Math.round(busy * 100)}% busy)
        </p>
        <p>
          = {inr(costs)} ÷ {busyHours.toLocaleString("en-IN")} busy hours ≈ <b>{inr(breakEven)} per hour</b> to break even
        </p>
      </div>
      <p>
        Price above that, by enough to pay you for the risk. Then use evening and weekend rates for the busy hours and a
        lower afternoon rate to fill the quiet ones, instead of one price all day.
      </p>
    </div>
  );
}
