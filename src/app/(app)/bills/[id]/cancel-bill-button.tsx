"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Field, Input } from "@/components/ui";

type Result = { cash: number; upi: number; wallet: number; sessions: number };

// Owner only (the database checks too). Cancels the bill: it leaves every total, its sessions go
// back to "Ended, not paid" for re-billing, wallet money returns to the wallet.
export function CancelBillButton({
  invoiceId,
  number,
  hasSessions,
  hasCounterItems,
}: {
  invoiceId: string;
  number: string;
  hasSessions: boolean;
  hasCounterItems: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const cancel = () =>
    startTransition(async () => {
      setError(undefined);
      const { data, error } = await createClient().rpc("void_invoice", {
        p_invoice_id: invoiceId,
        p_reason: reason.trim(),
        p_restock: restock,
      });
      if (error) return setError(error.message);
      setDone(data as Result);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Ban /> Cancel bill
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`Cancel bill ${number}`}>
        {done ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="font-medium">Bill cancelled. It no longer counts in takings or reports.</p>
            {(Number(done.cash) > 0 || Number(done.upi) > 0) && (
              <p className="rounded-lg border border-ending/40 bg-ending/8 px-3 py-2">
                Hand back{" "}
                {[Number(done.cash) > 0 && `${formatINR(done.cash)} cash`, Number(done.upi) > 0 && `${formatINR(done.upi)} by UPI`]
                  .filter(Boolean)
                  .join(" and ")}
                {hasSessions ? ", or keep it and re-bill the sessions now." : "."}
              </p>
            )}
            {Number(done.wallet) > 0 && <p>{formatINR(done.wallet)} went back to the player&apos;s wallet.</p>}
            {Number(done.sessions) > 0 && (
              <p>
                {done.sessions} session{done.sessions === 1 ? " is" : "s are"} back under “Ended, not paid” on the Floor,
                ready to bill again.
              </p>
            )}
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Use this for a wrong bill (wrong station, wrong amount, double bill). The bill stays on record, marked
              cancelled. {hasSessions && "Its sessions go back to “Ended, not paid” so you can bill them correctly."}
            </p>
            <Field label="Why are you cancelling it?">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Billed the wrong PC" />
            </Field>
            {hasCounterItems && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="size-4 accent-current" />
                Put counter-sale items back in stock
              </label>
            )}
            <ErrorText>{error}</ErrorText>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Keep bill
              </Button>
              <Button variant="danger" onClick={cancel} disabled={pending || reason.trim().length < 3}>
                {pending ? "Cancelling…" : "Cancel bill"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
