import { Suspense, type ReactNode } from "react";
import { getAppContext } from "@/lib/dal";
import { SettingsNav, SettingsNavFallback } from "./settings-nav";

// Settings area: title, tabs across the top, then the page's sections.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Settings</h1>
        <Suspense fallback={<p className="mt-1 h-5" />}>
          <WhereAmI />
        </Suspense>
      </div>
      <div className="mb-6">
        <Suspense fallback={<SettingsNavFallback />}>
          <SettingsNav />
        </Suspense>
      </div>
      {children}
    </div>
  );
}

// Settings mostly apply to the branch you're in: say which.
async function WhereAmI() {
  const { org, branch } = await getAppContext();
  return (
    <p className="mt-1 text-sm text-muted">
      {org.name} · {branch.name}
    </p>
  );
}
