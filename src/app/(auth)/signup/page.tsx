import Link from "next/link";
import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Owners set up their venue next. Staff join with an invite code from the owner.
      </p>
      <SignupForm />
      <p className="mt-6 text-sm text-muted">
        Have an account?{" "}
        <Link href="/login" className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
          Log in
        </Link>
      </p>
    </>
  );
}
