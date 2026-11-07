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
import { Field, FormMessage, Input, Select, SubmitButton, Toggle, cx } from "@/components/ui";
import { SaveBar, SettingsSection } from "./section";

type Settings = Tables<"branch_settings">;

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
        <SettingsSection title="Bills" description="Numbering and how much overtime is free on fixed-time sessions.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill number prefix" hint="Bills are numbered PREFIX-00001.">
              <Input name="invoice_prefix" defaultValue={settings.invoice_prefix} />
            </Field>
            <Field label="Overtime grace (minutes)" hint="Fixed-time players aren't charged for this much extra.">
              <Input name="overtime_grace_minutes" type="number" min={0} max={30} defaultValue={settings.overtime_grace_minutes} />
            </Field>
            <Field
              label="Staff discount limit (%)"
              hint="Most a staff member can take off a bill. Every discount needs a reason. You have no limit."
            >
              <Input
                name="staff_max_discount_pct"
                type="number"
                min={0}
                max={100}
                defaultValue={settings.staff_max_discount_pct}
              />
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2.5 font-medium sm:px-4">Station</th>
                  {SESSION_MODES.map((m) => (
                    <th key={m} className="px-1.5 py-2.5 text-center font-medium sm:px-3">
                      {SESSION_MODE_LABEL[m]}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-medium sm:px-4">Starts as</th>
                </tr>
              </thead>
              <tbody>
                {/* Types the venue doesn't have stay in the form (hidden) so their values are kept. */}
                {STATION_TYPES.map((type) => (
                  <tr key={type} className={cx("border-b border-line last:border-0", !types.includes(type) && "hidden")}>
                    <td className="px-3 py-2 font-medium sm:px-4">{STATION_TYPE_LABEL[type]}</td>
                    {SESSION_MODES.map((mode) => (
                      <td key={mode} className="px-1.5 py-2 text-center sm:px-3">
                        <input
                          type="checkbox"
                          name={`allow_${type}_${mode}`}
                          defaultChecked={allowed?.[type]?.includes(mode) ?? true}
                          aria-label={`${STATION_TYPE_LABEL[type]}: ${SESSION_MODE_LABEL[mode]}`}
                          className="size-4 pointer-coarse:size-5"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 sm:px-4">
                      <Select name={`default_${type}`} defaultValue={defaults?.[type] ?? "open"} className="h-8 w-28 sm:w-32">
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
        <SaveBar>
          <FormMessage state={state} />
          <SubmitButton>Save billing</SubmitButton>
        </SaveBar>
      )}
    </form>
  );
}
