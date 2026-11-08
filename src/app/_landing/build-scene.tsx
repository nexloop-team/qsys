"use client";

import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/styles";

// "Set up in about two minutes", built while you scroll: a small isometric game room.
//   1 · The room drops in and the venue name types itself onto the sign on the back wall.
//   2 · The stations land: two PC desks with chairs, a TV corner with a console and a couch, a
//       pool table under its lamp, the counter. Each shows its name.
//   3 · Price tags pop up.
//   4 · Live: the sign and the lamp light up, screens glow in their status colour, timers appear.
// The dark panel tells the same four steps. Tablet and up: pinned. Phones: plays as it passes.

/** The venue in the story; it types itself onto the sign in step one. */
const VENUE = "GAME ZONE";

const STEPS = [
  { title: "Name your venue.", body: "Your floor appears, empty and ready." },
  { title: "Add your stations.", body: "PCs, consoles, pool and snooker tables, each with its own name." },
  { title: "Set your prices.", body: "Per hour or per frame for each kind of station, with evening and weekend rates." },
  { title: "You're live.", body: "Every station on one board, timed to the minute." },
];

// Isometric projection: x runs down-right, y down-left, z up. One unit is one floor tile.
const C = 0.866;
type Pt = [number, number];
const P = (x: number, y: number, z: number): Pt => [(x - y) * C, (x + y) * 0.5 - z];
const pts = (a: Pt[]) => a.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ");

type Mat = { top: string; left: string; right: string };
const WHITE: Mat = { top: "#ffffff", left: "#eceef1", right: "#dcdfe4" };
const DARK: Mat = { top: "#33363d", left: "#22242a", right: "#1a1c20" };
const SOFA: Mat = { top: "#5b6170", left: "#474c58", right: "#3c404b" };
const WOOD: Mat = { top: "#6b5040", left: "#523d31", right: "#45332a" };
const FELT: Mat = { top: "#2a7a60", left: "#21624d", right: "#1c5442" };
const WALL: Mat = { top: "#f7f6f3", left: "#e9e6e0", right: "#dedad3" };
const PLATE: Mat = { top: "#e2e4e8", left: "#c7cad0", right: "#b4b8bf" };
const POT: Mat = { top: "#c98a64", left: "#b07552", right: "#9b6646" };

// Status colours, the same as the floor (light-theme values: the board is always light).
const S = { free: "#15803d", busy: "#0369a1", ending: "#b45309" };
const INK = "#1d1f24";
const OFF = "#2b2e35"; // a screen that's off
const WARM = "#ffe7b0"; // lamp and sign light

const LINE = {
  stroke: INK,
  strokeWidth: 1.25,
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
} as const;

function Box({
  x,
  y,
  z,
  w,
  d,
  h,
  m,
  screen,
  face = "left",
}: {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  m: Mat;
  /** Fill of a screen inset on the face that looks at you. */
  screen?: string;
  /** Which face carries the screen: "left" faces down-left (the y side), "right" down-right. */
  face?: "left" | "right";
}) {
  const top = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const right = [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)];
  const left = [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const mz = h * 0.12;
  const glass =
    face === "left"
      ? [
          P(x + w * 0.07, y + d, z + mz),
          P(x + w * 0.93, y + d, z + mz),
          P(x + w * 0.93, y + d, z + h - mz),
          P(x + w * 0.07, y + d, z + h - mz),
        ]
      : [
          P(x + w, y + d * 0.07, z + mz),
          P(x + w, y + d * 0.93, z + mz),
          P(x + w, y + d * 0.93, z + h - mz),
          P(x + w, y + d * 0.07, z + h - mz),
        ];
  return (
    <g>
      <polygon points={pts(left)} fill={m.left} {...LINE} />
      <polygon points={pts(right)} fill={m.right} {...LINE} />
      <polygon points={pts(top)} fill={m.top} {...LINE} />
      {screen && <polygon points={pts(glass)} fill={screen} {...LINE} style={{ transition: "fill .5s" }} />}
    </g>
  );
}

