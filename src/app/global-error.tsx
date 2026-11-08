"use client"; // Replaces the root layout when it fails, so it brings its own <html> and <body>.

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-bg p-6 font-sans text-fg antialiased">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">QueSys couldn&apos;t start</h1>
          <p className="mt-1.5 text-sm text-muted">Something went wrong loading the app. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-5 h-9 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
