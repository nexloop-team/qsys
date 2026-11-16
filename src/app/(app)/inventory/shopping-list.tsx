"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";

export type ShoppingRow = { id: string; name: string; stock: number; sold: number; buy: number };

// Running low, as a list to take to the shop or send to the supplier. "Buy about" covers a week
// going by the last 7 days of sales, and never less than twice the low-stock mark.
export function ShoppingList({ rows, branchName }: { rows: ShoppingRow[]; branchName: string }) {
  const [copied, setCopied] = useState(false);
  const text = [`Shopping list, ${branchName}`, ...rows.filter((r) => r.buy > 0).map((r) => `${r.name}: ${r.buy}`)].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the WhatsApp button still works.
    }
  };

  return (
    <div>
      <p className="px-4 pt-3 text-xs text-muted">&quot;Buy about&quot; covers a week, going by the last 7 days of sales.</p>
      <ul className="divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block text-xs text-muted">
                <span className={r.stock === 0 ? "font-semibold text-over" : "font-semibold text-ending"}>
                  {r.stock === 0 ? "Out" : `${r.stock} left`}
                </span>
                {" · "}
                {r.sold} sold in 7 days
              </span>
            </span>
            {r.buy > 0 && (
              <span className="shrink-0 text-right">
                <span className="block text-xs text-muted">Buy about</span>
                <span className="num block font-semibold">{r.buy}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy list"}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClass("secondary", "sm")}
        >
          Send on WhatsApp
        </a>
      </div>
    </div>
  );
}
