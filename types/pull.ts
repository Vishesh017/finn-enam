export type Verdict = "delivered" | "partial" | "missed" | "unverifiable";

/** One primary-source document (concall transcript, annual report, results table). */
export interface FundamentalDoc {
  id: string;                                   // e.g. "concall-q1fy26"
  type: "concall" | "annual_report" | "results";
  period: string;                               // "Q1 FY26" | "FY25"
  title: string;
  url?: string;
  text: string;
}

/** One quarter of standardised results, INR crore, as listed on screener.in. */
export interface QuarterlyRow {
  label: string;                                // "Q2 FY26"
  revenue: number | null;
  ebitda: number | null;                        // screener's "Operating Profit"
  pbt: number | null;
  pat: number | null;
}

export interface FundamentalsFile {
  ticker: string;
  company: string;
  /** Absent on hand-written fixtures, which never expire. */
  fetchedAt?: string;
  source?: "screener.in";
  sourceUrl?: string;
  /** Oldest to newest. When present, quarters come from here, not from the model. */
  quarterly?: QuarterlyRow[];
  docs: FundamentalDoc[];
}

/** Figures in INR crore. */
export interface QuarterMetrics {
  label: string;                                // "Q2 FY26"
  revenue: number | null;
  ebitda: number | null;
  pbt: number | null;
  pat: number | null;
  docId: string;
  evidence: string;
}

export interface Commitment {
  id: string;
  metric: string;                               // "FY26 revenue growth"
  madeIn: string;                               // "Q1 FY26 call"
  target: string;                               // "18–20% YoY"
  promiseQuote: string;
  promiseDocId: string;
  outcome: string;                              // "16.4% YoY" or "Not disclosed"
  deliveredQuote: string | null;
  deliveredDocId: string | null;
  verdict: Verdict;
  gap: string;                                  // "1.6 pts below the low end"
}

export interface PullAnalysis {
  ticker: string;
  company: string;
  asOf: string;                                 // latest quarter label
  quarters: QuarterMetrics[];                   // oldest -> newest
  commitments: Commitment[];
  toneShift: { summary: string; quotes: { docId: string; quote: string }[] };
  docs: { id: string; title: string; period: string; url?: string }[];
  dropped: number;                              // claims removed because the quote was not in the source
  model: string;
  generatedAt: string;
  cached: boolean;
}
