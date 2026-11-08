"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { bulkCreateStations } from "./actions";
import { STATION_TYPE_LABEL, STATION_TYPE_PREFIX, type StationType } from "@/lib/constants";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

export function AddStationsButton({
  nextNumber,
  branchName,
  types,
}: {
  nextNumber: Record<StationType, number>;
  branchName: string;
  types: StationType[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Add stations
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Add stations" description={`To ${branchName}`}>
        <BulkAddForm nextNumber={nextNumber} types={types} onAdded={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function BulkAddForm({
  nextNumber,
  types,
  onAdded,
}: {
  nextNumber: Record<StationType, number>;
  types: StationType[];
  onAdded: () => void;
}) {
  const [state, action] = useActionState(bulkCreateStations, null);
  const [type, setType] = useState<StationType>(types[0] ?? "pc");
  const [prefix, setPrefix] = useState(STATION_TYPE_PREFIX[types[0] ?? "pc"]);
  const [count, setCount] = useState(10);
  const start = nextNumber[type];

  useEffect(() => {
    if (state?.ok) onAdded();
  }, [state, onAdded]);

  const width = Math.max(2, String(start + count - 1).length);
  const label = (n: number) => `${prefix}${String(n).padStart(width, "0")}`;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            name="type"
            value={type}
            onChange={(e) => {
              const t = e.target.value as StationType;
              setType(t);
              setPrefix(STATION_TYPE_PREFIX[t]);
            }}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {STATION_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How many">
          <Input
            name="count"
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            required
          />
        </Field>
        <Field label="Name prefix">
          <Input name="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} required />
        </Field>
        <Field label="Tier" hint="Different tiers can have different prices.">
          <Input name="tier" defaultValue="standard" />
        </Field>
        <Field label="Zone (optional)" className="col-span-2">
          <Input name="zone" placeholder="Ground floor, VIP room" />
        </Field>
      </div>
      <input type="hidden" name="start" value={start} />

      <div className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-[13px]">
        Creates <span className="num font-medium">{count > 1 ? `${label(start)} … ${label(start + count - 1)}` : label(start)}</span>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Adding…">
        Add {count} {count === 1 ? "station" : "stations"}
      </SubmitButton>
    </form>
  );
}
