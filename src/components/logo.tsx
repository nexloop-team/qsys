import Link from "next/link";

// Wordmark: a station tile with a live-status dot, plus the name.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <span aria-hidden className="relative grid size-5 place-items-center rounded-[5px] border border-fg">
        <span className="size-1.5 rounded-full bg-free" />
      </span>
      QueSys
    </Link>
  );
}
