import type { Metadata } from "next";
import { GuidePage, RateMath } from "../_landing/guide-page";

export const metadata: Metadata = {
  title: "Snooker & pool club software: timers, frames and billing",
  description:
    "Run a snooker or pool club in India: every table on one board, billing by the minute or by the frame, 2 or 4 players at their own price, the loser pays, khata and GST bills.",
};

const FAQ = [
  [
    "Should I charge by the frame or by the minute?",
    "Both work. By the minute is fairest for casual players and needs no counting. By the frame suits regulars and money games, and the loser often pays. QueSys lets each table run either way, and you can pick per game.",
  ],
  [
    "Can 4 players pay more than 2?",
    "Yes. Set a price for 2 players and another for 4 (for example ₹200 and ₹300 an hour). The timer uses the one picked when the game starts, and you can change it mid-game if more people join.",
  ],
  [
    "Who pays at the end?",
    "Whoever you choose at checkout: the whole table, the losing side, or split. A player who will pay later goes on their khata, with a limit you set.",
  ],
  [
    "Do I need a computer at the counter?",
    "No. QueSys runs in the browser on a phone, tablet or laptop. Several staff can use it at once and see the same timers.",
  ],
  [
    "Can players book a table?",
    "Yes. Turn on the booking page and share its link on Instagram or WhatsApp. Requests appear on the floor for you to confirm.",
  ],
] as const;

export default function SnookerPage() {
  return (
    <GuidePage
      path="/snooker-club-software"
      eyebrow="Guide · Snooker & pool clubs"
      title="Software for snooker and pool clubs."
      lead={
        <>
          <p>
            A club loses money in small ways: a table started five minutes late in the register, a frame nobody counted, a
            regular who will pay next time and never does. QueSys puts every table on one board, times it on the server and
            turns it into a bill paid by cash, UPI or wallet.
          </p>
          <p>This page also covers how to set your table rates. Use it whether or not you use QueSys.</p>
        </>
      }
      sections={[
        {
          eyebrow: "On the floor",
          title: "What it does for a club",
          items: [
            ["Every table at a glance", "Free, playing, ending soon or overtime, on the counter laptop and every staff phone."],
            ["By the minute or by the frame", "Count frames with a tap, or let the clock run. Each table can do both."],
            ["2 or 4 players", "A price for each group size. Change it mid-game when friends join."],
            ["Loser pays", "Move the bill to the losing side at checkout, or split it."],
            ["Khata", "Regulars can pay later, up to a limit you set, with WhatsApp reminders."],
            ["Snacks on the table's bill", "Tea, cold drinks and cigarettes go on the same bill. Stock counts itself down."],
            ["Bookings and tournaments", "A booking page for busy evenings and knockout tournaments with entry fees."],
            ["GST bills", "GST on or off, printed on an 80 mm printer or sent on WhatsApp."],
          ],
        },
        {
          eyebrow: "Rates",
          title: "How to set your table rate",
          note: "An example with round numbers. Use your own.",
          body: <RateMath example={{ costs: 180000, stations: 6, hours: 12, busy: 0.45 }} />,
        },
        {
          eyebrow: "Setup",
          title: "Ready in an evening",
          steps: [
            ["Add your tables", "Name them and drag them where they stand on the floor map."],
            ["Set prices", "Per hour, per frame, for 2 and 4 players, with evening and weekend rates."],
            ["Add your staff", "They log in on their own phones. Discounts above your limit need you."],
            ["Start the first game", "Tap a table, pick the players, and the clock runs."],
          ],
        },
      ]}
      faq={FAQ}
      cta="Put every table on one board."
    />
  );
}
