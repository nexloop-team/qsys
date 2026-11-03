"use client";

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { RotateCw, Wand2 } from "lucide-react";
import type { StationType } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Button, ErrorText, cx } from "@/components/ui";
import type { TileInfo } from "./floor-board";
import type { FloorStation, TileState } from "./types";

// Venue map on a grid of cells. Each station type has a real-world footprint.
export const COLS = 48;
const MIN_ROWS = 26;

const FOOTPRINT: Record<StationType, [number, number]> = {
  pc: [3, 3],
  ps5: [5, 4],
  xbox: [5, 4],
  pool: [9, 5],
  snooker: [12, 6],
  other: [4, 4],
};

export type Placement = { x: number; y: number; rot: 0 | 90 };
type Rect = { x: number; y: number; w: number; h: number };

function size(type: StationType, rot: 0 | 90): [number, number] {
  const [w, h] = FOOTPRINT[type];
  return rot === 90 ? [h, w] : [w, h];
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function rectOf(st: FloorStation, p: Placement): Rect {
  const [w, h] = size(st.type, p.rot);
  return { x: p.x, y: p.y, w, h };
}

// Saved positions, plus a tidy auto-placement (row by row, grouped by type) for the rest.
export function initialPlacements(stations: FloorStation[], arrangeAll = false): Record<string, Placement> {
  const out: Record<string, Placement> = {};
  const taken: Rect[] = [];
  if (!arrangeAll) {
    for (const st of stations) {
      if (st.layout_x != null && st.layout_y != null) {
        const p: Placement = { x: st.layout_x, y: st.layout_y, rot: st.layout_rot === 90 ? 90 : 0 };
        out[st.id] = p;
        taken.push(rectOf(st, p));
      }
    }
  }
  let cursorY = 1;
  let lastType: StationType | null = null;
  for (const st of stations) {
    if (out[st.id]) continue;
    const [w, h] = size(st.type, 0);
    // Start each type on a fresh row band so groups read clearly.
    if (lastType && lastType !== st.type) cursorY = Math.max(cursorY, ...taken.map((r) => r.y + r.h + 1));
    lastType = st.type;
    placing: for (let y = cursorY; y < 400; y++) {
      for (let x = 1; x + w <= COLS - 1; x++) {
        const r = { x, y, w, h };
        // Keep a one-cell aisle around everything.
        const padded = { x: x - 1, y: y - 1, w: w + 2, h: h + 2 };
        if (!taken.some((t) => overlaps(padded, t))) {
          out[st.id] = { x, y, rot: 0 };
          taken.push(r);
          break placing;
        }
      }
    }
  }
  return out;
}

const RING: Record<TileState, string> = {
  free: "ring-free/60",
  busy: "ring-busy",
  ending: "ring-ending",
  over: "ring-over",
  paused: "ring-paused",
  off: "ring-line-strong",
};
const DOT: Record<TileState, string> = {
  free: "bg-free",
  busy: "bg-busy",
  ending: "bg-ending",
  over: "bg-over blink",
  paused: "bg-paused",
  off: "bg-faint",
};
const TEXT: Record<TileState, string> = {
  free: "text-free",
  busy: "text-busy",
  ending: "text-ending",
  over: "text-over",
  paused: "text-paused",
  off: "text-faint",
};

export function FloorMap({
  stations,
  infos,
  placements,
  editing,
  onSelect,
  onMove,
  selectedId,
}: {
  stations: FloorStation[];
  infos: Record<string, TileInfo>;
  placements: Record<string, Placement>;
  editing: boolean;
  onSelect: (id: string) => void;
  onMove?: (id: string, p: Placement) => void;
  selectedId?: string | null;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; start: Placement } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; p: Placement; ok: boolean } | null>(null);

  const rows = Math.max(
    MIN_ROWS,
    ...stations.map((st) => {
      const p = placements[st.id];
      return p ? p.y + size(st.type, p.rot)[1] + 2 : 0;
    }),
  );

  const cellAt = (e: ReactPointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { cx: ((e.clientX - r.left) / r.width) * COLS, cy: ((e.clientY - r.top) / r.width) * COLS };
  };

  const fits = (id: string, p: Placement) => {
    const st = stations.find((s) => s.id === id)!;
    const r = rectOf(st, p);
    if (r.x < 0 || r.y < 0 || r.x + r.w > COLS) return false;
    return !stations.some((o) => o.id !== id && placements[o.id] && overlaps(r, rectOf(o, placements[o.id])));
  };

  const onPointerDown = (e: ReactPointerEvent, st: FloorStation) => {
    if (!editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = placements[st.id];
    const { cx, cy } = cellAt(e);
    drag.current = { id: st.id, dx: cx - p.x, dy: cy - p.y, start: p };
    onSelect(st.id);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { cx, cy } = cellAt(e);
    const p: Placement = { x: Math.round(cx - d.dx), y: Math.max(0, Math.round(cy - d.dy)), rot: d.start.rot };
    setGhost({ id: d.id, p, ok: fits(d.id, p) });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && ghost && ghost.id === d.id && ghost.ok) onMove?.(d.id, ghost.p);
    setGhost(null);
  };

  const pos = (st: FloorStation): CSSProperties => {
    const p = ghost?.id === st.id ? ghost.p : placements[st.id];
    const [w, h] = size(st.type, p.rot);
    return {
      left: `${(p.x / COLS) * 100}%`,
      top: `${(p.y / rows) * 100}%`,
      width: `${(w / COLS) * 100}%`,
      height: `${(h / rows) * 100}%`,
    };
  };

  return (
    <div
      ref={canvasRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cx(
        "relative w-full overflow-hidden rounded-lg border border-line bg-panel [container-type:inline-size]",
        editing && "touch-none",
      )}
      style={{
        aspectRatio: `${COLS} / ${rows}`,
        // Floor tiles: faint dot grid, stronger while editing.
        backgroundImage: `radial-gradient(circle, var(--line-strong) ${editing ? 1.2 : 0.8}px, transparent 1px)`,
        backgroundSize: `${100 / COLS}% ${100 / rows}%`,
      }}
    >
      {stations.map((st) => {
        if (!placements[st.id]) return null;
        const info = infos[st.id];
        const rot = (ghost?.id === st.id ? ghost.p : placements[st.id]).rot;
        const bad = ghost?.id === st.id && !ghost.ok;
        return (
          <button
            key={st.id}
            type="button"
            onClick={() => !editing && onSelect(st.id)}
            onPointerDown={(e) => onPointerDown(e, st)}
            style={{ ...pos(st), fontSize: "clamp(8px, 1.15cqi, 13px)" }}
            className={cx(
              "absolute p-[0.3%] text-left transition-[left,top] duration-75",
              editing ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              selectedId === st.id && editing && "z-10",
            )}
            aria-label={`${st.name}: ${info?.clockLabel ?? ""}`}
          >
            <StationShape
              station={st}
              info={info}
              vertical={rot === 90}
              highlight={selectedId === st.id && editing}
              invalid={bad}
            />
          </button>
        );
      })}
    </div>
  );
}

