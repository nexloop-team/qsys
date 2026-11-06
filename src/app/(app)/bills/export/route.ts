import { type NextRequest } from "next/server";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { nextDay, todayIn, zonedStart } from "@/lib/format";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHOD = { cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet" } as const;

// Text typed at the counter (player names) must not run as a spreadsheet formula,
// so text starting with = + - @ or a tab/CR is prefixed with a quote. Numbers pass through.
function csvCell(v: string | number | null | undefined) {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Bills for a date range as CSV (for the accountant / GST filing). Owner only.
export async function GET(request: NextRequest) {
  const { branch, role } = await getAppContext();
  if (role !== "owner") return new Response("Not allowed", { status: 403 });

  const sp = request.nextUrl.searchParams;
  const today = todayIn(branch.timezone);
  const from = DATE.test(sp.get("from") ?? "") ? sp.get("from")! : today;
  const to = DATE.test(sp.get("to") ?? "") ? sp.get("to")! : today;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "number, created_at, customer_name, customer_phone, subtotal, discount, discount_reason, taxable_amount, cgst, sgst, total, gst_enabled, voided_at, void_reason, invoice_lines(description), payments(method, amount)",
    )
    .eq("branch_id", branch.id)
    .gte("created_at", zonedStart(from, branch.timezone))
    .lt("created_at", zonedStart(nextDay(to), branch.timezone))
    .order("created_at");
  if (error) return new Response(error.message, { status: 500 });

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: branch.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const header = [
    "Bill",
    "Date time",
    "Status",
    "Type",
    "Player",
    "Mobile",
    "Items",
    "Subtotal",
    "Discount",
    "Discount reason",
    "Taxable value",
    "CGST",
    "SGST",
    "Total",
    "Paid by",
  ];
  const rows = (data ?? []).map((inv) => [
    inv.number,
    fmt.format(new Date(inv.created_at)).replace(",", ""),
    // Cancelled bills are listed for the record; leave them out of any totals.
    inv.voided_at ? `Cancelled: ${inv.void_reason ?? ""}` : "Paid",
    inv.gst_enabled ? "Tax invoice" : "Receipt",
    inv.customer_name,
    inv.customer_phone,
    inv.invoice_lines.map((l) => l.description).join("; "),
    inv.subtotal,
    inv.discount,
    inv.discount_reason,
    inv.taxable_amount,
    inv.cgst,
    inv.sgst,
    inv.total,
    inv.payments.map((p) => `${METHOD[p.method]} ${p.amount}`).join(" + "),
  ]);

  // BOM so Excel opens ₹ / Indian names correctly.
  const body = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bills-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
