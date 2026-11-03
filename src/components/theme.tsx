"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "./styles";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "qs-theme";
const EVENT = "qs-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

// Stamps the theme on <html>; a short-lived class cross-fades colors on a manual switch.
function apply(pref: ThemePreference, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 220);
  }
  root.dataset.theme = resolve(pref);
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private mode): the switch still applies for this page view.
  }
  apply(pref, true);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      apply(readPreference(), true);
      onChange();
    }
  };
  // Follow the OS while the preference is "system".
  const onMedia = () => {
    if (readPreference() === "system") apply("system", true);
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onMedia);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  };
}

// [preference, resolved theme]. The server snapshot is "system"/"light"; the real
// values arrive right after hydration, and <html data-theme> is already correct.
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolve(readPreference()),
    () => "light" as const,
  );

  return { preference, resolved };
}

// Compact light/dark switch for top bars.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cx(
        "relative grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel text-muted shadow-xs transition-colors hover:bg-hover hover:text-fg",
        className,
      )}
    >
      <Sun className="size-4 scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-4 scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0" />
    </button>
  );
}

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// Three-way picker (Settings → Account → Appearance).
export function ThemePicker() {
  const { preference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setThemePreference(value)}
            className={cx(
              "flex flex-col items-start gap-2 rounded-xl border p-2 text-left transition-colors",
              active ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-hover",
            )}
          >
            <ThemeSwatch kind={value} />
            <span className="flex items-center gap-1.5 px-1 pb-0.5 text-[13px] font-medium">
              <Icon className={cx("size-3.5", active ? "text-accent-ink" : "text-muted")} />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Tiny app mock in fixed colors, so each option previews its own theme.
function ThemeSwatch({ kind }: { kind: ThemePreference }) {
  const half = (dark: boolean) => (
    <div className={cx("flex h-full flex-1 gap-1 p-1.5", dark ? "bg-[#0a0b0e]" : "bg-[#f6f7f9]")}>
      <div className={cx("w-3 rounded-[3px]", dark ? "bg-[#17191f]" : "bg-white")} />
      <div className={cx("flex flex-1 flex-col gap-1 rounded-[3px] p-1", dark ? "bg-[#111217]" : "bg-white")}>
        <div className={cx("h-1 w-2/3 rounded-full", dark ? "bg-[#30333c]" : "bg-[#d5d8de]")} />
        <div className="h-1 w-1/3 rounded-full bg-[#5b5fe9]" />
      </div>
    </div>
  );
  return (
    <div aria-hidden className="flex h-14 w-full overflow-hidden rounded-lg border border-line">
      {kind === "light" && half(false)}
      {kind === "dark" && half(true)}
      {kind === "system" && (
        <>
          {half(false)}
          {half(true)}
        </>
      )}
    </div>
  );
}
