import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Log in to run your floor. For owners and staff.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
          Create an account
        </Link>
      </p>
    </>
  );
}
