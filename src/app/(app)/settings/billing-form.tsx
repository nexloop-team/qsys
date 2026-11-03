"use client";

import { useActionState, useState } from "react";
import { saveBillingSettings } from "./actions";
import type { Tables } from "@/lib/database.types";
import {
  SESSION_MODE_LABEL,
  SESSION_MODES,
  STATION_TYPE_LABEL,
  STATION_TYPES,
  type SessionMode,
  type StationType,
} from "@/lib/constants";
import { Field, FormMessage, Input, Select, SubmitButton, cx } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

type Settings = Tables<"branch_settings">;

function Toggle({
  name,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-[13px] text-muted">{description}</span>}
      </span>
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
          checked ? "border-accent bg-accent" : "border-line-strong bg-subtle",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-3.5 rounded-full transition-all",
            checked ? "left-[18px] bg-white shadow-xs" : "left-0.5 bg-faint",
          )}
        />
      </span>
    </label>
  );
}

export function BillingForm({ settings, disabled }: { settings: Settings; disabled: boolean }) {
  const [state, action] = useActionState(saveBillingSettings, null);
  const [gstOn, setGstOn] = useState(settings.gst_enabled);
  const [inclusive, setInclusive] = useState(settings.prices_include_tax);

  const types = settings.station_types;
  const allowed = settings.allowed_modes_by_type as Record<StationType, SessionMode[]>;
  const defaults = settings.default_mode_by_type as Record<StationType, SessionMode>;

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection
          title="UPI payments"
          description="With your UPI ID set, checkout shows a QR with the exact amount for the player to scan."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UPI ID" hint="As shown in your UPI app, e.g. arena@okaxis.">
              <Input
                name="upi_vpa"
                defaultValue={settings.upi_vpa ?? ""}
                placeholder="yourname@bank"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Name shown to the player" hint="Optional. Defaults to your venue name.">
              <Input name="upi_payee_name" defaultValue={settings.upi_payee_name ?? ""} maxLength={60} />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Bills" description="Numbering and how much overtime is free on fixed-time sessions.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill number prefix" hint="Bills are numbered PREFIX-00001.">
              <Input name="invoice_prefix" defaultValue={settings.invoice_prefix} />
            </Field>
            <Field label="Overtime grace (minutes)" hint="Fixed-time players aren't charged for this much extra.">
              <Input name="overtime_grace_minutes" type="number" min={0} max={30} defaultValue={settings.overtime_grace_minutes} />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="GST" description="Off: bills are plain receipts. On: tax invoices with CGST and SGST.">
          <div className="flex flex-col gap-4">
            <Toggle name="gst_enabled" checked={gstOn} onChange={setGstOn} label="Charge GST" />
            <div className={cx("grid gap-3 sm:grid-cols-2", !gstOn && "opacity-50")}>
              <Field label="GSTIN">
                <Input name="gstin" defaultValue={settings.gstin ?? ""} placeholder="27ABCDE1234F1Z5" />
              </Field>
              <Field label="GST rate (%)" hint="A rate can override this under Pricing.">
                <Input name="gst_rate" type="number" min={0} max={28} step="0.01" defaultValue={settings.gst_rate} />
              </Field>
            </div>
            <div className="border-t border-line pt-4">
              <Toggle
                name="prices_include_tax"
                checked={inclusive}
                onChange={setInclusive}
                label="Prices include GST"
                description={
                  inclusive
                    ? "₹100/hr means the player pays ₹100; the tax is inside it."
                    : "₹100/hr means the player pays ₹100 + GST."
                }
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Timer modes"
          description="Open time counts up. Fixed time counts down from the time booked. Both are paid at the end."
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Station</th>
                  {SESSION_MODES.map((m) => (
                    <th key={m} className="px-3 py-2.5 text-center font-medium">
                      {SESSION_MODE_LABEL[m]}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">Starts as</th>
                </tr>
              </thead>
              <tbody>
                {/* Types the venue doesn't have stay in the form (hidden) so their values are kept. */}
                {STATION_TYPES.map((type) => (
                  <tr key={type} className={cx("border-b border-line last:border-0", !types.includes(type) && "hidden")}>
                    <td className="px-4 py-2 font-medium">{STATION_TYPE_LABEL[type]}</td>
                    {SESSION_MODES.map((mode) => (
                      <td key={mode} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          name={`allow_${type}_${mode}`}
                          defaultChecked={allowed?.[type]?.includes(mode) ?? true}
                          aria-label={`${STATION_TYPE_LABEL[type]}: ${SESSION_MODE_LABEL[mode]}`}
                          className="size-4"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2">
                      <Select name={`default_${type}`} defaultValue={defaults?.[type] ?? "open"} className="h-8 w-32">
                        {SESSION_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {SESSION_MODE_LABEL[mode]}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsSection>
        <SettingsSection
          title="Fixed time stopped early"
          description="Someone books 2 hours but leaves after 1. What do they pay?"
        >
          <div className="flex flex-col gap-3">
            {(
              [
                ["full", "The full booking", "They booked 2 hours, so they pay for 2 hours."],
                [
                  "played",
                  "Only the time played",
                  "1 hour at your hourly rate (minimum charge and rounding apply), never more than the booking price.",
                ],
              ] as const
            ).map(([value, label, help]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="early_end_policy"
                  value={value}
                  defaultChecked={settings.early_end_policy === value}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[13px] text-muted">{help}</span>
                </span>
              </label>
            ))}
            <p className="border-t border-line pt-3 text-xs text-muted">
              If the booking was paid up front, it stays final either way, so there are no refunds to track.
            </p>
          </div>
        </SettingsSection>
      </fieldset>

      {!disabled && (
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-10 -mx-1 rounded-lg border border-line bg-panel/95 px-3 py-2.5 backdrop-blur md:bottom-3">
          <SaveBar>
            <FormMessage state={state} />
            <SubmitButton>Save billing</SubmitButton>
          </SaveBar>
        </div>
      )}
    </form>
  );
}
