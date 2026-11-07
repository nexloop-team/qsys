"use client";

import { useEffect, useRef } from "react";

// What's on PC-04's screen while the session runs: an original first-person shooter on a
// practice range, drawn live on a canvas. Pop-up targets between crates and concrete walls; the
// player turns to each, fires (recoil, muzzle flash, hit marker) and it drops. It freezes the
// moment the PC locks. Decorative.
//
// To show a clip you recorded instead, put the file in /public and pass its path as `src`.

type V3 = [number, number, number]; // x (right), y (up), z (forward), in metres
type Box = { x: number; z: number; w: number; d: number; h: number; c: [string, string, string] };

const EYE = 1.6;
const NEAR = 0.3;

const CONCRETE: [string, string, string] = ["#cfcac0", "#b9b3a8", "#a7a195"];
const CRATE: [string, string, string] = ["#9a7b55", "#836746", "#6f573b"];
const BLOCK: [string, string, string] = ["#8f98a3", "#7a828c", "#69707a"];

const BOXES: Box[] = [
  { x: -6.5, z: 17, w: 2, d: 2, h: 2, c: CRATE },
  { x: -4.4, z: 17.6, w: 1.3, d: 1.3, h: 1.3, c: CRATE },
  { x: 5, z: 23, w: 2.2, d: 2.2, h: 2.2, c: CRATE },
  { x: 7.3, z: 23.5, w: 1.6, d: 1.6, h: 3.4, c: CONCRETE },
  { x: -9.5, z: 29, w: 3, d: 2, h: 2.6, c: CONCRETE },
  { x: 0.5, z: 38, w: 5, d: 1.2, h: 1.1, c: CONCRETE },
  { x: -3, z: 44, w: 2.4, d: 2.4, h: 2.4, c: CRATE },
  // Buildings past the back wall
  { x: -10, z: 64, w: 7, d: 6, h: 14, c: BLOCK },
  { x: 2, z: 66, w: 9, d: 5, h: 11, c: BLOCK },
  { x: 11, z: 63, w: 5, d: 5, h: 16, c: BLOCK },
];

const TARGETS: { x: number; z: number }[] = [
  { x: -3.2, z: 15 },
  { x: 4, z: 19 },
  { x: -7.5, z: 25 },
  { x: 1.2, z: 30 },
  { x: 6.2, z: 33 },
  { x: -1.5, z: 24 },
  { x: 3.5, z: 42 },
];
const ORDER = [0, 3, 1, 5, 2, 4, 6, 1, 3, 0, 5, 2];

