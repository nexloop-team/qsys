import { Suspense } from "react";
import type { Metadata } from "next";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/card";
import { BillingForm } from "../billing-form";
import { WalletOffersForm } from "../wallet-offers-form";
import { SpendBonusForm } from "../spend-bonus-form";
import { OwnerOnlyNote } from "../owner-only-note";

export const metadata: Metadata = { title: "Billing settings" };

export default function BillingSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Billing />
    </Suspense>
  );
}

async function Billing() {
  const { branch, org, role } = await getAppContext();
  const supabase = await createClient();
  const [{ data: settings }, { data: orgRow }] = await Promise.all([
    supabase.from("branch_settings").select("*").eq("branch_id", branch.id).single(),
    supabase.from("orgs").select("wallet_offers, spend_bonus_pct").eq("id", org.id).single(),
  ]);
  if (!settings) return <p className="text-sm text-danger">Couldn&apos;t load billing settings.</p>;

  const owner = isOwner(role);
  return (
    <>
      {!owner && <OwnerOnlyNote />}
      <BillingForm settings={settings} disabled={!owner} />
      <div className="mt-8">
        <WalletOffersForm offers={(orgRow?.wallet_offers ?? []) as { pay: number; bonus: number }[]} disabled={!owner} />
      </div>
      <div className="mt-8">
        <SpendBonusForm pct={Number(orgRow?.spend_bonus_pct ?? 0)} disabled={!owner} />
      </div>
    </>
  );
}
