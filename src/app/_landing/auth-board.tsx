"use client";

import { useEffect, useState } from "react";

// The station board on the log-in / sign-up side panel: a split-flap departures board whose
// times tick. Decorative (aria-hidden rows); the heading next to it says what it shows.

type Kind = "play" | "soon" | "up" | "free";
const ROWS: { station: string; player: string; kind: Kind; secs: number }[] = [
  { station: "PC-01", player: "ROHAN", kind: "play", secs: 4360 },
  { station: "PC-04", player: "AMAN", kind: "soon", secs: 251 },
  { station: "PC-06", player: "KABIR", kind: "up", secs: 138 },
  { station: "POOL 1", player: "ARJUN", kind: "play", secs: 1392 },
  { station: "PS5-2", player: "", kind: "free", secs: 0 },
];

const COLOR: Record<Kind, string> = { play: "#38bdf8", soon: "#f59e0b", up: "#f87171", free: "#22c55e" };
const LABEL: Record<Kind, string> = { play: "PLAYING", soon: "5 MIN", up: "TIME UP", free: "FREE" };

const pad = (n: number) => String(n).padStart(2, "0");
function hms(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// Each character on its own flap, with the split line across the middle.
const FLAP =
  "linear-gradient(to bottom, #1d1d20 0, #1d1d20 calc(50% - 0.5px), #050506 calc(50% - 0.5px), #050506 calc(50% + 0.5px), #161618 calc(50% + 0.5px))";

function Flaps({ text, color }: { text: string; color: string }) {
  return (
    <span className="flex gap-[3px]">
      {text.split("").map((ch, i) => {
        const narrow = ch === ":" || ch === "+";
        return (
          <span
            key={i}
            className="flex h-9 items-center justify-center rounded-[3px] font-plexmono text-[20px] font-semibold"
            style={{ width: narrow ? 11 : 24, background: narrow ? "transparent" : FLAP, color }}
          >
            {ch === " " ? "" : ch}
          </span>
        );
      })}
    </span>
  );
}

export function AuthBoard() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl bg-[#0a0a0b] p-2 shadow-[0_30px_60px_-30px_rgb(17_17_19/0.5)] dark:shadow-none dark:ring-1 dark:ring-[#26272c]">
      <div aria-hidden className="overflow-hidden rounded-md border border-[#1e1e21] bg-[#101012] font-plexmono">
        <div className="border-b border-[#1e1e21] px-5 py-3 text-[11px] font-semibold tracking-[0.16em] text-[#8a8c92]">
          NOW PLAYING · MAIN BRANCH
        </div>
        {ROWS.map((r) => {
          const time =
            r.kind === "free" ? "--:--" : r.kind === "soon" ? hms(r.secs - t) : r.kind === "up" ? `+${hms(r.secs + t)}` : hms(r.secs + t);
          const timeColor = r.kind === "soon" || r.kind === "up" ? COLOR[r.kind] : r.kind === "free" ? "#5c5f68" : "#f2f2f3";
          return (
            <div key={r.station} className="flex items-center gap-4 border-t border-[#19191c] px-5 py-2.5 first-of-type:border-t-0">
              <span className="w-[76px] shrink-0 text-[15px] font-semibold text-[#f2f2f3]">{r.station}</span>
              <span className="min-w-0 flex-1 truncate text-xs tracking-wide text-[#8a8c92]">{r.player || "Walk-in"}</span>
              <Flaps text={time.padStart(7, " ")} color={timeColor} />
              <span
                className="flex w-[78px] shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em]"
                style={{ color: COLOR[r.kind] }}
              >
                <span className="size-2 rounded-[2px]" style={{ background: COLOR[r.kind] }} />
                {LABEL[r.kind]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
