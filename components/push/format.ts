import type { QuarterMetrics } from "@/types/pull";

export type Tone = "up" | "down" | "flat" | "na";

export interface Delta {
  text: string;
  tone: Tone;
}

const NA: Delta = { text: "n.m.", tone: "na" };

export const crore = (n: number | null): string =>
  n === null ? "–" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Percent change; "n.m." (not meaningful) when the base is zero, negative or missing. */
export function pctDelta(cur: number | null, base: number | null): Delta {
  if (cur === null || base === null || base <= 0) return NA;
  const p = ((cur - base) / base) * 100;
  if (Math.abs(p) < 0.05) return { text: "0.0%", tone: "flat" };
  const sign = p > 0 ? "+" : "−";
  return { text: `${sign}${Math.abs(p).toFixed(1)}%`, tone: p > 0 ? "up" : "down" };
}

export const margin = (n: number | null, rev: number | null): number | null =>
  n === null || rev === null || rev === 0 ? null : (n / rev) * 100;

/** Margin change in basis points. */
export function bpsDelta(cur: number | null, base: number | null): Delta {
  if (cur === null || base === null) return NA;
  const bps = Math.round((cur - base) * 100);
  if (bps === 0) return { text: "0 bps", tone: "flat" };
  return { text: `${bps > 0 ? "+" : "−"}${Math.abs(bps)} bps`, tone: bps > 0 ? "up" : "down" };
}

/** "Q2 FY26" -> "Q2 FY25". */
export function sameQuarterLastYear(label: string): string | null {
  const m = /^(Q[1-4]) FY(\d{2})$/.exec(label);
  return m ? `${m[1]} FY${String(Number(m[2]) - 1).padStart(2, "0")}` : null;
}

export function pickComparisons(quarters: QuarterMetrics[]) {
  const cur = quarters.at(-1) ?? null;
  const qoq = quarters.length > 1 ? quarters[quarters.length - 2] : null;
  const lastYear = cur ? sameQuarterLastYear(cur.label) : null;
  const yoy = lastYear ? quarters.find((q) => q.label === lastYear) ?? null : null;
  return { cur, qoq, yoy };
}

const IST = "Asia/Kolkata";
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" });

/** "12m ago" for recent items, "7 Nov, 2:10 pm" for older ones. IST throughout. */
export function whenLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const mins = Math.round((now - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 12 * 60) return `${Math.floor(mins / 60)}h ago`;
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
}

export const clockLabel = (iso: string) => timeFmt.format(new Date(iso));

export const rupees = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Indian shorthand for share counts: 1.2 Cr, 4.5 L, 800. */
export function shares(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

export const signedPct = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;