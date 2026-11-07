// Class helpers usable from both Server and Client Components.

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  // Black on light, white on dark: the only "brand" colour is the text colour itself.
  primary: "bg-accent text-accent-fg hover:bg-accent/85 active:bg-accent/80",
  secondary: "border border-line-strong bg-panel text-fg hover:bg-hover active:bg-subtle",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "border border-danger/40 bg-panel text-danger hover:bg-danger/10",
};

// Compact for a mouse; finger-sized (40–48px) on phones and tablets at the counter.
const SIZE: Record<Size, string> = {
  sm: "h-8 pointer-coarse:h-10 rounded-md px-2.5 pointer-coarse:px-3 text-[13px] gap-1.5",
  md: "h-9 pointer-coarse:h-11 rounded-lg px-3.5 text-sm gap-2",
  lg: "h-11 pointer-coarse:h-12 rounded-lg px-5 text-[15px] gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium transition-[background-color,border-color,color,box-shadow] select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
