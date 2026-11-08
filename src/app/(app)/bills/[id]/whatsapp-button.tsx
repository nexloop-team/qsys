"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { buttonClass } from "@/components/styles";
import { Modal } from "@/components/overlay";
import { Button, Field, Input } from "@/components/ui";
import { openWhatsApp } from "@/lib/whatsapp";

export function formatWhatsAppMessage({
  venueName,
  branchName,
  billNumber,
  dateTime,
  items,
  total,
  paidBy,
}: {
  venueName: string;
  branchName?: string;
  billNumber: string;
  dateTime: string;
  items: { description: string; amount: string }[];
  total: string;
  paidBy: string;
}) {
  const lines = [
    `🎮 *${venueName}*${branchName ? ` (${branchName})` : ""}`,
    `🧾 *Bill #${billNumber}*`,
    `📅 ${dateTime}`,
    `──────────────`,
    ...items.map((it) => `• ${it.description}: ${it.amount}`),
    `──────────────`,
    `*Total: ${total}* (Paid by ${paidBy})`,
    ``,
    `Thanks for playing. See you again soon.`,
  ];
  return lines.join("\n");
}

export { openWhatsApp };

export function WhatsAppButton({
  phone,
  venueName,
  branchName,
  billNumber,
  dateTime,
  items,
  total,
  paidBy,
  variant = "secondary",
  size = "sm",
}: {
  phone?: string | null;
  venueName: string;
  branchName?: string;
  billNumber: string;
  dateTime: string;
  items: { description: string; amount: string }[];
  total: string;
  paidBy: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [askPhone, setAskPhone] = useState(false);
  const [inputPhone, setInputPhone] = useState("");

  const message = formatWhatsAppMessage({
    venueName,
    branchName,
    billNumber,
    dateTime,
    items,
    total,
    paidBy,
  });

  const cleanPhone = phone?.replace(/\D/g, "");

  const handleShare = () => {
    if (cleanPhone && cleanPhone.length >= 10) {
      openWhatsApp(cleanPhone, message);
    } else {
      setAskPhone(true);
    }
  };

  const handleConfirmPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPhone) return;
    openWhatsApp(inputPhone, message);
    setAskPhone(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        className={buttonClass(variant, size)}
      >
        <MessageCircle className="size-4" /> WhatsApp
      </button>

      <Modal open={askPhone} onOpenChange={setAskPhone} title="Send on WhatsApp">
        <form onSubmit={handleConfirmPrompt} className="flex flex-col gap-3">
          <Field label="Player's mobile number" hint="10 digits, the number they use on WhatsApp.">
            <Input
              type="tel"
              inputMode="numeric"
              placeholder="9876543210"
              value={inputPhone}
              onChange={(e) => setInputPhone(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setAskPhone(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <MessageCircle className="size-4" /> Open WhatsApp
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

