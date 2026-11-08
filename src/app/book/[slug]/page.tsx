import { Suspense } from "react";
import type { Metadata } from "next";
import { BookingForm } from "./booking-form";

// A venue's public booking page. No login and no payment: players ask for a time, staff confirm.
export const metadata: Metadata = { title: "Book a time" };

export default function BookPage(props: PageProps<"/book/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <Suspense fallback={<p className="py-16 text-center text-sm text-muted">Loading…</p>}>
        <Slug params={props.params} />
      </Suspense>
    </main>
  );
}

async function Slug({ params }: { params: PageProps<"/book/[slug]">["params"] }) {
  const { slug } = await params;
  return <BookingForm slug={slug} />;
}
