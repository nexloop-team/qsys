"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/styles";

// One settings row. Sections that sit next to each other join into one card with lines between
// them. Wide screens: title + explanation on the left, the fields on the right; phones: stacked.
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
  /** A table or list: drawn edge to edge in its own box. */
  flush?: boolean;
}) {
  return (
    <section
      className={cx(
        "grid gap-x-10 gap-y-3 border-x border-line bg-panel px-5 py-6 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]",
        "first-of-type:rounded-t-xl first-of-type:border-t last-of-type:mb-6 last-of-type:rounded-b-xl last-of-type:border-b",
        "[&:not(:first-of-type)]:border-t",
      )}
    >
      <div className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cx("min-w-0", flush && "overflow-hidden rounded-lg border border-line")}>{children}</div>
    </section>
  );
}

// Save row for a settings form. By default it stays in view at the bottom of the screen (above
// the phone's bottom bar) and says when there are unsaved changes; `inline` keeps it in place
// inside a section.
export function SaveBar({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const mark = () => setDirty(true);
    const clear = () => setDirty(false);
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    form.addEventListener("submit", clear);
    form.addEventListener("reset", clear);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("submit", clear);
      form.removeEventListener("reset", clear);
    };
  }, []);

  if (inline) {
    return (
      <div ref={ref} className="flex flex-wrap items-center justify-end gap-3">
        {children}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-panel px-4 py-3 md:bottom-0 md:-mx-8 md:px-8"
    >
      {dirty && <span className="mr-auto text-[13px] text-muted md:mr-0">Unsaved changes</span>}
      {children}
    </div>
  );
}
