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

// Save row at the bottom of a settings form.
export function SaveBar({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-3">{children}</div>;
}
