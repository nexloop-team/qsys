"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Contact, Loader2, Monitor, ReceiptText, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import { cx } from "@/components/styles";

type Result = { key: string; kind: "player" | "station" | "bill"; title: string; detail: string; href: string };

const ICON = { player: Contact, station: Monitor, bill: ReceiptText };
const KIND_LABEL = { player: "Player", station: "Station", bill: "Bill" };

// Top-bar search. Ctrl K / ⌘ K opens it from anywhere in the app.
export function SearchButton({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search players, stations and bills"
        className="flex h-9 w-9 shrink-0 items-center gap-2.5 rounded-lg border border-line bg-subtle px-2.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-fg sm:w-72"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left sm:block">Find a player, station or bill</span>
        <kbd className="num hidden rounded-md border border-line bg-panel px-1.5 py-px text-[11px] sm:block">Ctrl K</kbd>
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-pop outline-none">
            <D.Title className="sr-only">Search</D.Title>
            <D.Description className="sr-only">Search players by name or mobile, stations by name, bills by number.</D.Description>
            {open && <Palette orgId={orgId} branchId={branchId} onPick={() => setOpen(false)} />}
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

function Palette({ orgId, branchId, onPick }: { orgId: string; branchId: string; onPick: () => void }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; results: Result[] } | null>(null);
  const [active, setActive] = useState(0);
  const query = q.trim();
  const loading = query.length >= 2 && found?.q !== query;
  const results = useMemo(() => (query.length >= 2 && found?.q === query ? found.results : []), [found, query]);

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const id = window.setTimeout(async () => {
      // Strip characters that have meaning in PostgREST filters.
      const like = `%${query.replace(/[%_,()*\\]/g, "")}%`;
      const [players, stations, bills] = await Promise.all([
        supabase.rpc("list_customers", { p_org_id: orgId, p_search: query, p_limit: 5 }),
        supabase.from("stations").select("id, name, type").eq("branch_id", branchId).ilike("name", like).limit(5),
        supabase
          .from("invoices")
          .select("id, number, total, customer_name")
          .eq("branch_id", branchId)
          .or(`number.ilike.${like},customer_name.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      if (cancelled) return;
      const next: Result[] = [
        ...(stations.data ?? []).map((s) => ({
          key: `s${s.id}`,
          kind: "station" as const,
          title: s.name,
          detail: "Open on the floor",
          href: `/dashboard?station=${s.id}`,
        })),
        ...(players.data ?? []).map((p) => ({
          key: `p${p.id}`,
          kind: "player" as const,
          title: p.name,
          detail: `${p.phone.slice(0, 5)} ${p.phone.slice(5)} · ${p.visits} visit${Number(p.visits) === 1 ? "" : "s"}`,
          href: `/players/${p.id}`,
        })),
        ...(bills.data ?? []).map((b) => ({
          key: `b${b.id}`,
          kind: "bill" as const,
          title: b.number,
          detail: `${formatINR(b.total)}${b.customer_name ? ` · ${b.customer_name}` : ""}`,
          href: `/bills/${b.id}`,
        })),
      ];
      setFound({ q: query, results: next });
      setActive(0);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, orgId, branchId, supabase]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    onPick();
    router.push(r.href);
  };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        {loading ? <Loader2 className="size-4 animate-spin text-muted" /> : <Search className="size-4 text-muted" />}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[active]);
            }
          }}
          placeholder="Player name or mobile, station, bill number"
          aria-label="Search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
          className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <kbd className="num rounded-md border border-line px-1.5 py-px text-[11px] text-muted">Esc</kbd>
      </div>
      {query.length < 2 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Type at least two letters or digits.</p>
      ) : !loading && results.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{query}”.</p>
      ) : (
        <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.map((r, i) => {
            const Icon = ICON[r.kind];
            return (
              <li key={r.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                    i === active ? "bg-subtle" : "",
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel text-muted">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted">{r.detail}</span>
                  </span>
                  <span className="text-[11px] font-medium text-faint">{KIND_LABEL[r.kind]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// "Operate / Floor" style trail for the top bar.
const TRAIL: [string, string, string][] = [
  ["/dashboard", "Operate", "Floor"],
  ["/bills", "Operate", "Bills"],
  ["/players", "Operate", "Players"],
  ["/stations", "Setup", "Stations"],
  ["/pricing", "Setup", "Pricing"],
  ["/settings", "Setup", "Settings"],
  ["/reports", "Analytics", "Reports"],
  ["/expenses", "Analytics", "Expenses"],
];

export function Breadcrumb() {
  const pathname = usePathname();
  const hit = TRAIL.find(([href]) => pathname === href || pathname.startsWith(`${href}/`));
  if (!hit) return null;
  const deeper = pathname !== hit[0];
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 truncate text-[13px] text-muted md:block">
      {hit[1]} <span className="text-faint">/</span>{" "}
      <span className={deeper ? "" : "font-medium text-fg"}>{hit[2]}</span>
      {deeper && (
        <>
          {" "}
          <span className="text-faint">/</span> <span className="font-medium text-fg">Details</span>
        </>
      )}
    </nav>
  );
}
