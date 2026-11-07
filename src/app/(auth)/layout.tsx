import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // Plain page, one form: no decoration behind it.
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:py-14">
      <div className="flex w-full max-w-sm items-center justify-between">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="mt-10 w-full max-w-sm rounded-xl border border-line bg-panel p-6 sm:p-7">{children}</div>
      <p className="mt-6 text-xs text-muted">For PC, PS5, Xbox, snooker and 8-ball pool venues.</p>
    </main>
  );
}
