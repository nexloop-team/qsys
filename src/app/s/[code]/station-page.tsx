"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Check, Clock, Coffee, Hand, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatClock, formatINR } from "@/lib/format";
import { Button, cx } from "@/components/ui";

type Item = { name: string; quantity: number; amount: number };
type MenuItem = { id: string; name: string; price: number; category: string };
type Request = { id: string; kind: "snack" | "extend" | "call"; label: string; status: "pending" | "accepted" | "declined" };
type Session = {
  mode: "open" | "prepaid" | "frames";
  status: "running" | "paused" | "ended";
  started_at: string;
  planned_end_at: string | null;
  paused_at: string | null;
  prepaid_minutes: number;
  frames: number;
  players: number;
  name: string | null;
  active_seconds: number;
  time_total: number;
  items: Item[];
  items_total: number;
  paid: number;
  due: number;
};
type View =
  | { ok: false; error: string }
  | {
      ok: true;
      venue: string;
      branch: string;
      station: { name: string; type: string };
      server_now: string;
      orders: boolean;
      session: Session | null;
      menu: MenuItem[];
      requests: Request[];
    };

const CATEGORY_LABEL: Record<string, string> = {
  beverage: "Drinks",
  snack: "Snacks",
  food: "Food",
  accessory: "Accessories",
  other: "Other",
};

const POLL_MS = 10_000;

export function StationPage({ code }: { code: string }) {
  const [supabase] = useState(createClient);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string>();
  // Local time of the last answer + the server's clock then: timers tick from these.
  const [fetched, setFetched] = useState({ local: 0, offset: 0 });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const sent = Date.now();
    const { data, error } = await supabase.rpc("public_station", { p_code: code });
    if (error) return setLoadError(friendlyError(error, "Couldn't load. Check your internet."));
    const v = data as unknown as View;
    const received = Date.now();
    setLoadError(undefined);
    setView(v);
    if (v.ok) setFetched({ local: received, offset: Date.parse(v.server_now) - (sent + received) / 2 });
  }, [supabase, code]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!view) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        {loadError ?? (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading…
          </>
        )}
      </p>
    );
  }
  if (!view.ok) {
    return (
      <div className="mt-16 rounded-xl border border-line bg-panel p-6 text-center">
        <p className="text-sm">{view.error}</p>
      </div>
    );
  }

  const s = view.session;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{view.venue}</p>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{view.station.name}</h1>
      </header>

      {loadError && (
        <p className="rounded-lg border border-ending/30 bg-ending/8 px-3 py-2 text-xs text-ending">{loadError}</p>
      )}

      {!s ? (
        <div className="rounded-xl border border-line bg-panel p-6 text-center">
          <p className="text-sm font-medium">No session running here</p>
          <p className="mt-1 text-sm text-muted">Ask at the counter to start one. This page updates by itself.</p>
        </div>
      ) : (
        <>
          <Timer session={s} serverNow={now + fetched.offset} sinceFetch={(now - fetched.local) / 1000} />
          <Bill session={s} />
          <Actions code={code} session={s} onSent={load} />
          {view.requests.length > 0 && <Requests requests={view.requests} />}
          {view.orders && view.menu.length > 0 && <Menu code={code} menu={view.menu} onSent={load} />}
        </>
      )}

      <p className="pt-2 text-center text-[11px] text-faint">
        Your final bill is made at the counter. Powered by QueSys.
      </p>
    </div>
  );
}

