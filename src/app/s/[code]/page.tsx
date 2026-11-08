import { Suspense } from "react";
import type { Metadata } from "next";
import { StationPage } from "./station-page";

// The page behind the QR code on each station. No login: what it shows and accepts is limited by
// the database (public_station / public_station_request).
export const metadata: Metadata = {
  title: "Your session",
  robots: { index: false, follow: false },
};

export default function PlayerStationPage(props: PageProps<"/s/[code]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <Suspense fallback={<p className="py-16 text-center text-sm text-muted">Loading…</p>}>
        <Code params={props.params} />
      </Suspense>
    </main>
  );
}

async function Code({ params }: { params: PageProps<"/s/[code]">["params"] }) {
  const { code } = await params;
  return <StationPage code={code} />;
}