export function GameClip({ paused, src }: { paused: boolean; src?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const ammoRef = useRef<HTMLSpanElement>(null);
  const hitsRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (src) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let f = 0;
    let raf = 0;
    let visible = true;
    let last = performance.now();

    // Game state
    let clock = 0;
    let yaw = 0;
    let step = 0; // index into ORDER
    let phase = 0; // seconds into the current target
    let fired = false;
    let flash = 0;
    let recoil = 0;
    let marker = 0;
    let ammo = 25;
    let hits = 0;
    const up = TARGETS.map(() => 1); // 1 standing, 0 down
    const downAt = TARGETS.map(() => -99);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      f = w * 0.85;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // World → camera space (turned by yaw), then → screen.
    const cam = ([x, y, z]: V3): V3 => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return [x * c - z * s, y - EYE, x * s + z * c];
    };
    const scr = ([x, y, z]: V3): [number, number] => [w / 2 + (x / z) * f, h / 2 - (y / z) * f];

    /** Clips a camera-space polygon to the near plane, so walls running past the camera draw right. */
    const clip = (poly: V3[]) => {
      const out: V3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ain = a[2] > NEAR;
        const bin = b[2] > NEAR;
        if (ain) out.push(a);
        if (ain !== bin) {
          const t = (NEAR - a[2]) / (b[2] - a[2]);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
      }
      return out;
    };
    const face = (world: V3[], color: string) => {
      const pts = clip(world.map(cam));
      if (pts.length < 3) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [sx, sy] = scr(p);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fill();
    };
    const line = (a: V3, b: V3, color: string) => {
      const ca = cam(a);
      const cb = cam(b);
      if (ca[2] <= NEAR && cb[2] <= NEAR) return;
      const cut = (p: V3, q: V3): V3 => {
        const t = (NEAR - p[2]) / (q[2] - p[2]);
        return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, NEAR];
      };
      const p = ca[2] > NEAR ? ca : cut(ca, cb);
      const q = cb[2] > NEAR ? cb : cut(cb, ca);
      const [x1, y1] = scr(p);
      const [x2, y2] = scr(q);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    const drawBox = (b: Box) => {
      const x0 = b.x - b.w / 2;
      const x1 = b.x + b.w / 2;
      const z0 = b.z - b.d / 2;
      const z1 = b.z + b.d / 2;
      const faces: { pts: V3[]; c: string }[] = [
        {
          pts: [
            [x0, b.h, z0],
            [x1, b.h, z0],
            [x1, b.h, z1],
            [x0, b.h, z1],
          ],
          c: b.c[0],
        },
        {
          pts: [
            [x0, 0, z0],
            [x1, 0, z0],
            [x1, b.h, z0],
            [x0, b.h, z0],
          ],
          c: b.c[1],
        },
        {
          pts: [
            [x0, 0, z0],
            [x0, 0, z1],
            [x0, b.h, z1],
            [x0, b.h, z0],
          ],
          c: b.c[2],
        },
        {
          pts: [
            [x1, 0, z0],
            [x1, 0, z1],
            [x1, b.h, z1],
            [x1, b.h, z0],
          ],
          c: b.c[2],
        },
      ];
      // Far faces first, so the near ones cover them.
      faces
        .map((fc) => ({ ...fc, d: fc.pts.reduce((s, p) => s + cam(p)[2], 0) / 4 }))
        .sort((a, b2) => b2.d - a.d)
        .forEach((fc) => face(fc.pts, fc.c));
    };

    const drawTarget = (i: number) => {
      const t = TARGETS[i];
      const stand = up[i];
      const base = cam([t.x, 0, t.z]);
      if (base[2] <= NEAR) return;
      const [bx, by] = scr(base);
      const [, cy] = scr(cam([t.x, 1.25, t.z]));
      const r = (0.42 * f) / base[2];
      // Pole
      ctx.fillStyle = "#3b3d44";
      ctx.fillRect(bx - r * 0.06, cy, r * 0.12, by - cy);
      // The disc tips back as it falls: a flatter ellipse
      const ry = r * Math.max(0.06, stand);
      ["#f4f1ea", "#d7362f", "#f4f1ea", "#d7362f"].forEach((c, k) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(bx, cy - ry, r * (1 - k * 0.24), ry * (1 - k * 0.24), 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(bx, cy - ry, r, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    };

    const weapon = () => {
      const s = w / 900;
      const bob = Math.sin(clock * 2.2) * 3 * s;
      const kick = recoil * 26 * s;
      const ox = w * 0.66 + Math.sin(clock * 1.1) * 4 * s + kick * 0.4;
      const oy = h * 0.74 + bob + kick;
      const poly = (pts: [number, number][], c: string) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)));
        ctx.closePath();
        ctx.fill();
      };
      // A plain, generic rifle seen from behind the right shoulder
      poly(
        [
          [70, 40],
          [190, -10],
          [250, 30],
          [300, 140],
          [140, 220],
          [40, 160],
        ],
        "#2b2e35",
      ); // receiver and stock
      poly(
        [
          [70, 40],
          [-30, 0],
          [-50, 20],
          [40, 80],
        ],
        "#3a3e47",
      ); // handguard
      poly(
        [
          [-30, 0],
          [-120, -30],
          [-125, -18],
          [-50, 20],
        ],
        "#1f2127",
      ); // barrel
      poly(
        [
          [120, 70],
          [160, 60],
          [190, 150],
          [150, 165],
        ],
        "#1c1e23",
      ); // magazine
      poly(
        [
          [100, 0],
          [150, -22],
          [175, -10],
          [125, 12],
        ],
        "#16181c",
      ); // sight
      poly(
        [
          [230, 120],
          [320, 90],
          [360, 200],
          [260, 240],
        ],
        "#c9a27e",
      ); // glove
      if (flash > 0) {
        const mx = ox - 128 * s;
        const my = oy - 28 * s;
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 70 * s);
        g.addColorStop(0, "rgba(255,240,200,0.95)");
        g.addColorStop(0.3, "rgba(255,190,90,0.7)");
        g.addColorStop(1, "rgba(255,160,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, my, 70 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const crosshair = () => {
      const cx = w / 2;
      const cy = h / 2;
      const gap = 5 + recoil * 6;
      const len = 7;
      const arms = () => {
        ctx.beginPath();
        ctx.moveTo(cx - gap - len, cy);
        ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy);
        ctx.lineTo(cx + gap + len, cy);
        ctx.moveTo(cx, cy - gap - len);
        ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap);
        ctx.lineTo(cx, cy + gap + len);
        ctx.stroke();
      };
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      arms();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#7dfcd2";
      arms();
      if (marker > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, marker * 6)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          ctx.moveTo(cx + dx * 6, cy + dy * 6);
          ctx.lineTo(cx + dx * 13, cy + dy * 13);
        }
        ctx.stroke();
      }
    };

    const frame = () => {
      // Sky and ground
      const sky = ctx.createLinearGradient(0, 0, 0, h / 2);
      sky.addColorStop(0, "#8fa9c2");
      sky.addColorStop(1, "#dfe5ea");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h / 2 + 1);
      const ground = ctx.createLinearGradient(0, h / 2, 0, h);
      ground.addColorStop(0, "#c2bbad");
      ground.addColorStop(1, "#a59d8e");
      ctx.fillStyle = ground;
      ctx.fillRect(0, h / 2, w, h / 2);

      // Buildings beyond, range floor lines, back wall, side walls
      BOXES.filter((b) => b.z > 60).forEach(drawBox);
      face(
        [
          [-12, 0, 60],
          [12, 0, 60],
          [12, 6, 60],
          [-12, 6, 60],
        ],
        "#bdb7ab",
      );
      for (let z = 4; z <= 60; z += 4) line([-12, 0, z], [12, 0, z], "rgba(90,80,65,0.25)");
      for (let x = -12; x <= 12; x += 3) line([x, 0, 0.5], [x, 0, 60], "rgba(90,80,65,0.25)");
      face(
        [
          [-12, 0, 0],
          [-12, 0, 60],
          [-12, 6, 60],
          [-12, 6, 0],
        ],
        "#aea89c",
      );
      face(
        [
          [12, 0, 0],
          [12, 0, 60],
          [12, 6, 60],
          [12, 6, 0],
        ],
        "#a39d91",
      );

      // Crates and targets, far to near
      [
        ...BOXES.filter((b) => b.z <= 60).map((b) => ({ d: cam([b.x, 0, b.z])[2], draw: () => drawBox(b) })),
        ...TARGETS.map((t, i) => ({ d: cam([t.x, 0, t.z])[2] - 0.01, draw: () => drawTarget(i) })),
      ]
        .sort((a, b) => b.d - a.d)
        .forEach((t) => t.draw());

      weapon();
      crosshair();
    };

    const tick = (dt: number) => {
      clock += dt;
      phase += dt;
      flash = Math.max(0, flash - dt);
      recoil = Math.max(0, recoil - dt * 5);
      marker = Math.max(0, marker - dt);

      // Fallen targets pop back up after a while.
      TARGETS.forEach((_, k) => {
        if (up[k] < 1 && clock - downAt[k] > 2.6) up[k] = Math.min(1, up[k] + dt * 4);
      });

      const i = ORDER[step % ORDER.length];
      const t = TARGETS[i];
      const aim = Math.atan2(t.x, t.z);
      yaw += (aim - yaw) * (1 - Math.exp(-dt * 6)) + Math.sin(clock * 0.9) * 0.0004;

      if (!fired && phase > 0.85 && Math.abs(aim - yaw) < 0.02 && up[i] > 0.95) {
        fired = true;
        flash = 0.06;
        recoil = 1;
        marker = 0.25;
        ammo = ammo > 1 ? ammo - 1 : 25;
        hits += 1;
        downAt[i] = clock;
        if (ammoRef.current) ammoRef.current.textContent = String(ammo);
        if (hitsRef.current) hitsRef.current.textContent = String(hits);
      }
      if (fired && clock - downAt[i] < 1) up[i] = Math.max(0, up[i] - dt * 5);
      if (fired && phase > 1.35) {
        step += 1;
        phase = 0;
        fired = false;
      }
      if (timeRef.current) {
        const left = Math.max(0, 100 - Math.floor(clock));
        timeRef.current.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      }
    };

    const loop = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) tick(dt);
      frame();
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const play = () => {
      if (reduce || !visible || document.hidden || raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };

    resize();
    yaw = Math.atan2(TARGETS[0].x, TARGETS[0].z);
    frame();
    play();

    const ro = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      play();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", play);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", play);
      cancelAnimationFrame(raf);
    };
  }, [src]);

  if (src) return <VideoClip src={src} paused={paused} />;

  return (
    <div aria-hidden className="absolute inset-0">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {/* HUD */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/45 px-2.5 py-1 text-center font-plexmono text-white">
        <span className="block text-[10px] tracking-[0.18em] text-white/65">RANGE</span>
        <span ref={timeRef} className="block text-sm font-semibold tabular-nums">
          1:40
        </span>
      </div>
      <div className="absolute bottom-3 left-4 font-plexmono text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
        <span className="text-[10px] tracking-wider text-white/70">HP</span> <b className="text-xl">100</b>
        <span className="ml-3 text-[10px] tracking-wider text-white/70">HITS</span>{" "}
        <b ref={hitsRef} className="text-xl tabular-nums">
          0
        </b>
      </div>
      <div className="absolute right-4 bottom-3 font-plexmono text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
        <b ref={ammoRef} className="text-xl tabular-nums">
          25
        </b>
        <span className="text-sm text-white/70"> / 75</span>
      </div>
    </div>
  );
}

/**
 * A recorded clip instead of the drawn game. It only starts downloading when the section comes
 * near the screen, plays muted on a loop while on screen, and stops when the PC locks.
 */
function VideoClip({ src, paused }: { src: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pausedRef = useRef(paused);
  const onScreen = useRef(false);

  const sync = () => {
    const v = ref.current;
    if (!v || !v.getAttribute("src")) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pausedRef.current || !onScreen.current || reduce) v.pause();
    else v.play().catch(() => {});
  };

  useEffect(() => {
    pausedRef.current = paused;
    sync();
  }, [paused]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen.current = e.isIntersecting;
        if (e.isIntersecting && !v.getAttribute("src")) {
          v.setAttribute("src", src);
          v.load();
        }
        sync();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(v);
    v.addEventListener("loadeddata", sync);
    return () => {
      io.disconnect();
      v.removeEventListener("loadeddata", sync);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      aria-hidden
      muted
      loop
      playsInline
      preload="none"
      className="absolute inset-0 h-full w-full bg-black object-cover"
    />
  );
}