function Timer({ session: s, serverNow, sinceFetch }: { session: Session; serverNow: number; sinceFetch: number }) {
  const paused = s.status === "paused";
  let clock: string;
  let label: string;
  let tone = "text-fg";
  if (s.mode === "prepaid" && s.planned_end_at) {
    const ref = paused && s.paused_at ? Date.parse(s.paused_at) : serverNow;
    const left = Math.floor((Date.parse(s.planned_end_at) - ref) / 1000);
    clock = formatClock(left);
    label = left <= 0 ? "Time's up" : "Time left";
    tone = left <= 0 ? "text-over" : left <= 300 ? "text-ending" : "text-fg";
  } else {
    clock = formatClock(s.active_seconds + (paused ? 0 : Math.max(0, sinceFetch)));
    label = "Playing for";
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-muted">
          {s.name ? `Hi ${s.name} · ` : ""}
          {paused ? "Paused" : label}
        </span>
        {s.mode === "frames" && <span className="num text-[13px] font-medium">Frame {s.frames}</span>}
      </div>
      <p className={cx("num mt-1 text-[44px] font-semibold leading-none tracking-tight", paused ? "text-paused" : tone)}>
        {clock}
      </p>
    </section>
  );
}

function Bill({ session: s }: { session: Session }) {
  const timeLabel =
    s.mode === "frames"
      ? `${s.frames} ${s.frames === 1 ? "frame" : "frames"}`
      : s.mode === "prepaid"
        ? "Booked time"
        : "Time so far";
  return (
    <section className="rounded-xl border border-line bg-panel">
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 p-4 text-sm">
        <dt className="text-muted">{timeLabel}</dt>
        <dd className="num text-right">{formatINR(s.time_total)}</dd>
        {s.items.map((i, n) => (
          <div key={n} className="contents">
            <dt className="text-muted">
              {i.name}
              {i.quantity > 1 ? ` × ${i.quantity}` : ""}
            </dt>
            <dd className="num text-right">{formatINR(i.amount)}</dd>
          </div>
        ))}
        {s.paid > 0 && (
          <>
            <dt className="text-muted">Paid already</dt>
            <dd className="num text-right">−{formatINR(s.paid)}</dd>
          </>
        )}
        <dt className="mt-1 border-t border-line pt-2 font-medium">Total so far</dt>
        <dd className="num mt-1 border-t border-line pt-2 text-right text-xl font-semibold">{formatINR(s.due)}</dd>
      </dl>
    </section>
  );
}

function useSend(code: string, onSent: () => Promise<void>) {
  const [supabase] = useState(createClient);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const send = (
    kind: "snack" | "extend" | "call",
    ok: string,
    opts: { productId?: string; quantity?: number; onOk?: () => void } = {},
  ) =>
    startTransition(async () => {
      setMessage(null);
      const { error } = await supabase.rpc("public_station_request", {
        p_code: code,
        p_kind: kind,
        p_product_id: opts.productId ?? null,
        p_quantity: opts.quantity ?? 1,
      });
      setMessage(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: ok });
      if (!error) opts.onOk?.();
      await onSent();
    });
  return { pending, message, send };
}

function Actions({ code, session, onSent }: { code: string; session: Session; onSent: () => Promise<void> }) {
  const { pending, message, send } = useSend(code, onSent);
  return (
    <section className="flex flex-col gap-2">
      <div className={cx("grid gap-2", session.mode === "prepaid" ? "grid-cols-2" : "grid-cols-1")}>
        {session.mode === "prepaid" && (
          <Button
            variant="secondary"
            size="lg"
            disabled={pending}
            onClick={() => send("extend", "Asked for 30 more minutes. Staff will confirm.")}
          >
            <Clock /> 30 more min
          </Button>
        )}
        <Button variant="secondary" size="lg" disabled={pending} onClick={() => send("call", "Staff have been called.")}>
          <Hand /> Call staff
        </Button>
      </div>
      {message && <Note {...message} />}
    </section>
  );
}

function Note({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      role="status"
      className={cx(
        "rounded-lg border px-3 py-2 text-sm",
        ok ? "border-ok/30 bg-ok/8 text-ok" : "border-danger/30 bg-danger/5 text-danger",
      )}
    >
      {text}
    </p>
  );
}

const STATUS = {
  pending: { label: "Waiting", icon: Loader2, className: "text-ending", spin: true },
  accepted: { label: "Done", icon: Check, className: "text-ok", spin: false },
  declined: { label: "Closed", icon: X, className: "text-muted", spin: false },
} as const;

