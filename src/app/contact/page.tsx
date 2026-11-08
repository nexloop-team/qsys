import Link from "next/link";
import type { Metadata } from "next";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { marketingFonts } from "@/lib/marketing-fonts";
import { SITE, hasContactDetails } from "@/lib/site";
import {
  EYEBROW,
  Glow,
  GLOW_TOP,
  H1,
  LEAD,
  PAGE,
  SiteFooter,
  SiteHeader,
  SplitSection,
  WRAP,
} from "../_landing/site-chrome";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about QueSys, setting up your venue, or help with your account.",
};

const QUICK = [
  ["Will the PC app slow down games?", "No. It has no game hooks and no screen capture, and key blocking only runs while the PC is locked."],
  ["What if our internet goes down?", "Running sessions still end on time on the PCs, and staff can keep working from a phone on mobile data."],
  ["Do I need to buy hardware?", "No. QueSys runs in the browser, and the PC app installs on each Windows gaming PC."],
] as const;

export default function ContactPage() {
  const c = SITE.contact;
  // Each way to reach us is one big, tappable row (tel: and WhatsApp open the right app on a phone).
  const ways = [
    c.whatsapp && {
      icon: MessageCircle,
      label: "WhatsApp",
      value: `+${c.whatsapp.replace(/\D/g, "")}`,
      href: `https://wa.me/${c.whatsapp.replace(/\D/g, "")}`,
      external: true,
    },
    c.phone && { icon: Phone, label: "Call", value: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, "")}`, external: false },
    c.email && { icon: Mail, label: "Email", value: c.email, href: `mailto:${c.email}`, external: false },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string; href: string; external: boolean }[];

  return (
    <div className={`${marketingFonts} ${PAGE}`}>
      <Glow className={GLOW_TOP} />
      <SiteHeader />
      <main className="flex-1">
        <section className={`${WRAP} grid gap-x-16 gap-y-10 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]`}>
          <div className="min-w-0">
            <p className={EYEBROW}>Contact</p>
            <h1 className={H1}>Talk to us.</h1>
            <p className={`${LEAD} mt-4 max-w-[460px] sm:mt-6`}>
              Questions about QueSys, setting up your venue, pairing your PCs, or help with your account. Send a message and we&apos;ll reply on your email or mobile.
            </p>
            {/* Quick ways to reach us, if filled in (src/lib/site.ts). */}
            {hasContactDetails() && (
              <ul className="mt-8 max-w-[460px] border-t border-line">
                {ways.map(({ icon: Icon, label, value, href, external }) => (
                  <li key={label} className="border-b border-line">
                    <a
                      href={href}
                      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="flex min-h-14 items-center gap-4 py-3 hover:bg-hover"
                    >
                      <Icon className="size-5 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-plexmono text-xs tracking-wider text-muted uppercase">{label}</span>
                        <span className="block truncate font-medium">{value}</span>
                      </span>
                      <span aria-hidden className="text-muted">→</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {(c.city || c.hours) && (
              <p className="mt-6 flex items-start gap-2 text-[15px] text-muted">
                <MapPin className="mt-1 size-4 shrink-0" aria-hidden />
                <span>{[c.city, c.hours].filter(Boolean).join(" · ")}</span>
              </p>
            )}
          </div>

          <div className="relative min-w-0">
            <ContactForm />
          </div>
        </section>

        <SplitSection eyebrow="Before you write" title="Common questions">
          {/* Same accordion as the home page: tap a question for its answer. */}
          {QUICK.map(([q, a]) => (
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
          <p className="pt-5 text-[15px] text-muted">
            More on the{" "}
            <Link href="/#faq" className="font-medium text-fg underline underline-offset-4">
              home page
            </Link>
            .
          </p>
        </SplitSection>
        <div className="pb-14 sm:pb-28" />
      </main>
      <SiteFooter />
    </div>
  );
}
