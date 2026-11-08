import "server-only";
import { headers } from "next/headers";

const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i;
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * The app's public address, for links people open on their own phone or from an email (station QR
 * codes, the booking page, sign-up and reset links). Taken from the address the app is being opened
 * at, so it works on a real domain, a tunnel or a LAN IP with no setup. A real NEXT_PUBLIC_SITE_URL
 * (not localhost) wins, to pin one address when the app answers on several.
 */
export async function siteUrl(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (env && !LOCAL.test(env.replace(/^https?:\/\//, ""))) return env;

  const h = await headers();
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (host && HOST.test(host)) {
    const proto = first(h.get("x-forwarded-proto")) ?? (LOCAL.test(host) ? "http" : "https");
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return env || "http://localhost:3000";
}

/** Phones can't open these, so codes printed for them won't work. */
export function isLocalUrl(url: string) {
  return LOCAL.test(url.replace(/^https?:\/\//, ""));
}

/** Free tunnel addresses change every time the tunnel restarts. */
export function isTunnelUrl(url: string) {
  return /\.(ngrok-free\.(app|dev)|ngrok\.io|ngrok\.app|trycloudflare\.com|loca\.lt)(:\d+)?$/i.test(
    url.replace(/^https?:\/\//, ""),
  );
}

function first(v: string | null) {
  return v?.split(",")[0]?.trim() || null;
}
