import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Log in</h1>
      <p className="mb-6 mt-1 text-sm text-muted">For owners and staff.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent-ink underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
