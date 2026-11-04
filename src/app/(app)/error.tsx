"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";

// Shown inside the app shell (sidebar stays) when a page fails to load.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  // Our own permission errors are safe to show; anything else stays generic.
  const friendly = message.startsWith("You don't have permission") ? message : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-over/30 bg-over/10 text-over">
        <TriangleAlert className="size-6" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="mt-1.5 text-sm text-muted">
        {friendly ?? "Something went wrong on our side. Your timers and bills are safe. Try again, or go back to the floor."}
      </p>
      {digest && <p className="num mt-3 text-xs text-faint">Ref {digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw /> Try again
        </Button>
        <Link href="/dashboard" className={buttonClass("secondary")}>
          Go to Floor
        </Link>
      </div>
    </div>
  );
}
