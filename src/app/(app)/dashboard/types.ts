import type { PricingPlan, PricingRule } from "@/lib/pricing";
import type { DeviceStatus } from "@/lib/devices";
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
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  players: number;
  started_at: string;
  planned_end_at: string | null;
  prepaid_minutes: number;
  prepaid_amount: number;
  frames: number;
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
  /** Most a staff member may discount, as % of the bill. The owner has no limit. */
  staffMaxDiscountPct: number;
  /** Venue-wide khata limit per player; null = none. */
  creditLimit: number | null;
};

/** A player's request from the station QR page, waiting for staff. */
export type StationRequest = {
  id: string;
  station_id: string;
  session_id: string;
  kind: "snack" | "extend" | "call";
  label: string;
  created_at: string;
};

/** A PC that went quiet during a session, or whose app was closed while locked. */
export type PcAlert = {
  id: string;
  station_id: string;
  kind: "app_closed" | "pc_restarted" | "offline";
  away_from: string;
  away_until: string;
  customer_name: string | null;
};

/** Upcoming bookings shown on the floor (requested or confirmed, from now to the end of tomorrow). */
export type FloorBooking = {
  id: string;
  station_type: StationType;
  station_id: string | null;
  name: string;
  phone: string;
  starts_at: string;
  minutes: number;
  players: number;
  status: "requested" | "confirmed";
};

export type FloorData = {
  branch: { id: string; name: string; timezone: string };
  orgId: string;
  orgName: string;
  role: MemberRole;
  serverNow: string;
  stations: FloorStation[];
  sessions: LiveSession[];
  plans: FloorPlan[];
  packages: FloorPackage[];
  settings: FloorSettings;
  /** PC apps paired in this branch (one per PC station at most). */
  devices: DeviceStatus[];
  requests: StationRequest[];
  bookings: FloorBooking[];
  alerts: PcAlert[];
};

export const SESSION_SELECT =
  "id, station_id, rate_plan_id, mode, status, customer_id, customer_name, customer_phone, players, started_at, planned_end_at, prepaid_minutes, prepaid_amount, frames, paused_at, ended_at, charge_amount, billed_amount, outstanding, session_pauses(started_at, ended_at)";

// Live state of a station tile, derived each tick.
export type TileState = "free" | "busy" | "ending" | "over" | "paused" | "off";

export const ENDING_SOON_SECONDS = 5 * 60;

export const REQUEST_SELECT = "id, station_id, session_id, kind, label, created_at";
export const ALERT_SELECT = "id, station_id, kind, away_from, away_until, customer_name";
export const BOOKING_SELECT = "id, station_type, station_id, name, phone, starts_at, minutes, players, status";
