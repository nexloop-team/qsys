import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/dal";
import { Skeleton } from "@/components/card";
import { Logo } from "@/components/logo";
import { OnboardingChoice } from "./onboarding-form";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10">
      <Logo />
      <div className="mt-10 w-full max-w-md">
        <Suspense fallback={<Skeleton className="h-72" />}>
          <OnboardingGate />
        </Suspense>
      </div>
    </main>
  );
}

// Users who already belong to a venue skip onboarding.
async function OnboardingGate() {
  const user = await requireUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("memberships")
    .select("org_id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (count) redirect("/dashboard");

  return <OnboardingChoice />;
}
