"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Search, UserCheck, UserPlus, X } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { Field, Input, cx } from "@/components/ui";

export type PlayerValue = { phone: string; name: string; isNew: boolean; ready: boolean };

type Match = { id: string; name: string; phone: string; visits: number };

const formatPhone = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;

// Find a player by name or mobile, or add a new one (mobile + name, asked only once).
export function PlayerField({
  orgId,
  supabase,
  onChange,
}: {
  orgId: string;
  supabase: SupabaseClient<Database>;
  onChange: (value: PlayerValue) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; matches: Match[] } | null>(null);
  const [picked, setPicked] = useState<Match | null>(null);
  const [newName, setNewName] = useState("");
  const [active, setActive] = useState(0);

  const q = query.trim();
  const digits = q.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const isPhone = /^[\d+\s-]+$/.test(q);
  const fullMobile = isPhone && /^[6-9]\d{9}$/.test(digits);
  const searchable = !picked && (isPhone ? digits.length >= 3 : q.length >= 2);
  const loading = searchable && results?.q !== q;
  const matches = searchable && results?.q === q ? results.matches : [];
  const exact = fullMobile ? matches.find((m) => m.phone === digits) : undefined;
  const offerNew = fullMobile && !loading && !exact;

  // Debounced search across the venue's players (name or any part of the mobile).
  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const { data } = await supabase.rpc("list_customers", { p_org_id: orgId, p_search: q, p_limit: 6 });
      if (!cancelled) {
        setResults({
          q,
          matches: (data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, visits: Number(c.visits) })),
        });
        setActive(0);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [q, searchable, orgId, supabase]);

  const chosen = picked ?? exact ?? null;
  useEffect(() => {
    if (chosen) onChange({ phone: chosen.phone, name: chosen.name, isNew: false, ready: true });
    else if (offerNew) onChange({ phone: digits, name: newName.trim(), isNew: true, ready: newName.trim().length >= 2 });
    else onChange({ phone: "", name: "", isNew: false, ready: false });
  }, [chosen?.id, offerNew, digits, newName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (chosen) {
    return (
      <Field label="Player">
        <div className="flex items-center gap-2.5 rounded-lg border border-free/40 bg-free/8 px-3 py-2">
          <UserCheck className="size-4 shrink-0 text-free" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{chosen.name}</span>
            <span className="num block text-xs text-muted">
              {formatPhone(chosen.phone)} · {chosen.visits} {chosen.visits === 1 ? "visit" : "visits"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setQuery("");
            }}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
            aria-label="Change player"
          >
            <X className="size-4" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Player" hint={!q ? "Search by name or mobile. New players: type their 10-digit mobile." : undefined}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (!matches.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                setPicked(matches[active]);
              }
            }}
            placeholder="Name or mobile number"
            autoComplete="off"
            className="pl-9 pr-9 text-base"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls="player-suggestions"
            autoFocus
          />
          {loading && <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted" />}
        </div>
      </Field>

      {matches.length > 0 && (
        <ul id="player-suggestions" role="listbox" className="overflow-hidden rounded-lg border border-line bg-panel shadow-card">
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => setPicked(m)}
                className={cx(
                  "flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left text-sm last:border-0",
                  i === active ? "bg-hover" : "hover:bg-hover",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="num block text-xs text-muted">{formatPhone(m.phone)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {m.visits} {m.visits === 1 ? "visit" : "visits"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searchable && !loading && matches.length === 0 && !offerNew && (
        <p className="text-xs text-muted">
          No player found.{" "}
          {isPhone ? "Finish the 10-digit mobile to add them." : "Type their mobile number to add a new player."}
        </p>
      )}

      {offerNew && (
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              <UserPlus className="size-3.5" /> New player · <span className="num">{formatPhone(digits)}</span>
            </span>
          }
          hint="Asked only once. Next time, search their name or number."
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Their name" maxLength={80} />
        </Field>
      )}
    </div>
  );
}
