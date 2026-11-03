"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Pencil, Plus, Search } from "lucide-react";
import { addPlayer, updatePlayer } from "./actions";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, SubmitButton } from "@/components/ui";

export function PlayerSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial);

  // Search as you type, debounced.
  useEffect(() => {
    if (q === initial) return;
    const id = window.setTimeout(() => {
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
    }, 300);
    return () => window.clearTimeout(id);
  }, [q, initial, pathname, router]);

  return (
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-2.5 size-4 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or mobile" className="pl-9" />
    </div>
  );
}

export function AddPlayerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Add player
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Add player">
        <PlayerForm action={addPlayer} onSaved={() => setOpen(false)} submitLabel="Add player" />
      </Modal>
    </>
  );
}

export function EditPlayerButton({ player }: { player: { id: string; name: string; phone: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${player.name}`}>
        <Pencil />
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Edit player">
        <PlayerForm action={updatePlayer} player={player} onSaved={() => setOpen(false)} submitLabel="Save" />
      </Modal>
    </>
  );
}

function PlayerForm({
  action: serverAction,
  player,
  onSaved,
  submitLabel,
}: {
  action: typeof addPlayer;
  player?: { id: string; name: string; phone: string };
  onSaved: () => void;
  submitLabel: string;
}) {
  const [state, action] = useActionState(serverAction, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {player && <input type="hidden" name="id" value={player.id} />}
      <Field label="Mobile">
        <Input
          name="phone"
          type="tel"
          inputMode="numeric"
          defaultValue={player?.phone}
          placeholder="98765 43210"
          className="num"
          required
          autoFocus
        />
      </Field>
      <Field label="Name">
        <Input name="name" defaultValue={player?.name} maxLength={80} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="self-end">{submitLabel}</SubmitButton>
    </form>
  );
}
