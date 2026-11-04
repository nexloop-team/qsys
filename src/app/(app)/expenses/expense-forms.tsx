"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Modal } from "@/components/overlay";
import { Button, Field, FormMessage, Input, Select, SubmitButton, Textarea, cx } from "@/components/ui";
import { deleteExpense, saveExpense } from "./actions";
import { CATEGORY_ICON } from "./category-icons";

export type TeamMember = { id: string; name: string; role: string; lastSalary: number | null };

export type Preset = {
  category?: ExpenseCategory;
  staffId?: string;
  amount?: number;
  description?: string;
  repeats?: boolean;
};

/** An existing expense, for editing. */
export type EditableExpense = {
  id: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  spent_on: string;
  staff_id: string | null;
  note: string | null;
  repeats_monthly: boolean;
};

// Costs that usually come back every month start with "repeats" ticked.
const USUALLY_MONTHLY = new Set<ExpenseCategory>(["salary", "rent", "internet"]);

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

// Pencil button that opens the same form filled with an existing expense.
export function EditExpenseButton({ expense, team, today }: { expense: EditableExpense; team: TeamMember[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${expense.name}`}
        title="Edit"
        className="rounded-lg p-1.5 text-faint transition-colors hover:bg-hover hover:text-fg"
      >
        <Pencil className="size-4" />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={`Edit ${expense.name}`}>
        {open && <ExpenseForm team={team} today={today} expense={expense} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function ExpenseForm({
  team,
  today,
  preset,
  expense,
  onDone,
}: {
  team: TeamMember[];
  today: string;
  preset?: Preset;
  expense?: EditableExpense;
  onDone: () => void;
}) {
  const [state, action] = useActionState(saveExpense, null);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? preset?.category ?? "electricity");
  const [staffId, setStaffId] = useState(expense?.staff_id ?? preset?.staffId ?? "");
  const initialAmount = expense?.amount ?? preset?.amount;
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [repeats, setRepeats] = useState(
    expense?.repeats_monthly ?? preset?.repeats ?? USUALLY_MONTHLY.has(preset?.category ?? "electricity"),
  );
  const [touchedRepeats, setTouchedRepeats] = useState(Boolean(expense || preset?.repeats !== undefined));

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
      {expense && <input type="hidden" name="id" value={expense.id} />}
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
                onClick={() => {
                  setCategory(c);
                  if (!touchedRepeats) setRepeats(USUALLY_MONTHLY.has(c));
                }}
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
          <Input name="spent_on" type="date" defaultValue={expense?.spent_on ?? today} max={today} required />
        </Field>
      </div>

      <Field
        label="Description (optional)"
        hint={category === "salary" ? 'Defaults to "Salary · name".' : `Defaults to "${EXPENSE_CATEGORY_LABEL[category]}".`}
      >
        <Input
          name="description"
          maxLength={80}
          defaultValue={expense?.name ?? preset?.description}
          placeholder={category === "salary" ? "e.g. November salary" : "e.g. October bill"}
        />
      </Field>

      <Field label="Note (optional)">
        <Textarea
          name="note"
          maxLength={200}
          rows={2}
          defaultValue={expense?.note ?? ""}
          placeholder="Bill number, who paid, anything to remember"
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-subtle/50 px-3 py-2.5">
        <input
          type="checkbox"
          name="repeats_monthly"
          checked={repeats}
          onChange={(e) => {
            setRepeats(e.target.checked);
            setTouchedRepeats(true);
          }}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Repeat className="size-3.5 text-muted" /> Repeats every month
          </span>
          <span className="block text-xs text-muted">Shows under &quot;Due this month&quot; until you log it again.</span>
        </span>
      </label>

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>{expense ? "Save changes" : "Save expense"}</SubmitButton>
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
