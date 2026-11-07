import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme";
import { marketingFonts } from "@/lib/marketing-fonts";
import { AuthBoard } from "../_landing/auth-board";
import { Glow } from "../_landing/site-chrome";
import { Wordmark } from "../_landing/wordmark";

// Log in, sign up, reset: the form on the left; on wide screens a live station board on the
// right, the same look as the landing page. Phones get just the form.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${marketingFonts} relative isolate flex flex-1 overflow-x-clip bg-bg text-fg`}>
      <main className="relative flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-8 sm:py-7">
        <Glow className="-top-72 left-1/2 h-[600px] w-[900px] max-w-[220vw] -translate-x-1/2" />
        <div className="flex items-center justify-between">
          <Wordmark />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10 sm:py-14 [&_button[type=submit]]:rounded-full">{children}</div>
        <p className="text-center text-xs text-muted lg:text-left">For PC, PS5, Xbox, snooker and 8-ball pool venues.</p>
      </main>

      <aside
        aria-label="What QueSys looks like"
        className="relative isolate hidden flex-1 items-center justify-center overflow-hidden border-l border-line bg-subtle px-10 py-12 lg:flex dark:bg-[#0e0f12]"
      >
        {/* Its own layer (isolate), so the light shows over the panel's background. */}
        <Glow className="top-1/2 left-1/2 h-[720px] w-[900px] -translate-x-1/2 -translate-y-1/2" />
        {/* Centred block, as wide as the board. */}
        <div className="flex w-full max-w-[540px] flex-col gap-7">
          <div>
            <p className="mb-4 font-plexmono text-[13px] tracking-wide text-muted">What you&apos;ll see after logging in</p>
            <p className="text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
              Every PC, console and table on one board.
            </p>
          </div>
          <AuthBoard />
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 font-plexmono text-[13px] text-muted">
            {["Times run on the server", "PCs lock themselves", "Bills to the minute"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span aria-hidden className="size-1 rounded-full bg-free" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
