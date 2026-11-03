import Link from "next/link";

// Wordmark: an accent station tile with a live-status dot, plus the name.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <span
        aria-hidden
        className="relative grid size-6 place-items-center rounded-[7px] bg-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(16_24_40/0.2)]"
      >
        <span className="size-2.5 rounded-[3px] border-[1.5px] border-white/90" />
        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-free ring-2 ring-bg" />
      </span>
      QueSys
    </Link>
  );
}
