"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { addPackage } from "./actions";
import { STATION_TYPE_LABEL, type StationType } from "@/lib/constants";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

export function PackageDialogButton({ stationType, tiers }: { stationType: StationType; tiers: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus /> Package
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`New ${STATION_TYPE_LABEL[stationType]} package`}>
        <PackageForm stationType={stationType} tiers={tiers} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function PackageForm({
  stationType,
  tiers,
  onSaved,
}: {
  stationType: StationType;
  tiers: string[];
  onSaved: () => void;
}) {
  const [state, action] = useActionState(addPackage, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="station_type" value={stationType} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input name="name" placeholder="3 hours" required />
        </Field>
        <Field label="Hours">
          <Input name="hours" type="number" min={0} max={24} defaultValue={1} required />
        </Field>
        <Field label="Minutes">
          <Input name="mins" type="number" min={0} max={59} defaultValue={0} required />
        </Field>
        <Field label="Price (₹)">
          <Input name="price" type="number" min={0} step="0.01" required />
        </Field>
        <Field label="Applies to">
          <Select name="tier" defaultValue="">
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
      <SubmitButton className="self-end">Add package</SubmitButton>
    </form>
  );
}
