export const CATEGORIES = [
  "results", "M&A", "fund_raise", "management_change", "litigation", "insider_trading",
  "earnings_call", "investor_meetings", "credit_rating", "dividend", "bonus_split", "capex",
  "press_release", "postal_ballot", "agm_egm", "pledging", "unclassified",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  results: "Results",
  "M&A": "M&A",
  fund_raise: "Fund raise",
  management_change: "Management change",
  litigation: "Litigation",
  insider_trading: "Insider trading",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meetings",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus or split",
  capex: "Capex",
  press_release: "Press release",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM or EGM",
  pledging: "Pledging",
  unclassified: "Routine filing",
};

export type Priority = "P1" | "P2" | "P3";
export type Tier = "attention" | "review" | "routine";

export interface AlertMetrics {
  // market alerts
  close?: number;
  pct_change?: number;
  volume?: number;
  avg_volume?: number;
  volume_ratio?: number;
  vol_mult?: number;
  price_pct?: number;
  // announcements
  materiality?: number;
}

/** INR crore. Null means the figure was not in the filing or failed verification. */
export interface ResultsFigures {
  revenue: number | null;
  ebitda: number | null;
  pbt: number | null;
  pat: number | null;
  ebitda_derived?: boolean;             // true when computed from PBT + finance costs + depreciation - other income
}

export interface ResultsEnrichment {
  basis: "consolidated" | "standalone";
  unit: "INR Cr";
  periods: { current: string | null; qoq: string | null; yoy: string | null };
  current: ResultsFigures;
  previous_quarter: ResultsFigures | null;
  year_ago: ResultsFigures | null;
  evidence: string | null;
  unverified: number;                   // numbers the model returned that were not in the filing
  sample?: boolean;
}

export interface PersonEnrichment {
  name: string;
  role: string;
  action: "appointed" | "reappointed" | "resigned" | "retired" | "other";
  effective?: string | null;
  outgoing?: string | null;
  found: boolean;                       // false when identity could not be confirmed from cited sources
  summary?: string;
  career?: { role: string; org: string; years?: string | null }[];
  education?: string | null;
  sources?: { title: string; url: string }[];
  sample?: boolean;
}

export interface Enrichment {
  results?: ResultsEnrichment;
  person?: PersonEnrichment;
}

/** Mirrors the `Alert` dataclass in backend/push/finn_push.py. */
export interface Alert {
  id: string;
  kind: "market" | "announcement";
  ticker: string;
  ts: string;
  priority: Priority;
  title: string;
  detail: string;
  category: Category | null;
  triggered: boolean;
  source_url: string | null;
  metrics: AlertMetrics | null;
  enrichment?: Enrichment | null;
}

export type FeedAlert = Alert & { tier: Tier };

export interface PushFeed {
  alerts: FeedAlert[];
  windowHours: number;
  generatedAt: string | null;       // when the worker last wrote the feed
  counts: Record<Tier, number>;
}

export interface FinnConfig {
  volume_mult: number;
  volume_lookback: number;
  price_pct: number;
  watch_categories: Category[];
}

/**
 * Attention: something the investor asked to be told about, or a P1.
 * Review: notable but not urgent. Routine: buried by default.
 * "unclassified" never rises above routine, whatever a model scored it.
 */
export function tierOf(a: Pick<Alert, "category" | "priority" | "triggered">): Tier {
  if (a.category === "unclassified") return "routine";
  if (a.priority === "P1" || a.triggered) return "attention";
  if (a.priority === "P2") return "review";
  return "routine";
}
