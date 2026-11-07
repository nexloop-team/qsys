"use client";

import { useEffect, useRef } from "react";

// Behind the hero: columns of short dashes drifting down like ticks of a clock, brightening in
// slow rings that spread from below the heading. Now and then a dash is lit in a status colour.
// Decorative. Stops when off screen or in a background tab; one still frame for visitors who
// prefer less motion.

type Col = { x: number; speed: number; phase: number; seed: number };

export function HeroField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let cols: Col[] = [];
    let raf = 0;
    let visible = true;
    const start = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gap = w < 640 ? 22 : 28;
      cols = Array.from({ length: Math.ceil(w / gap) + 1 }, (_, i) => ({
        x: Math.round(i * gap + gap / 2),
        speed: 8 + ((i * 37) % 11),
        phase: (i * 53) % 40,
        seed: (i * 7919) % 97,
      }));
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const css = getComputedStyle(document.documentElement);
      const base = css.getPropertyValue("--fg-muted").trim() || "#888";
      const status = ["--busy", "--free", "--ending", "--over"].map((v) => css.getPropertyValue(v).trim());
      ctx.clearRect(0, 0, w, h);
      const dash = 16;
      const period = 40;
      const cx = w / 2;
      const cy = h * 0.62;
      for (const c of cols) {
        const shift = c.phase + t * c.speed;
        const first = (shift % period) - period;
        for (let y = first; y < h; y += period) {
          const n = Math.round((y - shift) / period);
          const d = Math.hypot(c.x - cx, y - cy);
          const ring = 0.5 + 0.5 * Math.cos(d / 42 - t * 1.1);
          const lit = (n + c.seed) % 29 === 0;
          ctx.globalAlpha = lit ? 0.9 : 0.07 + 0.4 * ring ** 3;
          ctx.fillStyle = lit ? status[Math.abs(n + c.seed) % 4] : base;
          ctx.fillRect(c.x, y, 1.5, dash);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      raf = 0;
      draw(now);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const play = () => {
      if (!reduce && visible && !document.hidden && !raf) raf = requestAnimationFrame(loop);
    };

    resize();
    draw(start + 4000);
    play();

    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
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
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_50%_30%_at_50%_50%,rgb(0_0_0/0.2),#000_80%)]"
    />
  );
}