function Label({ station, info }: { station: FloorStation; info?: TileInfo }) {
  const state = info?.state ?? "free";
  return (
    <span className="pointer-events-none flex min-w-0 flex-col items-center leading-tight">
      <span className="flex max-w-full items-center gap-[0.35em] truncate font-semibold">
        <span className={cx("size-[0.6em] shrink-0 rounded-full", DOT[state])} />
        {station.name}
      </span>
      {info?.clock ? (
        <span className={cx("num text-[1.15em] font-semibold", TEXT[state])}>{info.clock}</span>
      ) : (
        <span className={cx("capitalize", TEXT[state])}>{state === "off" ? station.status : "Free"}</span>
      )}
      {info?.charge && info.charge.total > 0 && <span className="num text-muted">{formatINR(info.charge.total)}</span>}
    </span>
  );
}

// Top-down drawings. The status ring, dot and timer carry state; the shape says what it is.
function StationShape({
  station,
  info,
  vertical,
  highlight,
  invalid,
}: {
  station: FloorStation;
  info?: TileInfo;
  vertical: boolean;
  highlight: boolean;
  invalid: boolean;
}) {
  const state = info?.state ?? "free";
  const ring = cx(
    "ring-2",
    invalid ? "ring-danger" : highlight ? "ring-fg" : RING[state],
    state === "off" && "opacity-55",
  );

  if (station.type === "pool" || station.type === "snooker") {
    // Wooden rail, felt bed, six pockets.
    const pockets = vertical
      ? ["left-0 top-0", "right-0 top-0", "left-0 top-1/2", "right-0 top-1/2", "left-0 bottom-0", "right-0 bottom-0"]
      : ["left-0 top-0", "left-1/2 top-0", "right-0 top-0", "left-0 bottom-0", "left-1/2 bottom-0", "right-0 bottom-0"];
    return (
      <span className={cx("relative block size-full rounded-[0.6em] bg-[#5b3a24] p-[0.55em] dark:bg-[#4a2f1d]", ring)}>
        <span
          className={cx(
            "relative flex size-full items-center justify-center rounded-[0.3em] text-white",
            station.type === "snooker" ? "bg-[#245740] dark:bg-[#1d4433]" : "bg-[#2e6b52] dark:bg-[#24533f]",
          )}
        >
          {pockets.map((p) => (
            <span
              key={p}
              className={cx("absolute size-[0.85em] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80", p)}
              style={{
                transform: `translate(${p.includes("right-0") ? "50%" : "-50%"}, ${p.includes("bottom-0") ? "50%" : "-50%"})`,
              }}
            />
          ))}
          <span className="rounded-[0.3em] bg-black/45 px-[0.5em] py-[0.2em] [&_.text-muted]:text-white/70 [&_.text-free]:text-[#7ee2a8]">
            <Label station={station} info={info} />
          </span>
        </span>
      </span>
    );
  }

  if (station.type === "ps5" || station.type === "xbox") {
    // TV on the wall, couch in front.
    return (
      <span className={cx("flex size-full flex-col rounded-[0.5em] bg-subtle p-[0.35em]", ring, vertical && "flex-row")}>
        <span className={cx("shrink-0 rounded-[0.15em] bg-fg/80", vertical ? "mr-[0.4em] w-[0.45em]" : "mb-[0.4em] h-[0.45em]")} />
        <span className="flex flex-1 items-center justify-center">
          <Label station={station} info={info} />
        </span>
        <span className={cx("shrink-0 rounded-[0.35em] border border-line-strong bg-hover", vertical ? "ml-[0.4em] w-[0.8em]" : "mt-[0.3em] h-[0.8em]")} />
      </span>
    );
  }

  if (station.type === "pc") {
    // Desk with a monitor; chair in front.
    return (
      <span className={cx("flex size-full flex-col rounded-[0.4em] bg-subtle p-[0.3em]", ring)}>
        <span className="mx-auto h-[0.35em] w-3/5 shrink-0 rounded-[0.1em] bg-fg/80" />
        <span className="flex flex-1 items-center justify-center">
          <Label station={station} info={info} />
        </span>
        <span className="mx-auto size-[0.7em] shrink-0 rounded-full border border-line-strong bg-hover" />
      </span>
    );
  }

  return (
    <span className={cx("flex size-full items-center justify-center rounded-[0.5em] bg-subtle", ring)}>
      <Label station={station} info={info} />
    </span>
  );
}