// Motion: scrolling only picks the step; each change animates in the browser (CSS transitions),
// so it stays smooth however fast or slow you scroll.
const SPRING = "cubic-bezier(.34,1.45,.64,1)";
const fade = (ms: number, delay = 0) => `opacity ${ms}ms ease ${delay}ms`;

/** A screen's soft glow when it's live. */
function Glow({
  at,
  w,
  h,
  color,
  on,
  filter,
}: {
  at: Pt;
  w: number;
  h: number;
  color: string;
  on: boolean;
  filter: string;
}) {
  return (
    <ellipse
      cx={at[0]}
      cy={at[1]}
      rx={w}
      ry={h}
      fill={color}
      filter={`url(#${filter})`}
      style={{ opacity: on ? 0.35 : 0, transition: fade(700, 200) }}
    />
  );
}

/** A label floating over a spot: a name, a price tag or a live timer. */
function Chip({
  at,
  show,
  dot,
  text,
  delay = 0,
}: {
  at: Pt;
  show: boolean;
  dot?: string;
  text: string;
  delay?: number;
}) {
  const w = 0.25 * text.length + (dot ? 0.85 : 0.6);
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <g
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0px)" : "translateY(0.5px)",
          transition: `transform 500ms ${SPRING} ${show ? delay : 0}ms, ${fade(300, show ? delay : 0)}`,
        }}
      >
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={0.7}
          stroke={INK}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="2 2"
        />
        <rect x={-w / 2} y={-0.7} width={w} height={0.7} rx={0.35} fill="#ffffff" {...LINE} />
        {dot && <circle cx={-w / 2 + 0.38} cy={-0.35} r={0.12} fill={dot} />}
        <text
          x={dot ? 0.2 : 0}
          y={-0.23}
          textAnchor="middle"
          fontSize={0.36}
          fontWeight={600}
          fill={INK}
          style={{ fontFamily: "var(--font-plexmono), monospace" }}
        >
          {text}
        </text>
      </g>
    </g>
  );
}

/** Drops in from above and lands with a small bounce; lifts away again when scrolled back. */
function Drop({ show, delay = 0, children }: { show: boolean; delay?: number; children: React.ReactNode }) {
  return (
    <g
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0px)" : "translateY(-3px)",
        transition: `transform 800ms ${SPRING} ${show ? delay : 0}ms, ${fade(350, show ? delay : 0)}`,
      }}
    >
      {children}
    </g>
  );
}

// The room: 12 × 10 tiles, walls along the back (y = 0) and the left (x = 0).
const RW = 12;
const RD = 10;
const WALL_H = 5;
const T = 0.3; // wall thickness

