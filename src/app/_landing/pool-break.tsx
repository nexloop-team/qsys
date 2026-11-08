"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/styles";
import { EYEBROW, Glow, H2, LEAD, WRAP } from "./site-chrome";

// A pool break you play by scrolling. The cue draws back and strikes, the rack spreads off the
// cushions, one ball drops into a corner pocket, and the table's own clock goes from Free to
// Running and counts. Scrolling back rewinds it.
// Tablet and up: the scene stays pinned while you scroll through it. Phones: it plays as the
// table passes through the screen, so the page gets no longer. Reduced motion: the finished break.

const W = 1000; // felt, in SVG units
const H = 500;
const R = 13; // ball radius
const RAIL = 40;
const CUE = { x: 250, y: 250 };
const CONTACT = { x: 700 - 2 * R, y: 250 };
const POCKETS = [
  [0, 0],
  [W / 2, -6],
  [W, 0],
  [0, H],
  [W / 2, H + 6],
  [W, H],
] as const;

const SOLID = ["#f2c230", "#2459c4", "#d7362f", "#6b3fa0", "#f07f22", "#1d8a4e", "#8a2b2b"];
// Rack order, apex first (8 in the middle of row three, as racked).
const ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
const POTTED = 10; // index into the rack: the top ball of the back row

type Ball = { n: number; x: number; y: number; ex: number; ey: number; pocket: boolean };

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
/** Keeps a coordinate on the table by bouncing it off the cushions. */
function fold(v: number, lo: number, hi: number) {
  const span = hi - lo;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t <= span ? t : 2 * span - t);
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const RACK: Ball[] = (() => {
  const balls: Ball[] = [];
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const x = 700 + row * (R * 2 * 0.87);
      const y = 250 + (j - row / 2) * (R * 2 + 0.5);
      const pocket = i === POTTED;
      // Spread away from the contact point, a little different for each ball.
      const angle = Math.atan2(y - CONTACT.y, x - CONTACT.x + 6) + (rnd(i, 1) - 0.5) * 1.1;
      const dist = 360 + rnd(i, 2) * 460;
      balls.push({
        n: ORDER[i],
        x,
        y,
        ex: pocket ? W - 6 : x + Math.cos(angle) * dist,
        ey: pocket ? 6 : y + Math.sin(angle) * dist,
        pocket,
      });
      i++;
    }
  }
  return balls;
})();

const pad = (n: number) => String(n).padStart(2, "0");

