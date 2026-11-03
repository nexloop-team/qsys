import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageSkeleton } from "@/components/card";
import { SettingsSection } from "../section";
import { AddBranchForm, SwitchBranchButton } from "./branch-forms";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Branches />
    </Suspense>
  );
}

async function Branches() {
  const { org, branch, branches, role } = await getAppContext();
  const supabase = await createClient();
  const { data: stations } = await supabase
    .from("stations")
    .select("branch_id")
    .in("branch_id", branches.map((b) => b.id));
  const countFor = (id: string) => (stations ?? []).filter((s) => s.branch_id === id).length;

  return (
    <>
      <SettingsSection
        title="Branches"
        description={`Each branch has its own stations, prices, bills and settings. Players and team are shared across ${org.name}.`}
        flush
      >
        <ul className="divide-y divide-line">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{b.name}</span>
                <span className="block text-xs text-muted">
                  {countFor(b.id)} stations · {b.timezone}
                </span>
              </span>
              {b.id === branch.id ? <Badge tone="ok">Current</Badge> : <SwitchBranchButton branchId={b.id} />}
            </li>
          ))}
        </ul>
      </SettingsSection>

      {isOwner(role) && (
        <SettingsSection title="Add a branch" description="Opening a second location? It starts empty: add its stations and prices next.">
          <AddBranchForm />
        </SettingsSection>
      )}
    </>
  );
}
