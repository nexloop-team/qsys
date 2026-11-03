import { Suspense } from "react";
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { ROLE_LABEL } from "@/lib/constants";
import { PageSkeleton } from "@/components/card";
import { SettingsSection } from "../section";
import { PasswordForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage(props: PageProps<"/settings/account">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Account searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Account({ searchParams }: { searchParams: PageProps<"/settings/account">["searchParams"] }) {
  const { user, role, org } = await getAppContext();
  const fromReset = (await searchParams).reset === "1";

  return (
    <>
      {fromReset && (
        <p className="mb-5 flex items-center gap-2 rounded-md border border-fg px-3 py-2 text-sm">
          <KeyRound className="size-4" /> You&apos;re signed in from the reset link. Set a new password below.
        </p>
      )}
      <SettingsSection title="Your profile" description={`${user.email} · ${ROLE_LABEL[role]} at ${org.name}`}>
        <ProfileForm name={user.fullName} />
      </SettingsSection>
      <SettingsSection title="Password" description="At least 8 characters. Other devices stay logged in.">
        <PasswordForm />
      </SettingsSection>
    </>
  );
}
