import type { ReactNode } from "react";
import { Gamepad2, Monitor, Shapes } from "lucide-react";
import { STATION_TYPE_LABEL, STATION_TYPES, type StationType } from "@/lib/constants";

const ICON: Record<StationType, ReactNode> = {
  pc: <Monitor />,
  ps5: <Gamepad2 />,
  xbox: <Gamepad2 />,
  pool: <span className="num text-[11px] font-bold">8</span>,
  snooker: <span className="size-3 rounded-full border-2 border-current" />,
  other: <Shapes />,
};

// Multi-select of the station kinds a venue has. Submits `name` once per checked type.
// Uncontrolled with `defaultValue`, or controlled with `value` + `onChange`.
export function StationTypePicker({
  name,
  defaultValue,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  defaultValue?: StationType[];
  value?: StationType[];
  onChange?: (types: StationType[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STATION_TYPES.map((t) => (
        <label
          key={t}
          className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong px-3 text-sm font-medium transition-colors hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        >
          <input
            type="checkbox"
            name={name}
            value={t}
            {...(value
              ? {
                  checked: value.includes(t),
                  onChange: (e) =>
                    onChange?.(
                      e.target.checked ? STATION_TYPES.filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t),
                    ),
                }
              : { defaultChecked: defaultValue?.includes(t) })}
            disabled={disabled}
            className="size-4"
          />
          <span className="grid size-5 place-items-center text-muted [&_svg]:size-4">{ICON[t]}</span>
          {STATION_TYPE_LABEL[t]}
        </label>
      ))}
    </div>
  );
}
