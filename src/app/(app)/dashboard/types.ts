import type { PricingPlan, PricingRule } from "@/lib/pricing";
import type { MemberRole, SessionMode, StationStatus, StationType } from "@/lib/constants";

export type FloorStation = {
  id: string;
  name: string;
  type: StationType;
  tier: string;
  status: StationStatus;
  zone: string | null;
  layout_x: number | null;
  layout_y: number | null;
  layout_rot: number;
};

export type LiveSession = {
  id: string;
  station_id: string;
  rate_plan_id: string;
  mode: SessionMode;
  status: "running" | "paused" | "ended";
  customer_name: string | null;
  customer_phone: string | null;
  players: number;
  started_at: string;
  planned_end_at: string | null;
  prepaid_minutes: number;
  prepaid_amount: number;
  paused_at: string | null;
  ended_at: string | null;
  charge_amount: number | null;
  billed_amount: number;
  outstanding: number;
  session_pauses: { started_at: string; ended_at: string | null }[];
};

export type FloorPlan = PricingPlan & {
  station_type: StationType;
  tier: string | null;
  is_active: boolean;
  gst_rate_override: number | null;
  rate_rules: PricingRule[];
};

export type FloorPackage = {
  id: string;
  name: string;
  station_type: StationType;
  tier: string | null;
  minutes: number;
  price: number;
};

export type FloorSettings = {
  allowed: Record<StationType, SessionMode[]>;
  defaults: Record<StationType, SessionMode>;
  graceMinutes: number;
  earlyEndPolicy: "full" | "played";
  gstEnabled: boolean;
  gstRate: number;
  pricesIncludeTax: boolean;
  /** Counter UPI ID for the checkout QR; null until set in Settings → Billing. */
  upi: { vpa: string; name: string } | null;
};

export type FloorData = {
  branch: { id: string; name: string; timezone: string };
  /** Branch closing time ("HH:MM:SS"), shown as "open till …" when set. */
  closingTime: string | null;
  orgId: string;
  orgName: string;
  role: MemberRole;
  serverNow: string;
  stations: FloorStation[];
  sessions: LiveSession[];
  plans: FloorPlan[];
  packages: FloorPackage[];
  settings: FloorSettings;
};

export const SESSION_SELECT =
  "id, station_id, rate_plan_id, mode, status, customer_name, customer_phone, players, started_at, planned_end_at, prepaid_minutes, prepaid_amount, paused_at, ended_at, charge_amount, billed_amount, outstanding, session_pauses(started_at, ended_at)";

// Live state of a station tile, derived each tick.
export type TileState = "free" | "busy" | "ending" | "over" | "paused" | "off";

export const ENDING_SOON_SECONDS = 5 * 60;
