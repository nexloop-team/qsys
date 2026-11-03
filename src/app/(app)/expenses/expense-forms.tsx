"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton, Textarea, cx } from "@/components/ui";
import { addExpense, deleteExpense } from "./actions";
import { CATEGORY_ICON } from "./category-icons";

export type TeamMember = { id: string; name: string; role: string; lastSalary: number | null };

type Preset = { category?: ExpenseCategory; staffId?: string; amount?: number };

// "Add expense" (or "Log salary") button that opens the form in a dialog.
export function AddExpenseButton({
  team,
  today,
  preset,
  label = "Add expense",
  variant = "primary",
  size = "md",
}: {
  team: TeamMember[];
  today: string;
  preset?: Preset;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it starts clean.
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus /> {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={preset?.category === "salary" ? "Log salary" : "Add expense"}
        description="Counted against this branch's revenue in Reports."
      >
        <ExpenseForm key={formKey} team={team} today={today} preset={preset} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function ExpenseForm({
  team,
  today,
  preset,
  onDone,
}: {
  team: TeamMember[];
  today: string;
  preset?: Preset;
  onDone: () => void;
}) {
  const [state, action] = useActionState(addExpense, null);
  const [category, setCategory] = useState<ExpenseCategory>(preset?.category ?? "electricity");
  const [staffId, setStaffId] = useState(preset?.staffId ?? "");
  const [amount, setAmount] = useState(preset?.amount ? String(preset.amount) : "");

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const pickStaff = (id: string) => {
    setStaffId(id);
    const last = team.find((m) => m.id === id)?.lastSalary;
    if (last && !amount) setAmount(String(last));
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="category" value={category} />
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Category</legend>
        <div role="radiogroup" className="grid grid-cols-4 gap-1.5">
          {EXPENSE_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c)}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-center text-xs font-medium leading-tight transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                <Icon className={cx("size-4 shrink-0", active ? "text-accent-ink" : "text-faint")} />
                <span>{EXPENSE_CATEGORY_LABEL[c]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {category === "salary" &&
        (team.length === 0 ? (
          <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] text-muted">
            Add staff in Settings → Team first, then log their salary here.
          </p>
        ) : (
          <Field label="Paid to">
            <Select name="staff_id" value={staffId} onChange={(e) => pickStaff(e.target.value)} required>
              <option value="" disabled>
                Pick a team member
              </option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
                  {m.lastSalary ? ` (last ${formatINR(m.lastSalary)})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ))}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)">
          <Input
            name="amount"
            type="number"
            inputMode="decimal"
            min={1}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            required
          />
        </Field>
        <Field label="Date">
          <Input name="spent_on" type="date" defaultValue={today} max={today} required />
        </Field>
      </div>

      <Field
        label="Description (optional)"
        hint={category === "salary" ? 'Defaults to "Salary · name".' : `Defaults to "${EXPENSE_CATEGORY_LABEL[category]}".`}
      >
        <Input
          name="description"
          maxLength={80}
          placeholder={category === "salary" ? "e.g. November salary" : "e.g. October bill"}
        />
      </Field>

      <Field label="Note (optional)">
        <Textarea name="note" maxLength={200} rows={2} placeholder="Bill number, who paid, anything to remember" />
      </Field>

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>Save expense</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteExpenseButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${name}"?`)) return;
        start(async () => {
          const result = await deleteExpense(id);
          if (result?.error) alert(result.error);
        });
      }}
      aria-label={`Delete ${name}`}
      title="Delete"
      className="rounded-lg p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
