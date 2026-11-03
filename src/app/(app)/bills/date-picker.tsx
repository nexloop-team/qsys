"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { nextDay } from "@/lib/format";
import { cx } from "@/components/ui";

// Day picker with previous / next day buttons. Never goes past `max` (today).
export function DatePicker({ value, max }: { value: string; max: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const next = nextDay(value);
  const step = "grid size-9 place-items-center text-muted transition-colors hover:bg-hover hover:text-fg";
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-line-strong bg-panel shadow-xs">
      <Link href={`${pathname}?date=${nextDay(value, -1)}`} className={step} aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </Link>
      {/* Plain input: the shared Input's border and radius would fight the joined group. */}
      <input
        type="date"
        value={value}
        max={max}
        aria-label="Date"
        className="h-9 border-x border-line bg-panel px-2.5 text-sm outline-none focus-visible:bg-accent-soft"
        onChange={(e) => e.target.value && e.target.value <= max && router.push(`${pathname}?date=${e.target.value}`)}
      />
      {next <= max ? (
        <Link href={`${pathname}?date=${next}`} className={step} aria-label="Next day">
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cx(step, "pointer-events-none opacity-35")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}