export function BuildScene() {
  const uid = useId().replace(/:/g, "");
  const blur = `blur-${uid}`;
  const cone = `cone-${uid}`;
  const wrap = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // -1 before the section arrives, then the step 0–3
  const [stage, setStage] = useState(-1);
  const [typedN, setTypedN] = useState(0);

  // Phones: steps move on by themselves while the scene is on screen (a tap moves on too).
  const [phone, setPhone] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 768px)");
    let raf = 0;
    const fill = (cur: number, within: number) =>
      bars.current.forEach((b, i) => {
        if (b) b.style.width = i < cur ? "100%" : i === cur ? `${Math.max(within, 0.08) * 100}%` : "0%";
      });
    const update = () => {
      raf = 0;
      setPhone(!wide.matches);
      // Phones don't follow the scroll: scroll-linked steps skip on a fast flick and jump when the
      // address bar resizes the screen.
      if (!wide.matches) return;
      let p = 1;
      if (!reduce.matches) {
        const r = el.getBoundingClientRect();
        const run = r.height - window.innerHeight;
        p = run > 0 ? -r.top / run : 1;
      }
      p = Math.max(-0.5, Math.min(1, p));
      const s = p < -0.3 ? -1 : Math.max(0, Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
      setStage(s);
      // The progress bars fill with the scroll itself (no re-render needed).
      const cur = Math.max(s, 0);
      fill(cur, Math.min(1, Math.max(0, p * STEPS.length - cur)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const io = new IntersectionObserver(([e]) => setInView(e.intersectionRatio >= 0.4), { threshold: [0, 0.4] });
    io.observe(el);
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
    };
  }, []);

  // Phones: on screen, show the first step and move on every few seconds, pausing on "You're live".
  useEffect(() => {
    if (!phone || !inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => setStage(STEPS.length - 1), 0);
      return () => window.clearTimeout(id);
    }
    const tick = () => setStage((s) => (s < 0 ? 0 : s >= STEPS.length - 1 ? 0 : s + 1));
    const first = window.setTimeout(() => setStage((s) => (s < 0 ? 0 : s)), 0);
    const id = window.setInterval(tick, 2600);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [phone, inView]);

  // Phones: the bars show which step is up (they don't fill with the scroll there).
  useEffect(() => {
    if (!phone) return;
    const cur = Math.max(stage, 0);
    bars.current.forEach((b, i) => {
      if (b) b.style.width = i <= cur ? "100%" : "0%";
    });
  }, [phone, stage]);

  // The venue name types itself onto the sign once the room is in.
  const entered = stage >= 0;
  useEffect(() => {
    if (!entered) return;
    const id = window.setInterval(() => {
      setTypedN((n) => {
        if (n >= VENUE.length) window.clearInterval(id);
        return Math.min(VENUE.length, n + 1);
      });
    }, 110);
    return () => window.clearInterval(id);
  }, [entered]);

  const step = Math.max(stage, 0);
  const stations = stage >= 1;
  const names = stage === 1;
  const tags = stage === 2;
  const on = stage >= 3;
  const typing = entered && typedN < VENUE.length;

  // Where the labels sit
  const AT = {
    pc1: P(2.5, 0.9, 3.5),
    pc2: P(6.2, 0.9, 3.5),
    tv: P(0.4, 6, 4.6),
    pool: P(9.3, 4.9, 5.1),
    counter: P(9.2, 8.6, 3.2),
  };

  // Floor tiles, in two tones
  const tiles: React.ReactNode[] = [];
  for (let i = 0; i < RW; i++)
    for (let j = 0; j < RD; j++)
      if ((i + j) % 2 === 0)
        tiles.push(
          <polygon
            key={`${i}-${j}`}
            points={pts([P(i, j, 0.5), P(i + 1, j, 0.5), P(i + 1, j + 1, 0.5), P(i, j + 1, 0.5)])}
            fill="#d6d9de"
          />,
        );

  return (
    <div ref={wrap} className="relative md:h-[320svh]">
      <div className="md:sticky md:top-0 md:flex md:h-svh md:items-center">
        <div className="mx-auto grid w-full max-w-[1240px] gap-3 px-4 sm:px-8 md:grid-cols-2 md:gap-0">
          {/* The story panel (right on wide screens) */}
          <div
            onClick={() => phone && setStage((st) => (st >= STEPS.length - 1 ? 0 : st + 1))}
            className="relative flex min-h-[240px] flex-col items-center justify-between overflow-hidden rounded-2xl bg-[#0b0c0e] p-6 text-center text-white ring-1 ring-white/10 ring-inset max-md:cursor-pointer md:h-[min(76svh,640px)] md:rounded-l-none md:p-10"
          >
            <Corners />
            <p className="font-plexmono text-[13px] tracking-wide text-white/60">05 · Set up in about two minutes</p>
            <div className="relative my-6 grid w-full place-items-center">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  aria-hidden={i !== step}
                  className={cx(
                    "col-start-1 row-start-1 max-w-[500px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    i === step
                      ? "translate-y-0 opacity-100 blur-none"
                      : i < step
                        ? "-translate-y-4 opacity-0 blur-sm"
                        : "translate-y-4 opacity-0 blur-sm",
                  )}
                >
                  <p className="text-[34px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-[48px] lg:text-[58px]">
                    {s.title}
                  </p>
                  <p className="mt-4 text-base text-white/65 sm:text-lg">{s.body}</p>
                </div>
              ))}
            </div>
            {/* Progress: the current step is a bar that fills */}
            <div aria-hidden className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-2.5">
              {STEPS.map((s, i) => (
                <span
                  key={s.title}
                  onClick={(e) => {
                    if (!phone) return;
                    e.stopPropagation();
                    setStage(i);
                  }}
                  className={cx(
                    "relative h-1 overflow-hidden rounded-full bg-white/35 transition-all duration-300 max-md:h-1.5",
                    i === step ? "w-12" : "w-1 max-md:w-3",
                  )}
                >
                  <span
                    ref={(node) => {
                      bars.current[i] = node;
                    }}
                    className="absolute inset-y-0 left-0 w-0 rounded-full bg-white"
                  />
                </span>
              ))}
            </div>
          </div>

          {/* The room, building itself (left on wide screens) */}
          <div
            role="img"
            aria-label={`An isometric game room: ${STEPS[step].title}`}
            className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-2xl border border-line-strong bg-[#f3f4f6] bg-[radial-gradient(#d3d6db_1.2px,transparent_1.2px)] bg-[size:28px_28px] md:order-first md:aspect-auto md:h-[min(76svh,640px)] md:rounded-r-none md:border-r-0"
          >
            <svg
              aria-hidden
              viewBox="-9.6 -6.4 20.6 18.2"
              shapeRendering="geometricPrecision"
              className="iso-scene h-auto max-h-[94%] w-[94%]"
            >
              <defs>
                <filter id={blur} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="0.35" />
                </filter>
                <linearGradient id={cone} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={WARM} stopOpacity="0.85" />
                  <stop offset="1" stopColor={WARM} stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* 1 · The room: floor, walls, the sign, posters */}
              <Drop show={entered}>
                <Box x={0} y={0} z={0} w={RW} d={RD} h={0.5} m={PLATE} />
                {tiles}
                <Box x={0} y={-T} z={0.5} w={RW} d={T} h={WALL_H} m={WALL} />
                <Box x={-T} y={-T} z={0.5} w={T} d={RD + T} h={WALL_H} m={WALL} />
                {/* Sign on the back wall: dark letters, lit when the venue goes live */}
                <polygon
                  points={pts([P(1.6, 0, 3.6), P(7.4, 0, 3.6), P(7.4, 0, 4.9), P(1.6, 0, 4.9)])}
                  fill={on ? "#202228" : "#2a2c32"}
                  {...LINE}
                />
                <text
                  transform={`matrix(${C} 0.5 0 1 ${P(4.5, 0, 4.03)[0]} ${P(4.5, 0, 4.03)[1]})`}
                  textAnchor="middle"
                  fontSize={0.78}
                  fontWeight={700}
                  letterSpacing={0.1}
                  fill={on ? WARM : "#8d9099"}
                  style={{ fontFamily: "var(--font-display), sans-serif", transition: "fill .5s" }}
                >
                  {VENUE.slice(0, typedN)}
                  {typing && <tspan fill="#c9ccd2">|</tspan>}
                </text>
                {/* Posters on the left wall */}
                {[
                  [0.8, 2.2, "#4b5563"],
                  [2.6, 3.9, "#6b7280"],
                ].map(([y0, y1, c]) => (
                  <polygon
                    key={String(y0)}
                    points={pts([
                      P(0, y0 as number, 2.4),
                      P(0, y1 as number, 2.4),
                      P(0, y1 as number, 4.4),
                      P(0, y0 as number, 4.4),
                    ])}
                    fill={c as string}
                    {...LINE}
                  />
                ))}
              </Drop>

              {/* 2 · PC desks along the back wall, chairs in front */}
              <Drop show={stations}>
                {[1, 4.8].map((x0, k) => (
                  <g key={x0}>
                    <Glow
                      at={P(x0 + 1.4, 0.65, 2.35)}
                      w={1.1}
                      h={0.7}
                      color={k === 0 ? S.busy : S.ending}
                      on={on}
                      filter={blur}
                    />
                    <Box x={x0} y={0.2} z={0.5} w={2.8} d={1.4} h={1.05} m={WHITE} />
                    {/* Monitor on a stand, facing the chair; keyboard in front */}
                    <Box x={x0 + 1.3} y={0.5} z={1.55} w={0.2} d={0.15} h={0.4} m={DARK} />
                    <Box
                      x={x0 + 0.7}
                      y={0.45}
                      z={1.95}
                      w={1.4}
                      d={0.1}
                      h={0.85}
                      m={DARK}
                      screen={on ? (k === 0 ? S.busy : S.ending) : OFF}
                    />
                    <Box x={x0 + 0.8} y={1.0} z={1.55} w={1.2} d={0.35} h={0.06} m={DARK} />
                    <Box x={x0 + 0.9} y={2.2} z={0.5} w={1} d={1} h={0.75} m={DARK} />
                    <Box x={x0 + 0.9} y={3.0} z={1.25} w={1} d={0.22} h={1.25} m={DARK} />
                  </g>
                ))}
              </Drop>

              {/* TV on the left wall, console on a stand, a couch facing it */}
              <Drop show={stations} delay={120}>
                <Glow at={P(0.6, 6, 2.9)} w={1.3} h={1} color={S.busy} on={on} filter={blur} />
                <Box x={0} y={4.4} z={0.5} w={1} d={3.2} h={0.6} m={WHITE} />
                <Box x={0.25} y={6.6} z={1.1} w={0.5} d={0.32} h={0.12} m={WHITE} />
                <Box x={0} y={4.6} z={2.1} w={0.14} d={2.8} h={1.6} m={DARK} screen={on ? S.busy : OFF} face="right" />
                <Box x={3.2} y={4.5} z={0.5} w={1.2} d={3} h={0.75} m={SOFA} />
                <Box x={4.1} y={4.5} z={1.25} w={0.3} d={3} h={0.85} m={SOFA} />
              </Drop>

              {/* Pool table under a lamp hung on a short cord */}
              <Drop show={stations} delay={240}>
                <Box x={7} y={3.4} z={0.5} w={4.6} d={2.8} h={0.95} m={WOOD} />
                <Box x={7.25} y={3.65} z={1.45} w={4.1} d={2.3} h={0.1} m={FELT} />
                {[
                  [8.2, 4.8, "#f4f1ea"],
                  [9.9, 4.4, "#d7362f"],
                  [10.2, 4.9, "#f2c230"],
                  [10.5, 4.5, "#1d1f24"],
                ].map(([bx, by, c]) => {
                  const [sx, sy] = P(bx as number, by as number, 1.68);
                  return <circle key={String(bx)} cx={sx} cy={sy} r={0.14} fill={c as string} {...LINE} />;
                })}
                {/* Light straight down from the lamp: a pool on the felt, then the cone around it */}
                <polygon
                  points={pts([P(7.6, 3.85, 1.56), P(11, 3.85, 1.56), P(11, 5.75, 1.56), P(7.6, 5.75, 1.56)])}
                  fill={WARM}
                  style={{ opacity: on ? 0.35 : 0, transition: fade(700, 150) }}
                  filter={`url(#${blur})`}
                />
                <polygon
                  points={pts([P(10.4, 4.4, 3.75), P(10.4, 4.8, 3.75), P(11, 5.75, 1.56), P(11, 3.85, 1.56)])}
                  fill={`url(#${cone})`}
                  style={{ opacity: on ? 0.5 : 0, transition: fade(700, 150) }}
                />
                <polygon
                  points={pts([P(8.2, 4.8, 3.75), P(10.4, 4.8, 3.75), P(11, 5.75, 1.56), P(7.6, 5.75, 1.56)])}
                  fill={`url(#${cone})`}
                  style={{ opacity: on ? 0.7 : 0, transition: fade(700, 150) }}
                />
                <line
                  x1={P(9.3, 4.6, 3.97)[0]}
                  y1={P(9.3, 4.6, 3.97)[1]}
                  x2={P(9.3, 4.6, 5.3)[0]}
                  y2={P(9.3, 4.6, 5.3)[1]}
                  {...LINE}
                />
                <Box x={8.2} y={4.4} z={3.75} w={2.2} d={0.4} h={0.22} m={on ? { ...DARK, left: WARM } : DARK} />
              </Drop>

              {/* The counter, with QueSys open on a laptop */}
              <Drop show={stations} delay={360}>
                <Glow at={P(9.2, 8.3, 2.2)} w={0.9} h={0.6} color={S.free} on={on} filter={blur} />
                <Box x={7.2} y={8} z={0.5} w={4} d={1.2} h={1.3} m={WHITE} />
                <Box x={8.6} y={8.2} z={1.8} w={1.2} d={0.08} h={0.8} m={DARK} screen={on ? S.free : OFF} />
              </Drop>

              {/* A plant in the corner */}
              <Drop show={stations} delay={480}>
                <Box x={0.5} y={8.6} z={0.5} w={0.8} d={0.8} h={0.7} m={POT} />
                {[
                  [0.9, 9, 1.75, 0.55],
                  [0.7, 8.8, 2.2, 0.42],
                  [1.1, 9.1, 2.35, 0.36],
                ].map(([lx, ly, lz, r]) => {
                  const [cx2, cy2] = P(lx, ly, lz);
                  return <circle key={`${lx}-${lz}`} cx={cx2} cy={cy2} r={r} fill="#3f7d5a" {...LINE} />;
                })}
              </Drop>

              {/* Names, then prices, then live timers */}
              <Chip at={AT.pc1} show={names} delay={700} text="PC-01" />
              <Chip at={AT.pc2} show={names} delay={760} text="PC-02" />
              <Chip at={AT.tv} show={names} delay={820} text="PS5-1" />
              <Chip at={AT.pool} show={names} delay={880} text="Pool 1" />
              <Chip at={AT.counter} show={names} delay={940} text="Counter" />
              <Chip at={AT.pc1} show={tags} delay={0} text="₹60/h" />
              <Chip at={AT.pc2} show={tags} delay={80} text="₹60/h" />
              <Chip at={AT.tv} show={tags} delay={160} text="₹100/h" />
              <Chip at={AT.pool} show={tags} delay={240} text="₹150/h" />
              <Chip at={AT.pc1} show={on} delay={300} dot={S.busy} text="1:12:40" />
              <Chip at={AT.pc2} show={on} delay={380} dot={S.ending} text="04:59" />
              <Chip at={AT.tv} show={on} delay={460} dot={S.busy} text="48:21" />
              <Chip at={AT.pool} show={on} delay={540} dot={S.busy} text="38:10" />
              <Chip at={AT.counter} show={on} delay={620} dot={S.free} text="Live" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The small + marks in the panel's corners. */
function Corners() {
  return (
    <>
      {["top-4 left-4", "top-4 right-4", "bottom-4 left-4", "bottom-4 right-4"].map((pos) => (
        <span key={pos} aria-hidden className={`absolute ${pos} text-lg leading-none font-light text-white/50`}>
          +
        </span>
      ))}
    </>
  );
}
