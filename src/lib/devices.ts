// PC app (agent) status helpers, shared by Stations and the Floor.

/** The PC app checks in every 15 s; after a minute of silence it counts as offline. */
export const DEVICE_ONLINE_SECONDS = 60;

export type DeviceStatus = {
  station_id: string;
  hostname: string | null;
  agent_version: string | null;
  ip: string | null;
  mac: string | null;
  screen_locked: boolean | null;
  last_seen_at: string | null;
  created_at: string;
};

export const DEVICE_SELECT = "station_id, hostname, agent_version, ip, mac, screen_locked, last_seen_at, created_at";

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
