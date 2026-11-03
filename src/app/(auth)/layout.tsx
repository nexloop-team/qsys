import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10">
      <Logo />
      <div className="mt-10 w-full max-w-sm">{children}</div>
    </main>
  );
}
