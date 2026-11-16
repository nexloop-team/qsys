"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { saveOnlineSettings } from "./actions";
import { FormMessage, SubmitButton, Toggle, buttonClass } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

// The player page behind each station's QR code. (Online booking is off for now.)
export function OnlineForm({
  settings,
  disabled,
}: {
  settings: { qr_enabled: boolean; qr_orders: boolean };
  disabled: boolean;
}) {
  const [state, action] = useActionState(saveOnlineSettings, null);
  const [qr, setQr] = useState(settings.qr_enabled);
  const [orders, setOrders] = useState(settings.qr_orders);

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection
          title="Player QR page"
          description="Stick a QR code on each station. Players scan it to see their timer and bill, order snacks, ask for 30 more minutes, or call staff. Nothing reaches the bill until staff accept it on the Floor."
          action={
            <Link href="/stations/qr" className={buttonClass("secondary", "sm")}>
              <QrCode /> Print QR codes
            </Link>
          }
        >
          <div className="flex flex-col gap-4">
            <Toggle name="qr_enabled" checked={qr} onChange={setQr} label="Turn on the player page" />
            <div className="border-t border-line pt-4">
              <Toggle
                name="qr_orders"
                checked={orders}
                onChange={setOrders}
                label="Players can order snacks & drinks"
                description="On the QR page and in the games menu of the QueSys PC app (that one works even with the page off). Shows what's in stock; an order goes on the bill when staff accept it."
              />
            </div>
          </div>
        </SettingsSection>
      </fieldset>
      {!disabled && (
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
