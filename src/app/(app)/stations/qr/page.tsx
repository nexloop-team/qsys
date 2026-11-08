import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import QRCode from "qrcode";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { STATION_TYPE_LABEL } from "@/lib/constants";
import { isLocalUrl, isTunnelUrl, siteUrl } from "@/lib/site-url";
import { PageHeader, PageSkeleton } from "@/components/card";
import { buttonClass } from "@/components/styles";
import { PrintButton } from "../../bills/[id]/print-button";
import { ResetCodeButton } from "./reset-code-button";

export const metadata: Metadata = { title: "Station QR codes" };

export default function StationQrPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QrSheet />
    </Suspense>
  );
}

// One card per station, sized to cut out and stick on the table, console or PC.
async function QrSheet() {
  const { branch, org, role } = await getAppContext();
  const supabase = await createClient();
  const [{ data: stations }, { data: settings }] = await Promise.all([
    supabase
      .from("stations")
      .select("id, name, type, public_code")
      .eq("branch_id", branch.id)
      .neq("status", "disabled")
      .order("sort_order"),
    supabase.from("branch_settings").select("qr_enabled").eq("branch_id", branch.id).single(),
  ]);

  const base = await siteUrl();
  const cards = await Promise.all(
    (stations ?? []).map(async (s) => ({
      ...s,
      url: `${base}/s/${s.public_code}`,
      svg: await QRCode.toString(`${base}/s/${s.public_code}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    })),
  );

  return (
    <>
      <div className="print:hidden">
        <Link href="/stations" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Stations
        </Link>
        <PageHeader
          title="Station QR codes"
          description="Print, cut out and stick one on each station. Players scan it for their timer, bill and snacks."
          actions={<PrintButton />}
        />
        {!settings?.qr_enabled && (
          <p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ending/30 bg-ending/8 px-3.5 py-2.5 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-ending" />
            The player page is off, so these codes show &quot;turned off&quot; for now.
            <Link href="/settings/online" className={buttonClass("secondary", "sm", "ml-auto")}>
              Turn it on
            </Link>
          </p>
        )}
        {isLocalUrl(base) ? (
          <p className="mb-4 text-[13px] text-muted">
            These codes point to {base}, which phones can&apos;t open. Open this page from your venue&apos;s web address
            and print from there.
          </p>
        ) : isTunnelUrl(base) ? (
          <p className="mb-4 text-[13px] text-muted">
            These codes point to {base}, a temporary address. They stop working when it changes, so print them from
            your real web address.
          </p>
        ) : null}
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-4">
        {cards.map((c) => (
          <li
            key={c.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-line bg-panel p-4 text-center print:rounded-none print:border-dashed"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{org.name}</p>
            <p className="text-lg font-semibold leading-tight">{c.name}</p>
            {/* Black on white always, so every phone camera reads it. */}
            <div
              className="aspect-square w-full max-w-44 rounded-md bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
              aria-label={`QR code for ${c.name}`}
              role="img"
              dangerouslySetInnerHTML={{ __html: c.svg }}
            />
            <p className="text-xs leading-snug text-muted">
              Scan for your timer &amp; bill
              <br />
              Order snacks · Call staff
            </p>
            <p className="text-[10px] text-faint">{STATION_TYPE_LABEL[c.type]}</p>
            {isOwner(role) && <ResetCodeButton stationId={c.id} stationName={c.name} />}
          </li>
        ))}
      </ul>
    </>
  );
}
