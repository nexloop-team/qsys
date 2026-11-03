import { Suspense, type ReactNode } from "react";
import { SettingsNav, SettingsNavFallback } from "./settings-nav";

// Settings area: tab list on the left (top on phones), content on the right.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-xl font-semibold tracking-tight">Settings</h1>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <aside className="md:w-44 md:shrink-0">
          <Suspense fallback={<SettingsNavFallback />}>
            <SettingsNav />
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
