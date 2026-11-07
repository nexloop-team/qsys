import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatINR } from "@/lib/format";
import { PageSkeleton } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { PrintButton } from "./print-button";
import { CancelBillButton } from "./cancel-bill-button";
import { WhatsAppButton } from "./whatsapp-button";

export const metadata: Metadata = { title: "Bill" };

export default function BillPage(props: PageProps<"/bills/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Bill params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet" } as const;

async function Bill({
  params,
  searchParams,
}: {
  params: PageProps<"/bills/[id]">["params"];
  searchParams: PageProps<"/bills/[id]">["searchParams"];
}) {
  const { id } = await params;
  // Opened from checkout on the Floor: print straight away, and "back" goes to the Floor.
  const sp = await searchParams;
  const fromFloor = sp.from === "floor";
  const autoPrint = sp.print === "1";
  const { branch, org, role } = await getAppContext();
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, invoice_lines(*), payments(method, amount, reference)")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  // The receipt belongs to the branch that billed it, not the one selected right now.
  const { data: details } = await supabase
    .from("branches")
    .select("name, address, phone, timezone")
    .eq("id", inv.branch_id)
    .maybeSingle();
  const timeZone = details?.timezone ?? branch.timezone;
  const voided = Boolean(inv.voided_at);
  const hasSessions = inv.invoice_lines.some((l) => l.session_id);
  const hasCounterItems = inv.invoice_lines.some((l) => !l.session_id && l.product_id);

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={fromFloor ? "/dashboard" : "/bills"} className={buttonClass("ghost", "sm")}>
          <ArrowLeft /> {fromFloor ? "Floor" : "Bills"}
        </Link>
        <div className="flex items-center gap-2">
          <WhatsAppButton
            phone={inv.customer_phone}
            venueName={org.name}
            branchName={details?.name}
            billNumber={inv.number}
            dateTime={formatDateTime(inv.created_at, timeZone)}
            items={inv.invoice_lines.map((l) => ({ description: l.description, amount: formatINR(l.amount) }))}
            total={formatINR(inv.total)}
            paidBy={inv.payments.map((p) => METHOD_LABEL[p.method]).join(" + ") || "UPI"}
          />
          <PrintButton autoPrint={autoPrint && !voided} />
          {role === "owner" && !voided && (
            <CancelBillButton
              invoiceId={inv.id}
              number={inv.number}
              hasSessions={hasSessions}
              hasCounterItems={hasCounterItems}
            />
          )}
        </div>
      </div>

      {voided && (
        <div className="mb-4 rounded-xl border border-over/40 bg-over/8 px-3.5 py-2.5 text-sm">
          <p className="font-semibold text-over">Cancelled · not counted in takings</p>
          <p className="mt-0.5 text-muted">
            {formatDateTime(inv.voided_at!, timeZone)}
            {inv.void_reason && <> · “{inv.void_reason}”</>}
          </p>
        </div>
      )}

      {/* Receipt: narrow, monochrome, prints on 80mm thermal paper. */}
      <article
        className={`rounded-lg border border-line bg-panel p-5 text-[13px] print:rounded-none print:border-0 print:p-0 print:text-black ${voided ? "opacity-70" : ""}`}
      >
        <header className="border-b border-dashed border-line-strong pb-3 text-center">
          <p className="text-base font-semibold">{org.name}</p>
          <p className="text-muted print:text-black">
            {details?.name}
            {details?.address && ` · ${details.address}`}
          </p>
          {details?.phone && <p className="text-muted print:text-black">{details.phone}</p>}
          {inv.gst_enabled && inv.gstin && <p className="mt-1">GSTIN {inv.gstin}</p>}
          <p className="mt-2 font-medium">
            {voided ? "CANCELLED " : ""}
            {inv.gst_enabled ? "TAX INVOICE" : "RECEIPT"}
          </p>
        </header>

        <div className="flex justify-between border-b border-dashed border-line-strong py-2">
          <span className="num">{inv.number}</span>
          <span className="num">{formatDateTime(inv.created_at, timeZone)}</span>
        </div>
        {inv.customer_name && (
          <p className="border-b border-dashed border-line-strong py-2">
            {inv.customer_name}
            {inv.customer_phone && ` · ${inv.customer_phone}`}
          </p>
        )}

        <table className="w-full border-b border-dashed border-line-strong">
          <tbody>
            {inv.invoice_lines.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5 pr-2">{l.description}</td>
                <td className="num py-1.5 text-right">{formatINR(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="grid grid-cols-[1fr_auto] gap-y-1 py-2">
          <dt>Subtotal</dt>
          <dd className="num text-right">{formatINR(inv.subtotal)}</dd>
          {Number(inv.discount) > 0 && (
            <>
              <dt>
                Discount
                {inv.discount_reason && <span className="text-muted print:text-black"> ({inv.discount_reason})</span>}
              </dt>
              <dd className="num text-right">−{formatINR(inv.discount)}</dd>
            </>
          )}
          {inv.gst_enabled && (
            <>
              <dt>Taxable value</dt>
              <dd className="num text-right">{formatINR(inv.taxable_amount)}</dd>
              <dt>CGST</dt>
              <dd className="num text-right">{formatINR(inv.cgst)}</dd>
              <dt>SGST</dt>
              <dd className="num text-right">{formatINR(inv.sgst)}</dd>
            </>
          )}
          <dt className="mt-1 border-t border-line-strong pt-2 text-base font-semibold">Total</dt>
          <dd className="num mt-1 border-t border-line-strong pt-2 text-right text-base font-semibold">
            {formatINR(inv.total)}
          </dd>
        </dl>

        <div className="border-t border-dashed border-line-strong pt-2">
          {inv.payments.map((p, i) => (
            <p key={i} className="flex justify-between">
              <span>
                Paid by {METHOD_LABEL[p.method]}
                {p.reference && ` (${p.reference})`}
              </span>
              <span className="num">{formatINR(p.amount)}</span>
            </p>
          ))}
        </div>
        <p className="mt-4 text-center text-muted print:text-black">Thank you. Play again soon.</p>
      </article>
    </div>
  );
}
