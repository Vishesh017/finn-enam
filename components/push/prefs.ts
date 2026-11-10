"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES, type Category, type FeedAlert, type Priority, type Tier } from "@/types/push";

/** What counts as unusual for this investor. Stored in the browser, so it works on any host. */
export interface Prefs {
  volume_mult: number;
  price_pct: number;
  watch_categories: Category[];
}

export const LIMITS = {
  volume: { min: 1.5, max: 6, step: 0.5 },
  price: { min: 1, max: 10, step: 0.5 },
} as const;

export const DEFAULT_PREFS: Prefs = {
  volume_mult: 2,
  price_pct: 3,
  watch_categories: ["results", "M&A", "management_change", "litigation", "pledging"],
};

const KEY = "finn.prefs.v1";
const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

/** Whatever is in storage is untrusted: clamp numbers and drop unknown categories. */
function sanitize(raw: unknown): Prefs {
  const r = (raw ?? {}) as Partial<Prefs>;
  return {
    volume_mult: clamp(r.volume_mult, LIMITS.volume.min, LIMITS.volume.max, DEFAULT_PREFS.volume_mult),
    price_pct: clamp(r.price_pct, LIMITS.price.min, LIMITS.price.max, DEFAULT_PREFS.price_pct),
    watch_categories: Array.isArray(r.watch_categories)
      ? (r.watch_categories.filter((c) => (CATEGORIES as readonly string[]).includes(c) && c !== "unclassified") as Category[])
      : DEFAULT_PREFS.watch_categories,
  };
}

/** `ready` turns true after storage has been read, so the feed never flashes the wrong thresholds. */
export function usePrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setPrefsState(sanitize(JSON.parse(raw)));
    } catch {
      /* storage blocked or corrupt: fall back to defaults */
    }
    setReady(true);
  }, []);

  const setPrefs = useCallback((next: Prefs) => {
    const clean = sanitize(next);
    setPrefsState(clean);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* private mode: the setting still applies for this session */
    }
  }, []);

  return { prefs, setPrefs, ready };
}

const TIER_RANK: Record<Tier, number> = { attention: 0, review: 1, routine: 2 };
const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };
const materiality = (a: FeedAlert) => a.metrics?.materiality ?? (a.kind === "market" ? 4 : 2);

/**
 * Re-ranks the feed for one investor.
 *  - Price and volume moves appear only if they cross this investor's thresholds.
 *  - A material filing in a watched category needs attention; an unwatched one drops to "worth a look"
 *    rather than disappearing, so nothing important is hidden by a toggle.
 *  - Routine paperwork stays routine.
 */
export function applyPrefs(alerts: FeedAlert[], prefs: Prefs): FeedAlert[] {
  const out: FeedAlert[] = [];

  for (const a of alerts) {
    if (a.kind === "market") {
      const m = a.metrics ?? {};
      const ratio = m.volume_ratio ?? 0;
      const move = Math.abs(m.pct_change ?? 0);
      const hitVol = ratio >= prefs.volume_mult;
      const hitPx = move >= prefs.price_pct;
      if (!hitVol && !hitPx) continue;

      const strong = (hitVol && hitPx) || ratio >= prefs.volume_mult * 1.5 || move >= prefs.price_pct * 1.5;
      out.push({
        ...a,
        priority: strong ? "P1" : "P2",
        triggered: true,
        tier: "attention",
        metrics: { ...m, vol_mult: prefs.volume_mult, price_pct: prefs.price_pct },
      });
      continue;
    }

    if (a.category === "unclassified") {
      out.push({ ...a, triggered: false, tier: "routine" });
      continue;
    }

    const watched =
      !!a.category && prefs.watch_categories.includes(a.category) && (a.metrics?.materiality ?? 0) >= 3;
    const tier: Tier = watched ? "attention" : a.priority === "P3" ? "routine" : "review";
    out.push({ ...a, triggered: watched, tier });
  }

  return out.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      materiality(b) - materiality(a) ||
      Date.parse(b.ts) - Date.parse(a.ts),
  );
}