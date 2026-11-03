import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass, cx } from "@/components/styles";
import { ThemeToggle } from "@/components/theme";

// Static preview built from the same tile language as the real floor.
const PREVIEW = [
  { name: "PC-01", state: "busy", clock: "1:12:40", note: "Open time", amount: "₹73" },
  { name: "PC-02", state: "ending", clock: "03:51", note: "Left", amount: "₹120" },
  { name: "PC-03", state: "free" },
  { name: "PC-04", state: "over", clock: "+01:20", note: "Overtime", amount: "₹62" },
  { name: "PS5-1", state: "busy", clock: "42:08", note: "2 players", amount: "₹112" },
  { name: "POOL-1", state: "busy", clock: "27:15", note: "Open time", amount: "₹91" },
  { name: "POOL-2", state: "free" },
  { name: "SNOOKER-1", state: "paused", clock: "18:02", note: "Paused", amount: "₹54" },
] as const;

const DOT = { free: "bg-free", busy: "bg-busy", ending: "bg-ending", over: "bg-over", paused: "bg-paused" };
const TEXT = { free: "text-free", busy: "text-busy", ending: "text-ending", over: "text-over", paused: "text-paused" };
const EDGE = {
  free: "border-line",
  busy: "border-busy/45",
  ending: "border-ending/60",
  over: "border-over/70",
  paused: "border-dashed border-line-strong",
};

const STEPS = [
  ["Add your floor", "PCs, PS5s, pool and snooker tables. Twenty at a time if you like."],
  ["Set your prices", "Per hour, happy hours, weekend rates, time packages, extra controllers."],
  ["Run the counter", "Start, pause, extend and bill from one screen, on a laptop or your phone."],
] as const;

export default function Home() {
  return (
    <div className="relative isolate flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-accent/12 blur-3xl"
      />
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/login" className={buttonClass("ghost")}>
            Log in
          </Link>
          <Link href="/signup" className={buttonClass("primary")}>
            Get started
          </Link>
        </div>
      </nav>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-20">
        <section>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-muted shadow-xs">
            <span className="size-1.5 rounded-full bg-free" aria-hidden />
            Gaming lounges · Pool &amp; snooker halls
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            Every station, every minute,{" "}
            <span className="bg-gradient-to-r from-accent-ink to-busy bg-clip-text text-transparent">one screen.</span>
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">
            Stop walking to each PC and writing times on paper. QueSys times every PC, console and table, bills to the
            minute, and tells you the moment time runs out.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              Set up your venue
            </Link>
            <Link href="/login" className={buttonClass("secondary", "lg")}>
              Staff login
            </Link>
          </div>

          <ol className="mt-12 flex flex-col gap-4 border-t border-line pt-8">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="grid grid-cols-[24px_1fr] gap-x-3">
                <span className="num grid size-6 place-items-center rounded-md bg-accent-soft text-xs font-medium text-accent-ink">
                  {i + 1}
                </span>
                <span>
                  <span className="text-sm font-medium">{title}</span>
                  <span className="block text-sm text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-label="Preview of the floor screen"
          className="rounded-2xl border border-line bg-panel p-3 shadow-pop sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
            {(
              [
                ["bg-free", "Free", 2],
                ["bg-busy", "In use", 4],
                ["bg-ending", "Ending", 1],
                ["bg-over", "Overtime", 1],
              ] as const
            ).map(([dot, label, n]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className={cx("size-1.5 rounded-full", dot)} />
                <span className="text-muted">{label}</span>
                <span className="num">{n}</span>
              </span>
            ))}
            <span className="ml-auto text-muted">
              Running <span className="num text-fg">₹512</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PREVIEW.map((t) => (
              <div key={t.name} className={cx("flex min-h-[92px] flex-col rounded-lg border bg-bg p-2.5", EDGE[t.state])}>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <span className={cx("size-1.5 rounded-full", DOT[t.state])} />
                  {t.name}
                </span>
                {t.state === "free" ? (
                  <span className="mt-auto text-xs text-free">Free</span>
                ) : (
                  <div className="mt-auto">
                    <span className={cx("num block text-lg font-semibold leading-none", TEXT[t.state])}>{t.clock}</span>
                    <span className="mt-1 flex justify-between text-[11px] text-muted">
                      <span>{t.note}</span>
                      <span className="num text-fg">{t.amount}</span>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
          <span>QueSys</span>
          <span>Made for Indian venues · UPI · GST on or off</span>
        </div>
      </footer>
    </div>
  );
}
