// Class helpers usable from both Server and Client Components.

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[0_1px_2px_rgb(16_24_40/0.12),inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-accent/90 active:bg-accent/85",
  secondary: "border border-line-strong bg-panel text-fg shadow-xs hover:bg-hover active:bg-subtle",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "border border-danger/40 bg-panel text-danger shadow-xs hover:bg-danger/10",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 rounded-md px-2.5 text-[13px] gap-1.5",
  md: "h-9 rounded-lg px-3.5 text-sm gap-2",
  lg: "h-11 rounded-lg px-5 text-[15px] gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium transition-[background-color,border-color,color,box-shadow] select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
