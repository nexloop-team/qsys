import Link from "next/link";

// Wordmark: an ink station tile with a live-status dot, plus the name.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <span
        aria-hidden
        className="relative grid size-6 place-items-center rounded-[7px] bg-accent shadow-xs"
      >
        <span className="size-2.5 rounded-[3px] border-[1.5px] border-accent-fg" />
        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-free ring-2 ring-bg" />
      </span>
      QueSys
    </Link>
  );
}
