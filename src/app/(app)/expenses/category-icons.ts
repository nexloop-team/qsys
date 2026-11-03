import {
  CircleEllipsis,
  House,
  Megaphone,
  Package,
  Users,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ExpenseCategory } from "@/lib/constants";

// Shared by the server view and the client form (so it can't live in a "use client" file).
export const CATEGORY_ICON: Record<ExpenseCategory, LucideIcon> = {
  salary: Users,
  rent: House,
  electricity: Zap,
  internet: Wifi,
  maintenance: Wrench,
  supplies: Package,
  marketing: Megaphone,
  other: CircleEllipsis,
};
