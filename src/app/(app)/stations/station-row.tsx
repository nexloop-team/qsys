"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteStation, updateStation } from "./actions";
import { STATION_STATUS_LABEL, STATION_STATUSES, type StationStatus, type StationType } from "@/lib/constants";
import type { DeviceStatus } from "@/lib/devices";
import type { ActionState } from "@/lib/action-state";
import { Badge } from "@/components/card";
import { Button, FormMessage, Input, Select, SubmitButton, cx } from "@/components/ui";
import { PcAppCell } from "./pc-app-cell";

type Station = {
  id: string;
  name: string;
  type: StationType;
  tier: string;
  zone: string | null;
  status: StationStatus;
};

const STATUS_TONE = { active: "free", maintenance: "ending", disabled: "neutral" } as const;

// One station: a table row on wider screens, a card on phones (`card`), with the same
// edit-in-place form either way.
export function StationRow({
  station,
  editable,
  pcColumn,
  device,
  card = false,
}: {
  station: Station;
  editable: boolean;
  /** The table has a "PC app" column (the venue has PCs). */
  pcColumn: boolean;
  device: DeviceStatus | undefined;
  card?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await updateStation(prev, fd);
    if (result?.ok) setEditing(false);
    return result;
  }, null);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string>();

  const editForm = (
    <form action={action} className={cx("flex flex-wrap items-center gap-2", card && "grid grid-cols-2")}>
      <input type="hidden" name="id" value={station.id} />
      <Input name="name" defaultValue={station.name} aria-label="Name" className={card ? "" : "w-32"} required />
      <Input name="tier" defaultValue={station.tier} aria-label="Tier" className={card ? "" : "w-28"} required />
      <Input name="zone" defaultValue={station.zone ?? ""} aria-label="Zone" placeholder="Zone" className={card ? "" : "w-36"} />
      <Select name="status" defaultValue={station.status} aria-label="Status" className={card ? "" : "w-36"}>
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
      <div className={card ? "col-span-2" : ""}>
        <FormMessage state={state} />
      </div>
    </form>
  );

  const actions = editable && (
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
  );

  const pcApp =
    station.type === "pc" ? (
      <PcAppCell stationId={station.id} stationName={station.name} device={device} editable={editable} />
    ) : null;

  if (card) {
    // Phones: only what differs from normal is shown (a tier other than standard, a zone, a status
    // other than active). Delete is rare and final, so it lives in the edit form, not on every card.
    const details = [station.tier !== "standard" ? station.tier : null, station.zone].filter(Boolean).join(" · ");
    return (
      <li className="px-4 py-3">
        {editing ? (
          <div className="flex flex-col gap-3">
            {editForm}
            {editable && (
              <button
                type="button"
                disabled={deleting}
                className="self-start text-xs font-medium text-danger underline-offset-4 hover:underline disabled:opacity-50"
                onClick={() => {
                  if (!confirm(`Delete ${station.name}? This can't be undone.`)) return;
                  startDelete(async () => setDeleteError((await deleteStation(station.id))?.error));
                }}
              >
                Delete {station.name}
              </button>
            )}
            {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {station.name}
                  {station.status !== "active" && (
                    <Badge tone={STATUS_TONE[station.status]}>{STATION_STATUS_LABEL[station.status]}</Badge>
                  )}
                </p>
                {details && <p className="mt-0.5 text-xs capitalize text-muted">{details}</p>}
              </div>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${station.name}`}>
                  <Pencil />
                </Button>
              )}
            </div>
            {pcApp}
          </div>
        )}
      </li>
    );
  }

  if (editing) {
    return (
      <tr className="border-t border-line">
        <td colSpan={pcColumn ? 6 : 5} className="px-4 py-3">
          {editForm}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-line hover:bg-subtle/60">
      <td className="px-4 py-2.5 font-medium">{station.name}</td>
      <td className="px-4 py-2.5 text-muted">{station.tier}</td>
      <td className="px-4 py-2.5 text-muted">{station.zone ?? ""}</td>
      <td className="px-4 py-2.5">
        <Badge tone={STATUS_TONE[station.status]}>{STATION_STATUS_LABEL[station.status]}</Badge>
      </td>
      {pcColumn && <td className="px-4 py-2.5">{pcApp ?? <span className="text-xs text-faint">Not set up</span>}</td>}
      <td className="px-4 py-2.5 text-right">
        {actions}
        {deleteError && <p className="mt-1 text-xs text-danger">{deleteError}</p>}
      </td>
    </tr>
  );
}
