"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/styles";
import { SITE } from "@/lib/site";
import { GameClip } from "./game-clip";
import { EYEBROW, Glow, H2, WRAP } from "./site-chrome";

// "How it works", told by scrolling. The section stays pinned while the page scrolls through it:
// the steps on the left light up one at a time (each with a bar that fills as you go), and PC-04
// on the right follows along: running, five minutes left, locked, billed. Tablet and up; phones
// get a plain list instead (see page.tsx) so the page stays short.

export type SessionStep = { time: string; title: string; body: string; dot: string; text: string };

const STATUS = [
  { label: "Running", dot: "bg-busy", text: "text-busy" },
  { label: "5 min left", dot: "bg-ending", text: "text-ending" },
  { label: "Time's up", dot: "bg-over", text: "text-over" },
  { label: "Paid", dot: "bg-free", text: "text-free" },
];

const EASE = "duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

const pad = (n: number) => String(n).padStart(2, "0");
function hms(seconds: number) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function SessionStory({ steps, note }: { steps: SessionStep[]; note: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [t, setT] = useState(0);

  // Scroll position → current step, plus --p (0…steps) for the progress bars without re-rendering.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      const p = run > 0 ? Math.min(1, Math.max(0, -r.top / run)) : 0;
      el.style.setProperty("--p", String(p * steps.length));
      setStep(Math.min(steps.length - 1, Math.floor(p * steps.length)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
    };
  }, [steps.length]);

  // The clock on the PC ticks while it runs.
  useEffect(() => {
    const id = window.setInterval(() => setT((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Tapping a step scrolls to it.
  function goTo(i: number) {
    const el = wrap.current;
    if (!el) return;
    const run = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY + ((i + 0.35) / steps.length) * run;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }

  const status = STATUS[step];
  const clock = step === 0 ? hms(7199 - (t % 60)) : step === 1 ? hms(299 - (t % 60)) : "00:00";

  return (
    <div ref={wrap} className="relative h-[300svh]" style={{ "--p": 0 } as React.CSSProperties}>
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <div
          className={`${WRAP} grid items-center gap-x-12 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-x-16`}
        >
          <div>
            <p className={EYEBROW}>02 · Every session</p>
            <h2 className={H2}>How it works</h2>
            <p className="mt-4 text-[15px] text-muted">{note}</p>

            <ol className="mt-8 border-t-2 border-fg">
              {steps.map((s, i) => {
                const on = i === step;
                return (
                  <li key={s.time} className="relative border-b border-line">
                    {/* Fills while this step is on screen */}
                    <span aria-hidden className="absolute top-0 bottom-0 left-0 w-0.5 bg-line" />
                    <span
                      aria-hidden
                      className={cx("absolute top-0 bottom-0 left-0 w-0.5 origin-top", s.dot)}
                      style={{ transform: `scaleY(clamp(0, calc(var(--p) - ${i}), 1))` }}
                    />
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={on ? "step" : undefined}
                      className={cx(
                        "block w-full py-3.5 pl-5 text-left transition-opacity",
                        EASE,
                        on ? "opacity-100" : "opacity-45 hover:opacity-75",
                      )}
                    >
                      <span className={cx("font-plexmono text-[13px] font-semibold", s.text)}>{s.time}</span>
                      <b className="ml-3 text-[17px] font-semibold">{s.title}</b>
                      <span
                        className={cx(
                          "grid transition-[grid-template-rows]",
                          EASE,
                          on ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                        )}
                      >
                        <span className="overflow-hidden">
                          <span className="block pt-1.5 text-[15px] text-muted">{s.body}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* PC-04, following the steps */}
          <div className="relative" role="img" aria-label={`PC-04: ${steps[step].title}`}>
            <Glow className="top-1/2 left-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2" />
            <div
              aria-hidden
              className="relative flex h-[min(68svh,540px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel"
            >
              <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-4">
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="ml-3 text-xs text-muted">PC-04 · Standard</span>
                <span
                  className={cx(
                    "ml-auto flex items-center gap-1.5 text-xs font-medium transition-colors",
                    EASE,
                    status.text,
                  )}
                >
                  <span className={cx("size-1.5 rounded-full transition-colors", EASE, status.dot)} />
                  {status.label}
                </span>
              </div>

              <div className="relative flex-1 overflow-hidden bg-[#0b0c0e]">
                {/* While it runs: a shooter on a practice range on PC-04 (or your own clip, see SITE.pcClip). It freezes
                    the moment the PC locks. */}
                <div className="absolute inset-0">
                  <GameClip paused={step >= 2} src={SITE.pcClip || undefined} />
                </div>

                {/* The QueSys timer widget, in the corner over the game */}
                <div className="absolute top-4 right-4 rounded-xl border border-white/15 bg-black/45 px-3.5 py-2.5 text-white shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl">
                  <span className="block text-[11px] text-white/60">Time left · Aman</span>
                  <span
                    className={cx(
                      "block font-plexmono text-2xl font-semibold tracking-tight tabular-nums transition-colors",
                      EASE,
                      step === 1 ? "text-[#f59e0b]" : "text-white",
                    )}
                  >
                    {clock}
                  </span>
                </div>

                {/* 5 minutes left: a notice drops in */}
                <div
                  className={cx(
                    "absolute top-4 left-4 flex items-center gap-2.5 rounded-xl border border-white/15 bg-black/45 px-3.5 py-2.5 text-white shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl transition-all",
                    EASE,
                    step === 1 ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0",
                  )}
                >
                  <span className="size-2 animate-pulse rounded-full bg-[#f59e0b]" />
                  <span className="leading-tight">
                    <b className="block text-[13px] font-semibold">5 minutes left</b>
                    <span className="text-xs text-white/60">Save your game · ask the counter for more time</span>
                  </span>
                </div>

                {/* Time's up: the lock screen covers the game */}
                <div
                  className={cx(
                    "absolute inset-0 flex flex-col items-center justify-center bg-[#0b0c0e] text-center text-[#ececef] transition-all",
                    EASE,
                    step >= 2 ? "scale-100 opacity-100" : "scale-[1.04] opacity-0",
                  )}
                >
                  <span
                    className={cx(
                      "flex flex-col items-center transition-all",
                      EASE,
                      step === 3 ? "scale-95 opacity-15 blur-[2px]" : "",
                    )}
                  >
                    <span className="font-plexmono text-[11px] tracking-[0.16em] text-[#f87171]">TIME&apos;S UP</span>
                    <span className="mt-1.5 text-6xl leading-none font-semibold tracking-[-0.03em] lg:text-7xl">
                      PC-04
                    </span>
                    <span className="mt-3 text-sm text-[#8d9099]">Please see the counter to add more time.</span>
                  </span>
                </div>

                {/* Bill: the receipt rises into the middle */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <span
                    className={cx(
                      "block w-full max-w-[290px] rounded-sm bg-white px-5 pt-5 pb-5 font-plexmono text-xs leading-relaxed text-[#111113] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.7)] transition-all",
                      EASE,
                      step === 3 ? "translate-y-0 rotate-0 opacity-100" : "translate-y-1/2 -rotate-2 opacity-0",
                    )}
                  >
                    <span className="block text-center text-base font-semibold tracking-[0.04em]">YOUR VENUE</span>
                    <span className="mt-2 flex justify-between border-t border-dashed border-[#a1a1aa] pt-2">
                      <span>PC-04 · 2 h fixed</span>
                      <span>110.00</span>
                    </span>
                    <span className="flex justify-between">
                      <span>2 × Cold coffee</span>
                      <span>80.00</span>
                    </span>
                    <span className="mt-2 flex justify-between border-t border-[#111113] pt-2 text-[15px] font-semibold">
                      <span>TOTAL</span>
                      <span>₹190.00</span>
                    </span>
                    <span className="flex justify-between text-[#5b5d63]">
                      <span>UPI · on WhatsApp</span>
                      <span className="font-semibold text-[#15803d]">PAID</span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
