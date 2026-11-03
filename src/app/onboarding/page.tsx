import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/dal";
import { Skeleton } from "@/components/card";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { buttonClass } from "@/components/styles";
import { logout } from "@/app/(auth)/actions";
import { OnboardingChoice } from "./onboarding-form";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 py-8 sm:py-14">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[640px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
      />
      <div className="flex w-full max-w-md items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className={buttonClass("ghost", "sm")}>
              Log out
            </button>
          </form>
        </div>
      </div>
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
