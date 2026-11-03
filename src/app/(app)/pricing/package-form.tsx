"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { savePackage } from "./actions";
import { STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

export type PackageValues = { id: string; name: string; minutes: number; price: number; tier: string | null };

// "Package" (add) or a pencil (edit an existing package).
export function PackageDialogButton({
  stationType,
  tiers,
  pkg,
}: {
  stationType: StationType;
  tiers: string[];
  pkg?: PackageValues;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {pkg ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${pkg.name}`} title="Edit">
          <Pencil />
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Plus /> Package
        </Button>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={pkg ? `Edit ${pkg.name}` : `New ${STATION_TYPE_LABEL[stationType]} package`}
      >
        {open && <PackageForm stationType={stationType} tiers={tiers} pkg={pkg} onSaved={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function PackageForm({
  stationType,
  tiers,
  pkg,
  onSaved,
}: {
  stationType: StationType;
  tiers: string[];
  pkg?: PackageValues;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(savePackage, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="station_type" value={stationType} />
      {pkg && <input type="hidden" name="id" value={pkg.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input name="name" placeholder="3 hours" defaultValue={pkg?.name} required />
        </Field>
        <Field label="Hours">
          <Input name="hours" type="number" min={0} max={24} defaultValue={pkg ? Math.floor(pkg.minutes / 60) : 1} required />
        </Field>
        <Field label="Minutes">
          <Input name="mins" type="number" min={0} max={59} defaultValue={pkg ? pkg.minutes % 60 : 0} required />
        </Field>
        <Field label="Price (₹)">
          <Input name="price" type="number" min={0} step="0.01" defaultValue={pkg?.price} required />
        </Field>
        <Field label="Applies to">
          <Select name="tier" defaultValue={pkg?.tier ?? ""}>
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton className="self-end">{pkg ? "Save package" : "Add package"}</SubmitButton>
    </form>
  );
}
