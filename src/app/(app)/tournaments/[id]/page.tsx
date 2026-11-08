import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { TournamentView, type Match, type Player } from "./tournament-view";

export const metadata: Metadata = { title: "Tournament" };

export default function TournamentPage(props: PageProps<"/tournaments/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Tournament params={props.params} />
    </Suspense>
  );
}

async function Tournament({ params }: { params: PageProps<"/tournaments/[id]">["params"] }) {
  const { id } = await params;
  const { org, branch, role } = await getAppContext();
  const supabase = await createClient();

  const [{ data: t }, { data: players }, { data: matches }, { data: settings }, { data: stations }] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase
      .from("tournament_players")
      .select("id, customer_id, name, phone, invoice_id, team_name, members, invoices(voided_at)")
      .eq("tournament_id", id)
      .order("created_at"),
    supabase.from("tournament_matches").select("*").eq("tournament_id", id).order("round").order("slot"),
    supabase.from("branch_settings").select("gst_enabled, gst_rate, prices_include_tax").eq("branch_id", branch.id).single(),
    supabase.from("stations").select("id, name, type").eq("branch_id", branch.id).neq("status", "disabled").order("sort_order"),
  ]);
  if (!t) notFound();

  return (
    <>
      <Link href="/tournaments" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Tournaments
      </Link>
      <TournamentView
        orgId={org.id}
        timezone={branch.timezone}
        tournament={t}
        players={(players ?? []).map((p) => ({
          id: p.id,
          customer_id: p.customer_id,
          name: p.name,
          phone: p.phone,
          invoice_id: p.invoice_id,
          team_name: p.team_name,
          members: p.members ?? [],
          paid: Boolean(p.invoice_id) && !(p.invoices as unknown as { voided_at: string | null } | null)?.voided_at,
        })) satisfies Player[]}
        matches={(matches ?? []) as Match[]}
        gst={{
          enabled: settings?.gst_enabled ?? false,
          rate: Number(settings?.gst_rate ?? 18),
          inclusive: settings?.prices_include_tax ?? false,
        }}
        // Matches get a station only when the tournament says what it's played on.
        stations={t.station_type ? (stations ?? []).filter((s) => s.type === t.station_type) : []}
        canDelete={isOwner(role)}
      />
    </>
  );
}
