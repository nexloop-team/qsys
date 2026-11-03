"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteStation, updateStation } from "./actions";
import { STATION_STATUS_LABEL, STATION_STATUSES, type StationStatus } from "@/lib/constants";
import type { ActionState } from "@/lib/action-state";
import { Badge } from "@/components/card";
import { Button, FormMessage, Input, Select, SubmitButton } from "@/components/ui";

type Station = {
  id: string;
  name: string;
  tier: string;
  zone: string | null;
  status: StationStatus;
};

const STATUS_TONE = { active: "free", maintenance: "ending", disabled: "neutral" } as const;

export function StationRow({ station, editable }: { station: Station; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await updateStation(prev, fd);
    if (result?.ok) setEditing(false);
    return result;
  }, null);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string>();

  if (editing) {
    return (
      <tr className="border-t border-line">
        <td colSpan={5} className="px-4 py-3">
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={station.id} />
            <Input name="name" defaultValue={station.name} aria-label="Name" className="w-32" required />
            <Input name="tier" defaultValue={station.tier} aria-label="Tier" className="w-28" required />
            <Input name="zone" defaultValue={station.zone ?? ""} aria-label="Zone" placeholder="Zone" className="w-36" />
            <Select name="status" defaultValue={station.status} aria-label="Status" className="w-36">
              {STATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATION_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm">Save</SubmitButton>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <FormMessage state={state} />
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-line hover:bg-subtle/60">
      <td className="px-4 py-2.5 font-medium">{station.name}</td>
      <td className="px-4 py-2.5 text-muted">{station.tier}</td>
      <td className="px-4 py-2.5 text-muted">{station.zone ?? "—"}</td>
      <td className="px-4 py-2.5">
        <Badge tone={STATUS_TONE[station.status]}>{STATION_STATUS_LABEL[station.status]}</Badge>
      </td>
      <td className="px-4 py-2.5 text-right">
        {editable && (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${station.name}`}>
              <Pencil />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleting}
              aria-label={`Delete ${station.name}`}
              onClick={() => {
                if (!confirm(`Delete ${station.name}? This can't be undone.`)) return;
                startDelete(async () => setDeleteError((await deleteStation(station.id))?.error));
              }}
            >
              <Trash2 />
            </Button>
          </span>
        )}
        {deleteError && <p className="mt-1 text-xs text-danger">{deleteError}</p>}
      </td>
    </tr>
  );
}
