"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatINR } from "@/lib/format";
import { openWhatsApp } from "@/lib/whatsapp";
import { Modal } from "@/components/overlay";
import { Button, ErrorText, Field, Input } from "@/components/ui";

// A polite WhatsApp nudge about money owed (click-to-chat; staff tap Send).
export function DuesReminderButton({
  phone,
  name,
  owed,
  venueName,
  size = "sm",
}: {
  phone: string;
  name: string;
  owed: number;
  venueName: string;
  size?: "sm" | "md";
}) {
  const first = name.split(" ")[0];
  const text =
    `Hi ${first}, a friendly reminder from ${venueName}: ${formatINR(owed)} is pending from your earlier visits. ` +
    `You can pay at the counter on your next visit. Thank you!`;
  return (
    <Button size={size} variant="secondary" onClick={() => openWhatsApp(phone, text)}>
      <MessageCircle /> Remind
    </Button>
  );
}

// This player's own pay-later limit (owner). Empty = the venue's limit.
export function KhataLimitButton({
  customerId,
  playerName,
  own,
  venueLimit,
}: {
  customerId: string;
  playerName: string;
  own: number | null;
  venueLimit: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(own != null ? String(own) : "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="ghost" aria-label="Change how much they can owe" onClick={() => setOpen(true)}>
        <Pencil />
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`Pay-later limit · ${playerName}`}>
        <div className="flex flex-col gap-4">
          <Field
            label="Most they can owe (₹)"
            hint={`Leave empty to use the venue's limit (${venueLimit != null ? formatINR(venueLimit) : "no limit"}). Use a large amount for regulars you trust.`}
          >
            <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Venue's limit" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(undefined);
                const { error } = await createClient().rpc("set_player_credit_limit", {
                  p_customer_id: customerId,
                  p_limit: value.trim() === "" ? null : Number(value),
                });
                if (error) return setError(friendlyError(error));
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save limit"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
