import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 py-8 sm:py-14">
      {/* Soft accent glow + dotted grid behind the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[640px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
      />
      <div className="flex w-full max-w-sm items-center justify-between">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="mt-10 w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-pop sm:p-7">{children}</div>
    </main>
  );
}
