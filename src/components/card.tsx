import type { ReactNode } from "react";
import { cx } from "./styles";

// Bordered panel. Header is a hairline-separated bar, not a floating title.
export function Panel({
  title,
  description,
  action,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel shadow-card", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h3>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-subtle", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-xl border border-line bg-subtle text-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

type Tone = "neutral" | "free" | "busy" | "ending" | "over" | "danger" | "ok";

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-subtle text-muted",
  free: "border-free/30 bg-free/8 text-free",
  busy: "border-busy/30 bg-busy/8 text-busy",
  ending: "border-ending/35 bg-ending/8 text-ending",
  over: "border-over/35 bg-over/8 text-over",
  danger: "border-danger/35 bg-danger/8 text-danger",
  ok: "border-ok/30 bg-ok/8 text-ok",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

// Key figure: label over a large tabular number.
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="num text-xl font-semibold tracking-tight">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}
