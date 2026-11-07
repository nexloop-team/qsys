"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/styles";

// Features as one open list, no cards: big names on the left, and on wide screens one picture
// on the right that changes with the name you point at (or moves on by itself every few seconds,
// pausing while you're over it). Phones: tap a name to open it, with its picture underneath.
// Colour still only means station status.

type Viz = "timers" | "lock" | "pricing" | "bill" | "pay" | "players" | "snacks" | "reports" | "team" | "branches";

const FEATURES: { k: string; v: string; viz: Viz }[] = [
  {
    k: "Timers",
    v: "Open time that counts up, fixed time that counts down. Pause, move, extend.",
    viz: "timers",
  },
  {
    k: "PC app",
    v: "Locks and unlocks Windows PCs, player login with mobile and PIN, blocked apps, restart and wake from the floor.",
    viz: "lock",
  },
  {
    k: "Pricing",
    v: "Per hour by station type and tier, evening and weekend rates, packages, extra controllers.",
    viz: "pricing",
  },
  {
    k: "Billing",
    v: "Bills to the minute, discounts with reasons, cancel with refund, 80 mm print, WhatsApp.",
    viz: "bill",
  },
  {
    k: "Payments",
    v: "Cash, UPI and player wallets, or split. GST invoices or plain receipts.",
    viz: "pay",
  },
  {
    k: "Players",
    v: "One account per mobile number, visit history, wallets with top-up offers.",
    viz: "players",
  },
  {
    k: "Snacks",
    v: "Menu with stock counts, on the session bill or sold at the counter.",
    viz: "snacks",
  },
  {
    k: "Reports",
    v: "Takings by day and station type, busiest hours, expenses and net profit.",
    viz: "reports",
  },
  {
    k: "Team",
    v: "Owner and staff roles, invite codes, an activity log of every change.",
    viz: "team",
  },
  {
    k: "Branches",
    v: "More than one location, each with its own floor, prices and bills.",
    viz: "branches",
  },
];

