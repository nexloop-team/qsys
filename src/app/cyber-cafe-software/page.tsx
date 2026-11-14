import type { Metadata } from "next";
import { GuidePage, RateMath } from "../_landing/guide-page";

export const metadata: Metadata = {
  title: "Gaming PC & cyber café software: PC lock, timer and billing",
  description:
    "Run a gaming PC or cyber café in India: PCs that lock and unlock themselves, player login with mobile and PIN, a games menu, restrictions, tamper alerts and billing by cash, UPI or wallet.",
};

const FAQ = [
  [
    "How does the PC lock work?",
    "The QueSys PC app keeps each PC locked until a session starts, from the counter or by the player logging in with their mobile number and PIN. When time runs out it locks again, even if the internet drops.",
  ],
  [
    "Can players get around the lock?",
    "The time and price are decided on the server, so changing the PC clock does nothing. Task Manager, Control Panel, the command line and USB drives can be turned off for players. If the app is closed or the PC goes quiet mid-session, it shows up as an alert on the floor.",
  ],
  [
    "Do I need a server PC?",
    "No. The counter runs in a browser, on any laptop or phone. Each gaming PC runs the small QueSys PC app.",
  ],
  [
    "Can players order food from their seat?",
    "Yes. The games menu on the PC lists your snacks; orders appear on the floor and go on the bill when staff accept them.",
  ],
  [
    "Will it slow games down?",
    "No. The PC app has no game hooks and no screen capture, and it never takes focus from a game.",
  ],
] as const;

export default function CyberCafePage() {
  return (
    <GuidePage
      path="/cyber-cafe-software"
      eyebrow="Guide · Gaming PC & cyber cafés"
      title="Software for gaming PC and cyber cafés."
      lead={
        <>
          <p>
            In a PC café the lock is the business: a PC that opens without a session is time given away. QueSys locks every
            PC until a session starts, keeps the time on the server, and bills it by cash, UPI or a prepaid wallet.
          </p>
          <p>This page also covers how to price a PC hour. Use it whether or not you use QueSys.</p>
        </>
      }
      sections={[
        {
          eyebrow: "On the PCs",
          title: "What the PC app does",
          items: [
            ["Locks until a session starts", "Started from the counter, or by the player with their mobile number and PIN."],
            ["A small timer", "Out of the way during games, shown at the start, at 5 minutes and in the last minute."],
            ["Games menu", "Your games in one window, with the player's wallet balance, snack orders and Call staff."],
            ["Restrictions", "Task Manager, Control Panel, the command line and USB drives off for players."],
            ["Tamper alerts", "An app closed, a PC switched off or a cable pulled during a session is flagged on the floor."],
            ["PC health", "CPU, memory, GPU temperature and disk space for every PC, with warnings."],
            ["Commands from the counter", "Message, restart, shut down and turn on any PC."],
          ],
        },
        {
          eyebrow: "At the counter",
          title: "What the counter gets",
          items: [
            ["A live floor", "Every PC free, playing or ending, on a laptop or phone."],
            ["Wallets and vouchers", "Prepaid balances, top-up offers, a bonus on spending and one-time voucher codes."],
            ["Shift close", "Count the drawer; QueSys shows what should be there and records the difference."],
            ["Reports", "Takings by day, by station and by payment, and net profit after expenses."],
          ],
        },
        {
          eyebrow: "Rates",
          title: "How to price a PC hour",
          note: "An example with round numbers. Use your own.",
          body: <RateMath example={{ costs: 250000, stations: 20, hours: 13, busy: 0.4 }} />,
        },
      ]}
      faq={FAQ}
      cta="Lock every PC until it is paid for."
    />
  );
}