function Requests({ requests }: { requests: Request[] }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Your requests</h2>
      <ul className="divide-y divide-line">
        {requests.map((r) => {
          const st = STATUS[r.status];
          const Icon = st.icon;
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className={cx("inline-flex shrink-0 items-center gap-1 text-xs font-medium", st.className)}>
                <Icon className={cx("size-3.5", st.spin && "animate-spin")} /> {st.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Menu({ code, menu, onSent }: { code: string; menu: MenuItem[]; onSent: () => Promise<void> }) {
  const { pending, message, send } = useSend(code, onSent);
  const [picked, setPicked] = useState<{ id: string; qty: number } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const item = menu.find((m) => m.id === picked?.id);
  const categories = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu]);
  // A long menu gets a search box and category tabs, so nobody scrolls through 50 items.
  const long = menu.length > 8;
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, MenuItem[]>();
    for (const m of menu) {
      if (q ? !m.name.toLowerCase().includes(q) : category && m.category !== category) continue;
      map.set(m.category, [...(map.get(m.category) ?? []), m]);
    }
    return [...map.entries()];
  }, [menu, query, category]);

  return (
    <section className="rounded-xl border border-line bg-panel">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold">
        <Coffee className="size-4 text-muted" /> Order snacks &amp; drinks
      </h2>
      {long && (
        <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-panel p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${menu.length} items`}
              aria-label="Search the menu"
              className="h-11 w-full rounded-lg border border-line-strong bg-bg pl-9 pr-3 text-base outline-none focus:border-accent"
            />
          </label>
          {!query && categories.length > 1 && (
            <div className="swipe-row -mx-3 flex gap-1.5 overflow-x-auto px-3">
              {[null, ...categories].map((c) => (
                <button
                  key={c ?? "all"}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={cx(
                    "h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                    category === c ? "border-accent bg-accent text-accent-fg" : "border-line bg-panel text-muted",
                  )}
                >
                  {c ? (CATEGORY_LABEL[c] ?? c) : "All"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {groups.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nothing matches &ldquo;{query}&rdquo;.</p>}
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {CATEGORY_LABEL[cat] ?? cat}
          </p>
          <ul>
            {items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={picked?.id === m.id}
                  onClick={() => setPicked(picked?.id === m.id ? null : { id: m.id, qty: 1 })}
                  className={cx(
                    "flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors",
                    picked?.id === m.id ? "bg-accent-soft" : "hover:bg-hover",
                  )}
                >
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="num shrink-0 font-medium">{formatINR(m.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Pinned to the bottom of the screen while the menu scrolls, so the order button is always in reach. */}
      <div className="sticky bottom-0 rounded-b-xl border-t border-line bg-panel p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {item && picked ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="lg"
              aria-label="One less"
              disabled={picked.qty <= 1}
              onClick={() => setPicked({ ...picked, qty: picked.qty - 1 })}
            >
              <Minus />
            </Button>
            <span className="num w-8 text-center text-lg font-semibold">{picked.qty}</span>
            <Button
              variant="secondary"
              size="lg"
              aria-label="One more"
              disabled={picked.qty >= 10}
              onClick={() => setPicked({ ...picked, qty: picked.qty + 1 })}
            >
              <Plus />
            </Button>
            <Button
              size="lg"
              className="min-w-0 flex-1"
              disabled={pending}
              onClick={() =>
                send("snack", `Ordered ${picked.qty} × ${item.name}. Staff will bring it.`, {
                  productId: item.id,
                  quantity: picked.qty,
                  onOk: () => setPicked(null),
                })
              }
            >
              <span className="truncate">
                Order {picked.qty} × {item.name} · {formatINR(item.price * picked.qty)}
              </span>
            </Button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted">Tap an item to order. Staff bring it and add it to your bill.</p>
        )}
        {message && (
          <div className="mt-2">
            <Note {...message} />
          </div>
        )}
      </div>
    </section>
  );
}
