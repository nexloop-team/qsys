import { Suspense, type ReactNode } from "react";
import { MobileNav, MobileNavFallback, SidebarNav, SidebarNavFallback } from "./nav-links";
import { AccountMenu, TopbarStatus } from "./account-menu";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/card";

// Static shell (nav) prerenders; anything that reads the session streams in
// behind Suspense, as Cache Components requires.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-panel md:flex print:hidden">
        <div className="flex h-12 items-center px-5">
          <Logo href="/dashboard" />
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav />
          </Suspense>
        </div>
        <div className="border-t border-line p-2.5">
          <Suspense fallback={<Skeleton className="h-10" />}>
            <AccountMenu />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-panel/90 px-4 backdrop-blur md:px-6 print:hidden">
          <span className="md:hidden">
            <Logo href="/dashboard" />
          </span>
          <Suspense fallback={<Skeleton className="ml-auto h-7 w-48" />}>
            <TopbarStatus />
          </Suspense>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        <Suspense fallback={<MobileNavFallback />}>
          <MobileNav />
        </Suspense>
      </nav>
    </div>
  );
}