// Editing toolbar + map, saving through the browser client.
export function LayoutEditor({
  stations,
  infos,
  initial,
  onSave,
  onCancel,
}: {
  stations: FloorStation[];
  infos: Record<string, TileInfo>;
  initial: Record<string, Placement>;
  onSave: (placements: Record<string, Placement>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [placements, setPlacements] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rotate = () => {
    if (!selected) return;
    const st = stations.find((s) => s.id === selected)!;
    const cur = placements[selected];
    const next: Placement = { ...cur, rot: cur.rot === 0 ? 90 : 0 };
    const r = rectOf(st, next);
    const clash =
      r.x + r.w > COLS ||
      stations.some((o) => o.id !== selected && placements[o.id] && overlaps(r, rectOf(o, placements[o.id])));
    if (clash) return setError("Not enough room to rotate here. Move it first.");
    setError(null);
    setPlacements({ ...placements, [selected]: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-strong bg-subtle px-3.5 py-2.5 text-sm">
        <span className="font-medium">Editing layout</span>
        <span className="text-muted">Drag stations to match your venue.</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!selected} onClick={rotate}>
            <RotateCw /> Rotate
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPlacements(initialPlacements(stations, true))}>
            <Wand2 /> Auto-arrange
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const err = await onSave(placements);
              setSaving(false);
              if (err) setError(err);
            }}
          >
            {saving ? "Saving…" : "Save layout"}
          </Button>
        </span>
      </div>
      <ErrorText>{error}</ErrorText>
      <FloorMap
        stations={stations}
        infos={infos}
        placements={placements}
        editing
        selectedId={selected}
        onSelect={setSelected}
        onMove={(id, p) => {
          setError(null);
          setPlacements((prev) => ({ ...prev, [id]: p }));
        }}
      />
    </div>
  );
}
