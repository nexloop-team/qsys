"use client";

import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { buttonClass, cx, type Size, type Variant } from "./styles";

export { buttonClass, cx };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

// Submit button that disables itself while its form's action runs.
export function SubmitButton({
  children,
  pendingText,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

const FIELD =
  "h-9 w-full rounded-lg border border-line-strong bg-panel px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-faint hover:border-faint/70 focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:opacity-60 aria-invalid:border-danger";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "h-auto min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, "pr-8", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } | null }) {
  if (state?.error)
    return (
      <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
        <CircleAlert className="size-4 shrink-0" /> {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-ok">
        <CircleCheck className="size-4 shrink-0" /> {state.ok}
      </p>
    );
  return null;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{children}</p>;
}

// Two-to-four option toggle (payment mode, method, date range).
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  className?: string;
  name?: string;
}) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-lg border border-line bg-subtle p-0.5", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 [&_svg]:size-4",
            value === o.value
              ? "bg-panel text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.06)]"
              : "text-muted hover:text-fg",
          )}
        >
          <span className="inline-flex items-center justify-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// On/off switch backed by a real checkbox, so it posts with the form ("on" when checked).
export function Toggle({
  name,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-[13px] text-muted">{description}</span>}
      </span>
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
          checked ? "border-accent bg-accent" : "border-line-strong bg-subtle",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-3.5 rounded-full transition-all",
            checked ? "left-[18px] bg-white shadow-xs" : "left-0.5 bg-faint",
          )}
        />
      </span>
    </label>
  );
}