export function PoolBreak() {
  const uid = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const cueBall = useRef<SVGGElement>(null);
  const stick = useRef<SVGGElement>(null);
  const balls = useRef<(SVGGElement | null)[]>([]);
  const clock = useRef<HTMLSpanElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 768px)");
    let raf = 0;

    const draw = (p: number) => {
      // Cue: draw back, strike, then fade away.
      const pull = p < 0.16 ? easeInOut(seg(p, 0.03, 0.16)) * 70 : (1 - easeOut(seg(p, 0.16, 0.21))) * 70;
      const follow = easeOut(seg(p, 0.21, 0.3)) * 40;
      stick.current?.setAttribute("transform", `translate(${follow - pull} 0)`);
      stick.current?.setAttribute("opacity", String(1 - seg(p, 0.26, 0.36)));

      // Cue ball: rolls into the rack, then drifts back and stops.
      const roll = seg(p, 0.21, 0.27);
      const after = easeOut(seg(p, 0.27, 0.62));
      const cx = p < 0.27 ? CUE.x + (CONTACT.x - CUE.x) * roll : CONTACT.x + (585 - CONTACT.x) * after;
      const cy = p < 0.27 ? CUE.y : CONTACT.y + (318 - CONTACT.y) * after;
      cueBall.current?.setAttribute("transform", `translate(${cx} ${cy})`);

      // The rack spreads; one ball runs into the top right pocket.
      RACK.forEach((b, i) => {
        const g = balls.current[i];
        if (!g) return;
        const t = b.pocket ? easeOut(seg(p, 0.27, 0.56)) : easeOut(seg(p, 0.27, 0.86));
        const x = b.pocket ? b.x + (b.ex - b.x) * t : fold(b.x + (b.ex - b.x) * t, R, W - R);
        const y = b.pocket ? b.y + (b.ey - b.y) * t : fold(b.y + (b.ey - b.y) * t, R, H - R);
        const sink = b.pocket ? seg(p, 0.52, 0.58) : 0;
        g.setAttribute("transform", `translate(${x} ${y}) scale(${1 - sink * 0.45})`);
        g.setAttribute("opacity", String(1 - sink));
      });

      // The table's clock starts with the break.
      const on = p >= 0.21;
      setRunning(on);
      if (clock.current) {
        const secs = on ? Math.round(seg(p, 0.21, 1) * (42 * 60 + 10)) : 0;
        clock.current.textContent = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
      }
    };

    // Wide screens: the break follows the scroll while the table is pinned.
    // Phones: scroll-linked motion skips and jitters (fast flicks, the address bar resizing the
    // screen), so the break plays by itself once the table is well on screen, and again the next
    // time it comes back into view.
    let play = 0;
    let played = false;
    const playBreak = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 3400);
        draw(p);
        play = p < 1 ? requestAnimationFrame(step) : 0;
      };
      cancelAnimationFrame(play);
      play = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (wide.matches || reduce.matches) return;
        if (e.intersectionRatio >= 0.55 && !played) {
          played = true;
          playBreak();
        } else if (!e.isIntersecting && played) {
          played = false;
          cancelAnimationFrame(play);
          draw(0);
        }
      },
      { threshold: [0, 0.55] },
    );
    io.observe(el);

    const update = () => {
      raf = 0;
      if (reduce.matches) return draw(1);
      if (!wide.matches) return;
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      draw(clamp01(run > 0 ? -r.top / run : 1));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    if (!wide.matches && !reduce.matches) draw(0);
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduce.addEventListener("change", schedule);
    wide.addEventListener("change", schedule);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduce.removeEventListener("change", schedule);
      wide.removeEventListener("change", schedule);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(play);
    };
  }, []);

  const clip = `ball-${uid}`;
  const felt = `felt-${uid}`;

  return (
    <div ref={wrap} className="relative md:h-[220svh]">
      <div className="md:sticky md:top-0 md:flex md:h-svh md:items-center md:overflow-hidden">
        <div className={`${WRAP} relative`}>
          <Glow className="top-1/2 left-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2" />
          <div className="mx-auto max-w-[720px] md:text-center">
            <p className={EYEBROW}>03 · Tables too</p>
            <h2 className={H2}>The clock starts with the break.</h2>
            <p className={`${LEAD} mt-3 sm:mt-4`}>
              Open time, fixed time or by the frame on every table. Watch Pool 1: the minute the frame starts, it&apos;s on the bill.
            </p>
          </div>

          <figure
            className="mx-auto mt-6 w-full max-w-[1000px] sm:mt-8 md:w-[min(100%,calc((100svh-17rem)*1.86))]"
            role="img"
            aria-label="A pool table: the break spreads the balls and the table's timer starts running"
          >
            {/* The table's floor tile: status and clock */}
            <div aria-hidden className="mb-2.5 flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={cx("size-2 rounded-full transition-colors duration-300", running ? "bg-busy" : "bg-free")} />
                Pool 1
                <span className={cx("font-medium transition-colors duration-300", running ? "text-busy" : "text-free")}>
                  · {running ? "Running" : "Free"}
                </span>
              </span>
              <span ref={clock} className="font-plexmono text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                00:00
              </span>
            </div>

            <svg
              aria-hidden
              viewBox={`0 0 ${W + RAIL * 2} ${H + RAIL * 2}`}
              className="block h-auto w-full drop-shadow-[0_30px_50px_rgb(0_0_0/0.35)]"
            >
              <defs>
                <clipPath id={clip}>
                  <circle r={R} />
                </clipPath>
                <radialGradient id={felt} cx="50%" cy="45%" r="70%">
                  <stop offset="0%" stopColor="#24604a" />
                  <stop offset="100%" stopColor="#163b2e" />
                </radialGradient>
              </defs>

              {/* Rails, felt, the lamp's light, sights and pockets */}
              <rect width={W + RAIL * 2} height={H + RAIL * 2} rx={30} fill="#1a1715" />
              <rect x={RAIL - 8} y={RAIL - 8} width={W + 16} height={H + 16} rx={10} fill="#123126" />
              <rect x={RAIL} y={RAIL} width={W} height={H} fill={`url(#${felt})`} />
              {[0.125, 0.25, 0.375, 0.625, 0.75, 0.875].map((f) => (
                <g key={f} fill="#c9b99a" opacity={0.7}>
                  <circle cx={RAIL + W * f} cy={RAIL / 2} r={3} />
                  <circle cx={RAIL + W * f} cy={H + RAIL * 1.5} r={3} />
                </g>
              ))}
              {[0.25, 0.5, 0.75].map((f) => (
                <g key={f} fill="#c9b99a" opacity={0.7}>
                  <circle cx={RAIL / 2} cy={RAIL + H * f} r={3} />
                  <circle cx={W + RAIL * 1.5} cy={RAIL + H * f} r={3} />
                </g>
              ))}
              <line x1={RAIL + W * 0.25} y1={RAIL} x2={RAIL + W * 0.25} y2={RAIL + H} stroke="#ffffff" strokeOpacity={0.08} />
              <circle cx={RAIL + 700} cy={RAIL + 250} r={3} fill="#ffffff" fillOpacity={0.15} />
              {POCKETS.map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={RAIL + x} cy={RAIL + y} r={21} fill="#050505" />
              ))}

              <g transform={`translate(${RAIL} ${RAIL})`}>
                {RACK.map((b, i) => (
                  <g
                    key={b.n}
                    ref={(node) => {
                      balls.current[i] = node;
                    }}
                    transform={`translate(${b.x} ${b.y})`}
                  >
                    <BallFace n={b.n} clip={clip} />
                  </g>
                ))}
                <g ref={cueBall} transform={`translate(${CUE.x} ${CUE.y})`}>
                  <circle r={R} fill="#f4f1ea" />
                  <circle cx={-4} cy={-4} r={4} fill="#ffffff" opacity={0.6} />
                </g>
                {/* Cue stick, lined up on the cue ball */}
                <g ref={stick}>
                  <polygon
                    points={`${CUE.x - R - 6},${CUE.y - 3.5} ${CUE.x - R - 6},${CUE.y + 3.5} ${CUE.x - R - 620},${CUE.y + 8} ${CUE.x - R - 620},${CUE.y - 8}`}
                    fill="#c79a5b"
                  />
                  <rect x={CUE.x - R - 14} y={CUE.y - 3.5} width={8} height={7} fill="#e8e4dc" />
                  <rect x={CUE.x - R - 620} y={CUE.y - 8} width={200} height={16} fill="#2a211a" />
                </g>
              </g>
            </svg>
          </figure>
        </div>
      </div>
    </div>
  );
}

/** Solids 1–7, the black 8, stripes 9–15 in the same colours as 1–7. */
function BallFace({ n, clip }: { n: number; clip: string }) {
  if (n === 8) {
    return (
      <>
        <circle r={R} fill="#111111" />
        <circle r={5} fill="#f4f1ea" />
        <circle cx={-4} cy={-5} r={3.5} fill="#ffffff" opacity={0.35} />
      </>
    );
  }
  const stripe = n > 8;
  const color = SOLID[(stripe ? n - 8 : n) - 1];
  return (
    <>
      <circle r={R} fill={stripe ? "#f4f1ea" : color} />
      {stripe && <rect x={-R} y={-R * 0.55} width={R * 2} height={R * 1.1} fill={color} clipPath={`url(#${clip})`} />}
      <circle r={4.5} fill="#f4f1ea" opacity={stripe ? 0 : 0.9} />
      <circle cx={-4} cy={-5} r={3.5} fill="#ffffff" opacity={0.35} />
    </>
  );
}
