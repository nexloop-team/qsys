"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { buttonClass } from "@/components/styles";
import { Modal } from "@/components/overlay";
import { Button, Field, Input } from "@/components/ui";

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
    `Thank you for playing with us! See you again soon.`,
  ];
  return lines.join("\n");
}

export function openWhatsApp(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

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
        className={buttonClass(variant, size, "bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 border-[#25D366]/30")}
      >
        <MessageCircle className="size-4 text-[#25D366]" /> WhatsApp
      </button>

      <Modal open={askPhone} onOpenChange={setAskPhone} title="Share via WhatsApp">
        <form onSubmit={handleConfirmPrompt} className="flex flex-col gap-3">
          <Field label="Customer's Mobile Number" hint="10-digit Indian mobile number for WhatsApp">
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
            <Button type="submit" className="bg-[#25D366] hover:bg-[#20ba59] text-white">
              <MessageCircle className="size-4" /> Send WhatsApp
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

