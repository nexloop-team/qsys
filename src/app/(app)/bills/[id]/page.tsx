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

export const metadata: Metadata = { title: "Bill" };

export default function BillPage(props: PageProps<"/bills/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Bill params={props.params} />
    </Suspense>
  );
}

const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card" } as const;

async function Bill({ params }: { params: PageProps<"/bills/[id]">["params"] }) {
  const { id } = await params;
  const { branch, org } = await getAppContext();
  const supabase = await createClient();

  const [{ data: inv }, { data: details }] = await Promise.all([
    supabase.from("invoices").select("*, invoice_lines(*), payments(method, amount, reference)").eq("id", id).maybeSingle(),
    supabase.from("branches").select("name, address, phone").eq("id", branch.id).single(),
  ]);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/bills" className={buttonClass("ghost", "sm")}>
          <ArrowLeft /> Bills
        </Link>
        <PrintButton />
      </div>

      {/* Receipt: narrow, monochrome, prints on 80mm thermal paper. */}
      <article className="rounded-lg border border-line bg-panel p-5 text-[13px] print:rounded-none print:border-0 print:p-0 print:text-black">
        <header className="border-b border-dashed border-line-strong pb-3 text-center">
          <p className="text-base font-semibold">{org.name}</p>
          <p className="text-muted print:text-black">
            {details?.name}
            {details?.address && ` · ${details.address}`}
          </p>
          {details?.phone && <p className="text-muted print:text-black">{details.phone}</p>}
          {inv.gst_enabled && inv.gstin && <p className="mt-1">GSTIN {inv.gstin}</p>}
          <p className="mt-2 font-medium">{inv.gst_enabled ? "TAX INVOICE" : "RECEIPT"}</p>
        </header>

        <div className="flex justify-between border-b border-dashed border-line-strong py-2">
          <span className="num">{inv.number}</span>
          <span className="num">{formatDateTime(inv.created_at, branch.timezone)}</span>
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
              <dt>Discount</dt>
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
