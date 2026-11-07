import Link from "next/link";

// Pre-login wordmark: the name in condensed capitals. No icon tile, no colour.
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="font-display text-xl font-bold tracking-[0.06em] text-fg">
      QUESYS
    </Link>
  );
}
