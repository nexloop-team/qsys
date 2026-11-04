import Link from "next/link";
import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/styles";

export const metadata: Metadata = { title: "Page not found" };

// Unknown URLs, and records that don't exist or belong to another venue (bills, players).
export default function NotFound() {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[640px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
      />
      <Logo href="/dashboard" />
      <div className="mt-10 grid size-12 place-items-center rounded-2xl border border-line bg-panel text-muted shadow-xs">
        <Compass className="size-6" />
      </div>
      <p className="num mt-5 text-sm font-medium text-accent-ink">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The link may be old, or this bill or player belongs to another venue.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/dashboard" className={buttonClass("primary")}>
          Go to Floor
        </Link>
        <Link href="/" className={buttonClass("secondary")}>
          Home
        </Link>
      </div>
    </main>
  );
}