const pad = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => {
  const v = Math.max(0, s);
  const h = Math.floor(v / 3600);
  return h ? `${h}:${pad(Math.floor((v % 3600) / 60))}:${pad(v % 60)}` : `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
};

export function FeatureGrid() {
  const [t, setT] = useState(0);
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);

  // The pictures' clocks tick once a second.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setT((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="grid gap-x-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      {/* The list: big names; the open one shows its words (and, on phones, its picture) */}
      <ol className="border-t border-line">
        {FEATURES.map((f, i) => {
          const on = i === active;
          return (
            <li
              key={f.k}
              className="group border-b border-line"
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") setActive(i);
              }}
            >
              <button
                type="button"
                aria-expanded={on}
                onClick={() => setActive(i)}
                className="block w-full pt-3.5 pb-3.5 text-left sm:pt-4 sm:pb-4"
              >
                <span className="flex items-baseline gap-4">
                  <span className="w-7 shrink-0 font-plexmono text-[12px] text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cx(
                      "text-[22px] leading-tight font-semibold tracking-[-0.025em] transition-colors duration-300 sm:text-[30px]",
                      on ? "text-fg" : "text-fg/30 group-hover:text-fg/60",
                    )}
                  >
                    {f.k}
                  </span>
                </span>
              </button>
              <div
                className={cx(
                  "grid pl-11 transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  on ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <p className="pb-4 text-[15px] text-muted sm:text-base">{f.v}</p>
                  <div aria-hidden className="mb-4 h-36 lg:hidden">
                    {on && <Picture viz={f.viz} t={t} />}
                  </div>
                  {/* Wide screens: the list moves on by itself; this fills until the next one */}
                  {on && (
                    <span aria-hidden className="mb-4 block h-px bg-line max-lg:hidden">
                      <span
                        key={active}
                        className="feature-progress block h-px bg-fg"
                        style={{ animationPlayState: hold ? "paused" : "running" }}
                        onAnimationEnd={() => setActive((n) => (n + 1) % FEATURES.length)}
                      />
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Wide screens: one picture, no frame, swapping as the list moves */}
      <div aria-hidden className="relative h-[440px] max-lg:hidden lg:sticky lg:top-28">
        <span className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        {FEATURES.map((f, i) => (
          <div
            key={f.k}
            className={cx(
              "absolute inset-0 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              i === active
                ? "translate-y-0 opacity-100 blur-none"
                : "pointer-events-none translate-y-3 opacity-0 blur-sm",
            )}
          >
            <div className="h-[180px] w-[340px] origin-center scale-[1.45]">
              <Picture viz={f.viz} t={t} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ROW = "flex items-center justify-between rounded-lg border border-line bg-subtle px-3";

function Picture({ viz, t }: { viz: Viz; t: number }) {
  switch (viz) {
    case "timers":
      return (
        <div className="grid h-full grid-cols-2 gap-2.5">
          <Clock name="PC-02" mode="Open time" value={hms(4360 + t)} tone="text-fg" edge="bg-busy" />
          <Clock name="PS5-1" mode="Fixed time" value={hms(299 - (t % 300))} tone="text-ending" edge="bg-ending" />
        </div>
      );
    case "lock": {
      const typed = t % 6;
      return (
        <div className="flex h-full items-center justify-center gap-5 rounded-xl bg-[#0b0c0e] px-4 text-[#ececef]">
          <div className="text-center">
            <span className="block font-plexmono text-[10px] tracking-[0.16em] text-[#8d9099]">LOCKED</span>
            <span className="block text-3xl leading-none font-semibold tracking-[-0.03em]">PC-04</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="block font-plexmono text-[11px] text-[#8d9099]">98765 43210</span>
            <span className="mt-1.5 flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cx(
                    "size-2.5 rounded-full border border-white/40 transition-colors",
                    i < typed && "bg-white",
                  )}
                />
              ))}
            </span>
          </div>
        </div>
      );
    }
    case "pricing":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 text-[13px]">
          {[
            ["Standard PC", "₹60/h", false],
            ["Evening, after 6 pm", "₹80/h", true],
            ["Extra controller", "+₹20/h", false],
          ].map(([a, b, on]) => (
            <div key={String(a)} className={cx(ROW, "h-8", on && "border-line-strong bg-panel")}>
              <span className={on ? "font-medium" : "text-muted"}>{a}</span>
              <span className="font-plexmono font-semibold">{b}</span>
            </div>
          ))}
        </div>
      );
    case "bill":
      return (
        <div className="flex h-full items-end justify-center overflow-hidden">
          <div className="w-[85%] translate-y-2 rounded-t-sm bg-white px-4 pt-3 pb-4 font-plexmono text-[11px] leading-relaxed text-[#111113] shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_10px_30px_-10px_rgb(0_0_0/0.4)] transition-transform duration-500 group-hover:translate-y-0">
            <span className="flex justify-between">
              <span>PC-04 · 2 h 07 m</span>
              <span>127.00</span>
            </span>
            <span className="flex justify-between">
              <span>2 × Cold coffee</span>
              <span>80.00</span>
            </span>
            <span className="flex justify-between text-[#5b5d63]">
              <span>Discount · regular</span>
              <span>−17.00</span>
            </span>
            <span className="mt-1 flex justify-between border-t border-[#111113] pt-1 text-[13px] font-semibold">
              <span>TOTAL</span>
              <span>₹190.00</span>
            </span>
          </div>
        </div>
      );
    case "pay":
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <div className="flex h-3 overflow-hidden rounded-full">
            <span className="w-[40%] bg-fg" />
            <span className="w-[45%] bg-fg/45" />
            <span className="w-[15%] bg-fg/20" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            {[
              ["Cash", "₹76", "bg-fg"],
              ["UPI", "₹86", "bg-fg/45"],
              ["Wallet", "₹28", "bg-fg/20"],
            ].map(([a, b, c]) => (
              <span key={a} className="rounded-lg border border-line bg-subtle px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className={cx("size-2 rounded-full", c)} />
                  {a}
                </span>
                <b className="font-plexmono text-[13px]">{b}</b>
              </span>
            ))}
          </div>
        </div>
      );
    case "players":
      return (
        <div className="flex h-full items-center gap-3 rounded-xl border border-line bg-subtle px-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-sm font-semibold text-bg">
            AK
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px]">Aman K.</b>
            <span className="block font-plexmono text-[12px] text-muted">98••• ••210 · 14 visits</span>
          </span>
          <span className="text-right">
            <span className="block text-[11px] text-muted">Wallet</span>
            <b className="font-plexmono text-[15px]">₹250</b>
          </span>
        </div>
      );
    case "snacks":
      return (
        <div className="flex h-full flex-col justify-center gap-2 text-[13px]">
          {[
            ["Cold coffee", 18, 30],
            ["Chips", 4, 30],
            ["Water", 26, 30],
          ].map(([a, n, max]) => (
            <div key={String(a)} className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-2">
              <span className="text-muted">{a}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <span
                  className="block h-full rounded-full bg-fg/70 transition-[width] duration-700"
                  style={{ width: `${((n as number) / (max as number)) * 100}%` }}
                />
              </span>
              <span className={cx("text-right font-plexmono", (n as number) < 6 && "font-semibold")}>
                {(n as number) < 6 ? `${n} low` : n}
              </span>
            </div>
          ))}
        </div>
      );
    case "reports": {
      const bars = [18, 22, 15, 26, 34, 41, 52, 68, 86, 100, 92, 70];
      return (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-end gap-1">
            {bars.map((b, i) => (
              <span
                key={i}
                className={cx(
                  "flex-1 origin-bottom rounded-t-sm transition-transform duration-500 group-hover:scale-y-105",
                  b === 100 ? "bg-fg" : "bg-fg/20",
                )}
                style={{ height: `${b}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-plexmono text-[10px] text-muted">
            <span>12 pm</span>
            <span>Busiest 9 pm</span>
            <span>11 pm</span>
          </div>
        </div>
      );
    }
    case "team":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 text-[13px]">
          {[
            ["RS", "Riya", "gave 10% off · reason: regular", "20:31"],
            ["VK", "Vikram", "moved PS5-1 to PS5-2", "20:12"],
            ["AM", "Owner", "changed evening rate to ₹80/h", "18:02"],
          ].map(([i, n, what, at]) => (
            <div key={at} className={cx(ROW, "h-8 gap-2")}>
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-fg/15 text-[9px] font-semibold">
                {i}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium">{n}</b> <span className="text-muted">{what}</span>
              </span>
              <span className="font-plexmono text-[11px] text-muted">{at}</span>
            </div>
          ))}
        </div>
      );
    case "branches":
      return (
        <div className="flex h-full items-center gap-2.5">
          {[
            ["Main branch", "12 stations", "3 live"],
            ["Station Road", "8 stations", "5 live"],
          ].map(([a, b, c]) => (
            <div key={a} className="flex-1 rounded-xl border border-line bg-subtle p-3">
              <b className="block text-[15px]">{a}</b>
              <span className="block text-[12px] text-muted">{b}</span>
              <span className="mt-2 flex items-center gap-1.5 text-[12px]">
                <span className="size-1.5 rounded-full bg-busy" />
                {c}
              </span>
            </div>
          ))}
        </div>
      );
  }
}

function Clock({
  name,
  mode,
  value,
  tone,
  edge,
}: {
  name: string;
  mode: string;
  value: string;
  tone: string;
  edge: string;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-line bg-subtle px-3.5 pt-3 pb-3">
      <span className={cx("absolute inset-x-0 top-0 h-[3px]", edge)} />
      <span className="text-[13px] font-semibold">{name}</span>
      <span className="text-[11px] text-muted">{mode}</span>
      <span
        className={cx("mt-auto font-plexmono text-[26px] leading-none font-semibold tracking-tight tabular-nums", tone)}
      >
        {value}
      </span>
    </div>
  );
}
