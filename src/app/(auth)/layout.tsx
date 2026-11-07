import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";

// Split screen: the form on the left, a quiet product panel on the right (hidden on phones).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col lg:flex-row">
      <div className="flex flex-1 flex-col px-5 py-6 sm:px-10 lg:px-14">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">{children}</div>
        <p className="text-xs text-muted">Made for Indian gaming lounges and pool halls · UPI · GST on or off</p>
      </div>

      <aside
        aria-hidden
        className="m-4 hidden flex-1 flex-col justify-between overflow-hidden rounded-3xl bg-[#16181d] p-12 text-[#ededf0] lg:flex dark:bg-[#111217] dark:ring-1 dark:ring-line"
      >
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-[#d4d7de]">
            <span className="size-1.5 rounded-full bg-[#4ade80]" /> Live floor
          </p>
          <h2 className="mt-5 max-w-md text-[34px] font-semibold leading-[1.12] tracking-tight">
            Every station, every minute, one screen.
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#a1a6b3]">
            Time every PC, console and table, bill to the minute, and hear the moment time runs out.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ["PC-01", "1:12:40", "#38bdf8", "#7dd3fc", "₹75"],
              ["PC-02", "03:51", "#f59e0b", "#fbbf24", "Ending soon"],
              ["POOL-2", "Free", "#4ade80", "#4ade80", "Tap to start"],
            ] as const
          ).map(([name, clock, edge, ink, note]) => (
            <div key={name} className="rounded-2xl bg-[#23262e] p-3" style={{ borderTop: `3px solid ${edge}` }}>
              <span className="text-[13px] font-semibold">{name}</span>
              <span className="num mt-4 block text-xl font-semibold" style={{ color: ink }}>
                {clock}
              </span>
              <span className="text-[11px] text-[#a1a6b3]">{note}</span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}
