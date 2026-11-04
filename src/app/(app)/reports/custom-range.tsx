"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Modal } from "@/components/overlay";
import { Button, Field, Input, cx } from "@/components/ui";

// "Custom" period: pick any from–to dates up to today (max one year).
export function CustomRange({ from, to, max, active }: { from: string; to: string; max: string; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const valid = Boolean(a && b && a <= b && b <= max);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={cx(active && "border-accent bg-accent-soft")}
        onClick={() => {
          setA(from);
          setB(to);
          setOpen(true);
        }}
      >
        <CalendarRange /> {active ? "Custom" : "Pick dates"}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Custom period" description="Up to one year, ending today at the latest.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            setOpen(false);
            router.push(`/reports?range=custom&from=${a}&to=${b}`);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input type="date" value={a} max={b || max} onChange={(e) => setA(e.target.value)} required />
            </Field>
            <Field label="To">
              <Input type="date" value={b} min={a} max={max} onChange={(e) => setB(e.target.value)} required />
            </Field>
          </div>
          <p className="text-xs text-muted">Changes are compared with the same number of days just before.</p>
          <Button type="submit" disabled={!valid} className="self-end">
            Show report
          </Button>
        </form>
      </Modal>
    </>
  );
}
