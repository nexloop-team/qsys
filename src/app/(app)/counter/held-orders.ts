"use client";

import { useSyncExternalStore } from "react";
import type { CartLine } from "./types";

// Walk-in orders put on hold (the player went to fetch cash, or wants to add more later). Kept on
// this device only, like a parked ticket on a till: nothing is billed or taken off the shelf
// until the sale is completed.

export type HeldOrder = { id: string; label: string; at: string; lines: CartLine[] };

const EMPTY: HeldOrder[] = [];
const key = (branchId: string) => `qs-held-orders:${branchId}`;
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; list: HeldOrder[] } | null = null;

function read(branchId: string): HeldOrder[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(branchId));
  } catch {
    return EMPTY;
  }
  // Same text as last time: same array, so React doesn't re-render for nothing.
  if (cache && cache.key === key(branchId) && cache.raw === raw) return cache.list;
  let list: HeldOrder[] = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((h) => Array.isArray(h?.lines) && h.lines.length > 0);
  } catch {
    list = EMPTY;
  }
  cache = { key: key(branchId), raw, list };
  return list;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // another tab held or resumed an order
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useHeldOrders(branchId: string) {
  return useSyncExternalStore(subscribe, () => read(branchId), () => EMPTY);
}

export function saveHeld(branchId: string, list: HeldOrder[]) {
  try {
    window.localStorage.setItem(key(branchId), JSON.stringify(list.slice(0, 30)));
  } catch {
    // Storage blocked (private window): held orders just won't be kept.
  }
  listeners.forEach((l) => l());
}
