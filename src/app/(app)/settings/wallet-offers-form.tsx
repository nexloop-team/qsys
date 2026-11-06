"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { saveWalletOffers } from "./actions";
import { formatINR } from "@/lib/format";
import { Button, FormMessage, Input, SubmitButton } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

type Offer = { pay: string; bonus: string };

// "Pay ₹500, get ₹50 extra". Applied automatically on top-ups; staff can't change the bonus.
export function WalletOffersForm({ offers, disabled }: { offers: { pay: number; bonus: number }[]; disabled: boolean }) {
  const [state, action] = useActionState(saveWalletOffers, null);
  const [rows, setRows] = useState<Offer[]>(
    offers.length ? offers.map((o) => ({ pay: String(o.pay), bonus: String(o.bonus) })) : [],
  );

  return (
    <form action={action}>
      <SettingsSection
        title="Wallet top-up offers"
        description="Extra credit for paying in advance, e.g. pay ₹500, get ₹50 more. The biggest offer the top-up qualifies for is added automatically. Bonus credit isn't money received, so it doesn't count as takings."
      >
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
          {rows.length === 0 && <p className="text-sm text-muted">No offers. Top-ups add exactly what is paid.</p>}
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Pay ₹</span>
              <Input
                name="pay"
                type="number"
                min={1}
                value={r.pay}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pay: e.target.value } : x)))}
                className="w-28"
                aria-label="Pay amount"
              />
              <span className="text-muted">get ₹</span>
              <Input
                name="bonus"
                type="number"
                min={1}
                value={r.bonus}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))}
                className="w-24"
                aria-label="Bonus amount"
              />
              <span className="text-muted">extra</span>
              {Number(r.pay) > 0 && Number(r.bonus) > 0 && (
                <span className="text-xs text-muted">
                  → wallet gets {formatINR(Number(r.pay) + Number(r.bonus))} ({Math.round((Number(r.bonus) / Number(r.pay)) * 100)}% bonus)
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove offer"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="ml-auto"
              >
                <X />
              </Button>
            </div>
          ))}
          {rows.length < 6 && (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => setRows([...rows, { pay: rows.length ? "" : "500", bonus: rows.length ? "" : "50" }])}
            >
              <Plus /> Add offer
            </Button>
          )}
        </fieldset>
      </SettingsSection>
      {!disabled && (
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save offers</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
