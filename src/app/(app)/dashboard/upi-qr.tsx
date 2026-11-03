"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { formatINR } from "@/lib/format";

export type UpiPayee = { vpa: string; name: string };

// Standard UPI deep link: any UPI app scans it with the amount already filled in.
export function upiLink(payee: UpiPayee, amount: number, note: string) {
  const params = new URLSearchParams({
    pa: payee.vpa,
    pn: payee.name.slice(0, 60),
    am: amount.toFixed(2),
    cu: "INR",
    tn: note.slice(0, 60),
  });
  return `upi://pay?${params.toString()}`;
}

// Scannable QR for the exact amount. Rendered as SVG with fixed black-on-white so every phone reads it.
export function UpiQr({ payee, amount, note }: { payee: UpiPayee; amount: number; note: string }) {
  const link = upiLink(payee, amount, note);
  const [svg, setSvg] = useState<{ link: string; markup: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((markup) => !cancelled && setSvg({ link, markup }))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [link]);

  if (amount <= 0) return null;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-subtle/50 p-3">
      <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5 shadow-xs ring-1 ring-line">
        {svg?.link === link ? (
          <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg.markup }} />
        ) : (
          <QrCode className="size-8 animate-pulse text-faint" />
        )}
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-xs font-medium text-muted">Scan to pay with any UPI app</p>
        <p className="num mt-1 text-xl font-semibold">{formatINR(amount)}</p>
        <p className="mt-1 truncate text-xs text-muted">
          to <span className="font-medium text-fg">{payee.name}</span>
        </p>
        <p className="num truncate text-xs text-faint">{payee.vpa}</p>
      </div>
    </div>
  );
}
