import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/dal";
import { Skeleton } from "@/components/card";
import { marketingFonts } from "@/lib/marketing-fonts";
import { GLOW_TOP, Glow } from "../_landing/site-chrome";
import { Wordmark } from "../_landing/wordmark";
import { ThemeToggle } from "@/components/theme";
import { buttonClass } from "@/components/styles";
import { logout } from "@/app/(auth)/actions";
import { OnboardingChoice } from "./onboarding-form";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <main
      className={`${marketingFonts} relative isolate flex flex-1 flex-col items-center overflow-x-clip bg-bg px-4 py-5 text-fg sm:py-8`}
    >
      <Glow className={GLOW_TOP} />
      <div className="flex w-full max-w-[520px] items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className={buttonClass("ghost", "sm")}>
              Log out
            </button>
          </form>
        </div>
      </div>
      <div className="mt-8 w-full max-w-[520px] sm:mt-12 [&_button[type=submit]]:rounded-full">
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
