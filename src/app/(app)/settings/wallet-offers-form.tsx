"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { saveWalletOffers } from "./actions";
import { formatINR } from "@/lib/format";
import { Button, Field, FormMessage, Input, SubmitButton } from "@/components/ui";
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
            // Two labelled boxes side by side (fits a phone), the result underneath.
            <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <Field label="Player pays (₹)">
                  <Input
                    name="pay"
                    type="number"
                    min={1}
                    value={r.pay}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pay: e.target.value } : x)))}
                  />
                </Field>
                <Field label="Bonus (₹)">
                  <Input
                    name="bonus"
                    type="number"
                    min={1}
                    value={r.bonus}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))}
                  />
                </Field>
                <Button size="md" variant="ghost" aria-label="Remove offer" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
              {Number(r.pay) > 0 && Number(r.bonus) > 0 && (
                <p className="text-xs text-muted">
                  Wallet gets <span className="num font-medium text-fg">{formatINR(Number(r.pay) + Number(r.bonus))}</span> (
                  {Math.round((Number(r.bonus) / Number(r.pay)) * 100)}% bonus)
                </p>
              )}
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
