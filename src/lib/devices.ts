// PC app (agent) status helpers, shared by Stations and the Floor.

/** The PC app checks in every 15 s; after a minute of silence it counts as offline. */
export const DEVICE_ONLINE_SECONDS = 60;

import type { Json } from "./database.types";

export type DeviceStatus = {
  station_id: string;
  hostname: string | null;
  agent_version: string | null;
  ip: string | null;
  mac: string | null;
  screen_locked: boolean | null;
  last_seen_at: string | null;
  created_at: string;
  health: Json | null;
  health_at: string | null;
};

export const DEVICE_SELECT =
  "station_id, hostname, agent_version, ip, mac, screen_locked, last_seen_at, created_at, health, health_at";

/** Readings the PC app sends with each check-in. Any field can be missing (older app, no NVIDIA GPU). */
export type DeviceHealth = {
  cpu?: number;
  ram_used_gb?: number;
  ram_total_gb?: number;
  disk_free_gb?: number | null;
  disk_total_gb?: number | null;
  uptime_h?: number;
  gpu?: { name?: string; util?: number; temp?: number; vram_used_gb?: number; vram_total_gb?: number } | null;
  usb?: string[];
  /** Restriction → "policy" (Windows enforces it), "apps" (programs closed) or "watch" (USB reported only). */
  restrictions?: Record<string, string>;
};

// When a reading is worth a warning on the floor.
export const HEALTH_LIMITS = { gpuTemp: 85, diskFreeGb: 15, ramPct: 92, cpuPct: 95 };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The health readings, if any came in during the last few minutes. */
export function readHealth(device: Pick<DeviceStatus, "health" | "health_at"> | undefined, nowMs: number): DeviceHealth | null {
  if (!device?.health || typeof device.health !== "object" || Array.isArray(device.health)) return null;
  if (!device.health_at || nowMs - Date.parse(device.health_at) > 5 * 60_000) return null;
  return device.health as DeviceHealth;
}

export type HealthItem = { label: string; value: string; warn: boolean };

/** CPU · RAM · GPU · disk, each with a warning flag. */
export function healthItems(h: DeviceHealth): HealthItem[] {
  const items: HealthItem[] = [];
  const cpu = num(h.cpu);
  if (cpu !== undefined) items.push({ label: "CPU", value: `${Math.round(cpu)}%`, warn: cpu >= HEALTH_LIMITS.cpuPct });
  const used = num(h.ram_used_gb);
  const total = num(h.ram_total_gb);
  if (used !== undefined && total) {
    const pct = (used / total) * 100;
    items.push({ label: "RAM", value: `${used.toFixed(1)} / ${Math.round(total)} GB`, warn: pct >= HEALTH_LIMITS.ramPct });
  }
  const temp = num(h.gpu?.temp);
  const util = num(h.gpu?.util);
  if (temp !== undefined || util !== undefined) {
    const parts = [util !== undefined ? `${Math.round(util)}%` : null, temp !== undefined ? `${Math.round(temp)}°C` : null];
    items.push({ label: "GPU", value: parts.filter(Boolean).join(" · "), warn: (temp ?? 0) >= HEALTH_LIMITS.gpuTemp });
  }
  const free = num(h.disk_free_gb);
  if (free !== undefined) items.push({ label: "Disk free", value: `${Math.round(free)} GB`, warn: free < HEALTH_LIMITS.diskFreeGb });
  return items;
}

/** Short reasons to look at this PC, e.g. ["GPU 88°C", "Disk almost full"]. */
export function healthWarnings(h: DeviceHealth | null): string[] {
  if (!h) return [];
  const out: string[] = [];
  const temp = num(h.gpu?.temp);
  if (temp !== undefined && temp >= HEALTH_LIMITS.gpuTemp) out.push(`GPU ${Math.round(temp)}°C`);
  const free = num(h.disk_free_gb);
  if (free !== undefined && free < HEALTH_LIMITS.diskFreeGb) out.push("Disk almost full");
  const used = num(h.ram_used_gb);
  const total = num(h.ram_total_gb);
  if (used !== undefined && total && (used / total) * 100 >= HEALTH_LIMITS.ramPct) out.push("Memory almost full");
  if (Array.isArray(h.usb) && h.usb.length > 0) out.push("USB drive plugged in");
  return out;
}

export function isOnline(device: Pick<DeviceStatus, "last_seen_at"> | undefined, nowMs: number) {
  if (!device?.last_seen_at) return false;
  return nowMs - Date.parse(device.last_seen_at) < DEVICE_ONLINE_SECONDS * 1000;
}

export function seenAgo(lastSeen: string | null, nowMs: number) {
  if (!lastSeen) return "never connected";
  const s = Math.max(0, Math.round((nowMs - Date.parse(lastSeen)) / 1000));
  if (s < 90) return "seen just now";
  const m = Math.round(s / 60);
  if (m < 60) return `seen ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `seen ${h} h ago`;
  return `seen ${Math.round(h / 24)} days ago`;
}
