import type { Metadata } from "next";
import { GuidePage } from "../_landing/guide-page";

export const metadata: Metadata = {
  title: "Pricing: free during early access",
  description:
    "QueSys is free during early access: every feature, every station, no setup fee and no contract. Plus the questions to ask any gaming café or snooker club software before you pay.",
};

// What to ask any vendor, and QueSys's answer. Kept to things QueSys actually does today.
const QUESTIONS = [
  ["Is there a setup or installation fee?", "No. Create an account, add your stations, and pair PCs yourself with a one-time code."],
  ["Do I pay for a full year up front?", "No. There is no contract and nothing to cancel."],
  ["Do I need a server PC at the counter?", "No. The counter runs in a browser on a laptop, tablet or phone. Your records are online, not on one PC."],
  ["Are some features on a costlier plan?", "No. Every feature is in early access: PC lock, wallets, bookings, GST bills, reports."],
  ["Do staff logins cost extra?", "No. Add your whole team."],
  ["Is there a fee per customer or per bill?", "No. Your players and their payments are never charged by us."],
  ["Does the free version need our name on your signboard?", "No. We never ask you to advertise us."],
  ["Who decides the time and the price?", "The server. Changing a PC's clock or closing the app doesn't make a session cheaper, and it is flagged."],
  ["Can I get my data out?", "Yes. Bills export to a spreadsheet any time."],
] as const;

const FAQ = [
  [
    "What does early access mean?",
    "QueSys is free while we build it with the first venues. You get every feature, and your feedback decides what comes next.",
  ],
  [
    "What happens after early access?",
    "We will announce a price well before charging anything. Nothing is billed without you choosing a plan.",
  ],
  [
    "Is there a limit on PCs, consoles or tables?",
    "No. Add every station you have, across as many branches as you run.",
  ],
  [
    "Do I need special hardware?",
    "No. Any laptop or phone for the counter. Gaming PCs need Windows 10 or 11 for the PC app. Consoles and tables need nothing.",
  ],
] as const;

export default function PricingPage() {
  return (
    <GuidePage
      path="/plans"
      eyebrow="Pricing"
      title="Free during early access."
      lead={
        <>
          <p>
            Every feature, every station, every branch: no setup fee, no contract, no card. We are building QueSys with the
            first gaming lounges and snooker clubs.
          </p>
          <p>Comparing software? These are the questions worth asking any of them before you pay.</p>
        </>
      }
      sections={[
        {
          eyebrow: "Before you pay anyone",
          title: "Questions to ask any café software",
          note: "And QueSys's answers.",
          items: QUESTIONS,
        },
        {
          eyebrow: "What's included",
          title: "Everything, for every venue",
          items: [
            ["Floor and billing", "Timers on the server, open or fixed time, frames, 2 or 4 players, packages, happy hours, GST bills."],
            ["Players", "Wallets with offers, a bonus on spending, vouchers, khata with limits, WhatsApp reminders."],
            ["PCs", "Lock app, player login, games menu, restrictions, tamper alerts, health readings, remote commands."],
            ["Counter", "Snacks and stock, quick sales, shift close with a cash count, expenses and net profit."],
            ["Online", "Booking page, QR code on each station, knockout and team tournaments."],
          ],
        },
      ]}
      faq={FAQ}
      cta="Try it on your floor, free."
    />
  );
}
