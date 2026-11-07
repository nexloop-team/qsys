import type { ReactNode } from "react";

// One settings block: title + explanation above a bordered body. Stacks the same on every width,
// so it fits next to the settings tab list.
export function SettingsSection({
  title,
  description,
  action,
  children,
  flush = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? "overflow-hidden rounded-xl border border-line bg-panel shadow-card" : "rounded-xl border border-line bg-panel p-4 shadow-card sm:p-5"}>
        {children}
      </div>
    </section>
  );
}

// Save row at the bottom of a settings form. Sticks to the bottom of the screen on long
// forms so Save is always in reach (above the phone tab bar).
export function SaveBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-20 z-10 -mx-1 flex items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2.5 shadow-pop backdrop-blur md:bottom-4">
      {children}
    </div>
  );
}
