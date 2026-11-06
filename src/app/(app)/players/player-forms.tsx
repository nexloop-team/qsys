"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Pencil, Plus, Search, Wallet } from "lucide-react";
import { addPlayer, clearPlayerPin, managePlayerWallet, setPlayerPin, updatePlayer } from "./actions";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Segmented, SubmitButton, cx } from "@/components/ui";
import { formatINR } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

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

export function TopupWalletButton({
  customerId,
  playerName,
  compact = false,
  currentBalance = 0,
  canRefund = false,
  offers = [],
}: {
  customerId: string;
  playerName: string;
  compact?: boolean;
  currentBalance?: number;
  /** Refund, clear and custom bonuses are owner-only. */
  canRefund?: boolean;
  /** Venue top-up offers: pay ≥ `pay`, get `bonus` extra. */
  offers?: { pay: number; bonus: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState<"add" | "deduct" | "clear">("add");
  const [amount, setAmount] = useState("500");
  const [method, setMethod] = useState<"cash" | "upi">("upi");
  const [customBonus, setCustomBonus] = useState("");
  // Same rule as the database: the biggest offer the amount qualifies for.
  const offerBonus = offers.filter((o) => Number(amount) >= o.pay).reduce((m, o) => Math.max(m, o.bonus), 0);
  const bonus = customBonus !== "" ? Number(customBonus) || 0 : offerBonus;
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await managePlayerWallet(prev, fd);
    if (res?.ok) {
      setOpen(false);
      router.refresh();
    }
    return res;
  }, null);

  return (
    <>
      {compact ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          className="h-7 px-2 text-xs gap-1"
          title={`Manage wallet for ${playerName}`}
        >
          <Wallet className="size-3 text-ok" /> Wallet
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} className="gap-1.5">
          <Wallet className="size-4" /> Manage wallet
        </Button>
      )}

      <Modal open={open} onOpenChange={setOpen} title={`Manage wallet · ${playerName}`}>
        <form action={action} className="flex flex-col gap-3.5">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="actionType" value={actionType} />
          <input type="hidden" name="method" value={method} />

          {/* Current balance display */}
          <div className="flex items-center justify-between rounded-xl border border-line bg-subtle/50 px-3.5 py-2.5">
            <span className="text-xs text-muted">Current Balance</span>
            <span className="num text-base font-semibold text-fg">{formatINR(currentBalance)}</span>
          </div>

          {/* Action switcher */}
          <Segmented
            value={actionType}
            onChange={(v) => {
              const next = v as "add" | "deduct" | "clear";
              setActionType(next);
              if (next === "deduct") setAmount(String(Math.min(currentBalance || 500, 500)));
            }}
            className="w-full"
            options={[
              { value: "add", label: "+ Add money" },
              ...(canRefund
                ? [
                    { value: "deduct" as const, label: "− Refund" },
                    { value: "clear" as const, label: "Clear to ₹0" },
                  ]
                : []),
            ]}
          />

          {actionType === "add" && (
            <>
              <Field label="Amount to add (₹)">
                <Input
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500"
                  required
                />
              </Field>

              <div className="flex flex-wrap gap-1.5 -mt-1">
                {[200, 500, 1000, 2000].map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => setAmount(String(quick))}
                    className={cx(
                      "cursor-pointer rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                      Number(amount) === quick
                        ? "border-accent bg-accent-soft text-accent-ink"
                        : "border-line bg-subtle text-muted hover:border-line-strong hover:text-fg",
                    )}
                  >
                    +{formatINR(quick)}
                  </button>
                ))}
              </div>

              {Number(amount) > 0 && (
                <div className="rounded-xl border border-ok/30 bg-ok/8 px-3 py-2 text-xs">
                  {bonus > 0 ? (
                    <>
                      <span className="font-semibold text-ok">
                        {customBonus !== "" ? "Bonus" : "Offer"}: +{formatINR(bonus)}
                      </span>
                      <span className="text-muted">
                        {" "}
                        · balance becomes {formatINR(currentBalance + Number(amount) + bonus)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">
                      Balance becomes {formatINR(currentBalance + Number(amount))}
                      {offers.length > 0 && ` · offers start at ${formatINR(Math.min(...offers.map((o) => o.pay)))}`}
                    </span>
                  )}
                </div>
              )}

              {canRefund && (
                <Field label="Custom bonus (₹, optional)" hint="Owner only. Leave empty to use your offers.">
                  <Input
                    name="bonus"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={customBonus}
                    onChange={(e) => setCustomBonus(e.target.value)}
                    placeholder={offerBonus ? String(offerBonus) : "0"}
                  />
                </Field>
              )}

              <Field label="Payment received via">
                <Segmented
                  value={method}
                  onChange={setMethod}
                  className="w-full"
                  options={[
                    { value: "upi", label: "UPI" },
                    { value: "cash", label: "Cash" },
                  ]}
                />
              </Field>

              <Field label="Note (optional)" hint="e.g. Advance deposit, Festival promo">
                <Input name="note" placeholder="Deposit" maxLength={100} />
              </Field>
            </>
          )}

          {actionType === "deduct" && (
            <>
              <Field label="Amount to deduct / refund (₹)">
                <Input
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={currentBalance > 0 ? currentBalance : undefined}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500"
                  required
                />
              </Field>

              {currentBalance > 0 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {[200, 500, 1000]
                    .filter((q) => q <= currentBalance)
                    .map((quick) => (
                      <button
                        key={quick}
                        type="button"
                        onClick={() => setAmount(String(quick))}
                        className={cx(
                          "cursor-pointer rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                          Number(amount) === quick
                            ? "border-accent bg-accent-soft text-accent-ink"
                            : "border-line bg-subtle text-muted hover:border-line-strong hover:text-fg",
                        )}
                      >
                        −{formatINR(quick)}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => setAmount(String(currentBalance))}
                    className="cursor-pointer rounded-md border border-line bg-subtle px-2.5 py-1 text-xs font-semibold text-muted hover:border-line-strong hover:text-fg"
                  >
                    All ({formatINR(currentBalance)})
                  </button>
                </div>
              )}

              <Field label="Refund given via">
                <Segmented
                  value={method}
                  onChange={setMethod}
                  className="w-full"
                  options={[
                    { value: "cash", label: "Cash" },
                    { value: "upi", label: "UPI" },
                  ]}
                />
              </Field>

              <Field label="Reason / Note (optional)" hint="e.g. Customer refund, balance adjustment">
                <Input name="note" placeholder="Refund" maxLength={100} />
              </Field>
            </>
          )}

          {actionType === "clear" && (
            <div className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-danger">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Delete / Reset balance to ₹0</span>
              </div>
              <p className="text-muted leading-relaxed">
                This will delete and clear the entire current balance of{" "}
                <span className="font-semibold text-fg">{formatINR(currentBalance)}</span> for {playerName}.
              </p>
              <Field label="Reason (optional)">
                <Input name="note" placeholder="Test balance cleanup / reset" maxLength={100} />
              </Field>
            </div>
          )}

          <FormMessage state={state} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {actionType === "add" && (
              <SubmitButton pendingText="Adding…">
                Add {amount ? formatINR(Number(amount)) : "credit"}
              </SubmitButton>
            )}
            {actionType === "deduct" && (
              <SubmitButton pendingText="Deducting…">
                Deduct {amount ? formatINR(Number(amount)) : "amount"}
              </SubmitButton>
            )}
            {actionType === "clear" && (
              <SubmitButton variant="danger" pendingText="Clearing…">
                Clear balance to ₹0
              </SubmitButton>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

// PC login: the player types their mobile + this PIN on a free PC's lock screen to start playing.
export function PcPinButton({ customerId, playerName, pinSet }: { customerId: string; playerName: string; pinSet: boolean }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await setPlayerPin(prev, fd);
    if (result?.ok) setOpen(false);
    return result;
  }, null);
  const router = useRouter();

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    const result = await clearPlayerPin(customerId);
    setRemoving(false);
    if (result.error) return setRemoveError(result.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <KeyRound /> {pinSet ? "Change PIN" : "Set PIN"}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={pinSet ? "Change PC login PIN" : "Set PC login PIN"}
        description={`${playerName} types their mobile number and this PIN on a free PC to start playing. They pay at the counter at the end.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="New PIN" hint="4 digits, chosen by the player">
              <Input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" className="num" required autoFocus />
            </Field>
            <Field label="Repeat PIN">
              <Input name="pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" className="num" required />
            </Field>
          </div>
          <FormMessage state={state ?? (removeError ? { error: removeError } : null)} />
          <div className="flex items-center gap-2">
            {pinSet && (
              <Button variant="ghost" size="sm" className="text-danger" onClick={remove} disabled={removing}>
                {removing ? "Removing…" : "Remove PIN"}
              </Button>
            )}
            <SubmitButton className="ml-auto">Save PIN</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
