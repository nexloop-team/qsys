"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui";

export function DatePicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Input
      type="date"
      value={value}
      aria-label="Date"
      className="w-auto"
      onChange={(e) => e.target.value && router.push(`${pathname}?date=${e.target.value}`)}
    />
  );
}
