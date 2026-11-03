import type { Enums } from "@/lib/database.types";

export type StationType = Enums<"station_type">;
export type SessionMode = Enums<"session_mode">;
export type MemberRole = Enums<"member_role">;
export type StationStatus = Enums<"station_status">;
export type ExpenseCategory = Enums<"expense_category">;

export const STATION_TYPES: StationType[] = ["pc", "ps5", "xbox", "pool", "snooker", "other"];

export const STATION_TYPE_LABEL: Record<StationType, string> = {
  pc: "PC",
  ps5: "PS5",
  xbox: "Xbox",
  pool: "8-ball pool",
  snooker: "Snooker",
  other: "Other",
};

export const STATION_TYPE_PREFIX: Record<StationType, string> = {
  pc: "PC-",
  ps5: "PS5-",
  xbox: "XBOX-",
  pool: "POOL-",
  snooker: "SNOOKER-",
  other: "ST-",
};

export const SESSION_MODES: SessionMode[] = ["open", "prepaid"];

// Both modes are paid at the end. The DB value "prepaid" means fixed time (countdown).
export const SESSION_MODE_LABEL: Record<SessionMode, string> = {
  open: "Open time",
  prepaid: "Fixed time",
};

export const SESSION_MODE_HINT: Record<SessionMode, string> = {
  open: "Timer counts up. Player pays for the minutes played.",
  prepaid: "Timer counts down from the time they book. Alert at zero. Paid at the end.",
};

export const STATION_STATUSES: StationStatus[] = ["active", "maintenance", "disabled"];

export const STATION_STATUS_LABEL: Record<StationStatus, string> = {
  active: "Active",
  maintenance: "Maintenance",
  disabled: "Disabled",
};

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  manager: "Staff", // legacy value, migrated to staff
  staff: "Staff",
};

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "salary",
  "rent",
  "electricity",
  "internet",
  "maintenance",
  "supplies",
  "marketing",
  "other",
];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  salary: "Salary",
  rent: "Rent",
  electricity: "Electricity",
  internet: "Internet",
  maintenance: "Repairs & upkeep",
  supplies: "Supplies & snacks",
  marketing: "Marketing",
  other: "Other",
};
