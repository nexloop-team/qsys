"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

// `autoPrint`: arrived from "Print bill" at checkout, so open the print dialog right away
// (one tap at the counter). The flag is then dropped from the address, so a reload or
// coming back to this page doesn't print again.
export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    // Let the receipt's fonts settle first, or the first print can use fallback fonts.
    const id = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(id);
  }, [autoPrint]);

  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Printer /> Print
    </Button>
  );
}
