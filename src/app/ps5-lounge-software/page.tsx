import type { Metadata } from "next";
import { GuidePage, RateMath } from "../_landing/guide-page";

export const metadata: Metadata = {
  title: "PS5 & console lounge software: timers and billing per controller",
  description:
    "Run a PS5, Xbox or VR lounge in India: timers for every console, prices per controller, fixed slots or open time, a QR code for players to order snacks, wallets and bookings.",
};

const FAQ = [
  [
    "Do I need to install anything on the PS5?",
    "No. Consoles are timed from the counter or a staff phone. Each station can have a QR code: players scan it to see their timer and bill, order snacks, or ask for more time.",
  ],
  [
    "Can I charge more for 4 controllers?",
    "Yes. Set a price for 2 controllers and another for 4. The timer uses the one picked at the start, and changes if controllers are added mid-game.",
  ],
  [
    "Fixed slots or open time?",
    "Both. Sell 30 minutes or an hour up front, or let the clock run and bill at the end. Packages like 3 hours for a set price work too.",
  ],
  [
    "Can regulars prepay?",
    "Yes. Players top up a wallet, with offers like pay ₹500, get ₹50 more, and can earn a percentage back on every bill. Vouchers work for contests and giveaways.",
  ],
  [
    "Does it count the cash at closing?",
    "Yes. Staff close their shift by counting the drawer. QueSys shows what should be there and records any difference.",
  ],
] as const;

export default function Ps5Page() {
  return (
    <GuidePage
      path="/ps5-lounge-software"
      eyebrow="Guide · PS5 & console lounges"
      title="Software for PS5 and console lounges."
      lead={
        <>
          <p>
            A console lounge sells time in small pieces: half an hour here, one more match there, a second controller halfway
            through. QueSys keeps every console&apos;s clock on the server and turns it into a bill with the snacks on it.
          </p>
          <p>This page also covers how to price consoles. Use it whether or not you use QueSys.</p>
        </>
      }
      sections={[
        {
          eyebrow: "On the floor",
          title: "What it does for a lounge",
          items: [
            ["Every console on one board", "PS5 and Xbox, plus VR or racing seats as other stations, on the counter and staff phones."],
            ["Per controller pricing", "2 or 4 controllers at their own price, changed mid-game when friends join."],
            ["Fixed time or open time", "Sell a slot up front or bill the time used. Packages and happy hours included."],
            ["A QR code on each station", "Players see their timer and bill, order snacks, ask for 30 more minutes or call staff."],
            ["Wallets, offers and vouchers", "Prepaid balances with top-up offers, a bonus on spending, and one-time voucher codes."],
            ["Bookings", "A booking page for weekends and birthdays, confirmed from the floor."],
            ["Shift close", "Staff count the drawer; any short or extra cash is recorded against the shift."],
          ],
        },
        {
          eyebrow: "Rates",
          title: "How to price a console hour",
          note: "An example with round numbers. Use your own.",
          body: <RateMath example={{ costs: 120000, stations: 6, hours: 11, busy: 0.4 }} />,
        },
        {
          eyebrow: "Setup",
          title: "Ready in an evening",
          steps: [
            ["Add your consoles", "PS5, Xbox, and anything else you time: each a station on the floor map."],
            ["Set prices", "Per hour, for 2 and 4 controllers, with packages and weekend rates."],
            ["Print QR codes", "One per station, from Stations › QR codes."],
            ["Start the first game", "Tap a console, pick the controllers, and the clock runs."],
          ],
        },
      ]}
      faq={FAQ}
      cta="Time every console from one screen."
    />
  );
}
