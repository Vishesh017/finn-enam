import * as cheerio from "cheerio";
import type { QuarterlyRow } from "@/types/pull";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const BASE = "https://www.screener.in/company";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-IN,en;q=0.9",
};

/** "Sep 2025" -> "Q2 FY26". Indian financial years run April to March. */
export function quarterLabel(text: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const year = Number(m[2]);
  const fyEnd = month >= 3 ? year + 1 : year;
  const q = month >= 3 ? Math.floor((month - 3) / 3) + 1 : 4;
  return `Q${q} FY${String(fyEnd).slice(-2)}`;
}

/** Sortable key: "Q2 FY26" -> 262. Returns 0 for anything that is not a quarter label. */
export function quarterKey(label: string): number {
  const m = /^Q([1-4]) FY(\d{2})$/.exec(label);
  return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
}

const clean = (s: string) => s.replace(/[\u00a0\s]+/g, " ").trim();

function num(s: string): number | null {
  const t = s.replace(/[,\s₹]/g, "").replace(/%$/, "");
  if (t === "" || t === "-" || t === "–") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface ConcallLinks { period: string; transcript: string | null; ppt: string | null }
export interface AnnualReportLink { period: string; url: string; host: string }
export interface ScreenerPage {
  company: string;
  quarterly: QuarterlyRow[];
  concalls: ConcallLinks[];             // newest first, as listed by screener
  annualReports: AnnualReportLink[];    // newest first
  sourceUrl: string;
}

type Metric = "revenue" | "ebitda" | "pbt" | "pat";

function parseQuarterly($: cheerio.CheerioAPI): QuarterlyRow[] {
  const table = $("#quarters table.data-table").first().length
    ? $("#quarters table.data-table").first()
    : $("#quarters table").first();
  if (!table.length) return [];

  const labels = table.find("thead th").toArray().slice(1).map((th) => quarterLabel(clean($(th).text())));
  const rows: Partial<Record<Metric, (number | null)[]>> = {};

  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).find("td").toArray();
    if (cells.length < 2) return;
    const name = clean($(cells[0]).text()).replace(/\s*\+\s*$/, "").toLowerCase();
    const key: Metric | null =
      /^(sales|revenue)\b/.test(name) ? "revenue"
      : /^(operating profit|financing profit)\b/.test(name) ? "ebitda"
      : /^profit before tax\b/.test(name) ? "pbt"
      : /^net profit\b/.test(name) ? "pat"
      : null;
    if (!key || rows[key]) return;
    rows[key] = cells.slice(1).map((td) => num(clean($(td).text())));
  });

  const out: QuarterlyRow[] = [];
  labels.forEach((label, i) => {
    if (!label) return;
    const row: QuarterlyRow = {
      label,
      revenue: rows.revenue?.[i] ?? null,
      ebitda: rows.ebitda?.[i] ?? null,
      pbt: rows.pbt?.[i] ?? null,
      pat: rows.pat?.[i] ?? null,
    };
    if (row.revenue !== null || row.pat !== null) out.push(row);
  });
  return out;
}

function listFor($: cheerio.CheerioAPI, cls: string, heading: RegExp) {
  let ul = $(`#documents .${cls} ul`).first();
  if (!ul.length) {
    const h = $("#documents h3").filter((_, el) => heading.test($(el).text())).first();
    ul = h.nextAll("ul").first();
    if (!ul.length) ul = h.parent().find("ul").first();
  }
  return ul;
}

const abs = (href: string) => {
  try { return new URL(href, "https://www.screener.in").toString(); } catch { return null; }
};

function parseConcalls($: cheerio.CheerioAPI): ConcallLinks[] {
  const out: ConcallLinks[] = [];
  listFor($, "concalls", /concall/i).find("li").each((_, li) => {
    const item = $(li);
    const date = clean(item.clone().find("a,button").remove().end().text());
    const period = quarterLabel(date) ?? date;
    let transcript: string | null = null;
    let ppt: string | null = null;
    item.find("a[href]").each((__, a) => {
      const label = clean($(a).text()).toLowerCase();
      const href = abs($(a).attr("href") ?? "");
      if (!href) return;
      if (label.includes("transcript")) transcript ??= href;
      else if (label.includes("ppt")) ppt ??= href;
    });
    if (period && (transcript || ppt)) out.push({ period, transcript, ppt });
  });
  return out;
}

function parseAnnualReports($: cheerio.CheerioAPI): AnnualReportLink[] {
  const seen = new Set<string>();
  const out: AnnualReportLink[] = [];
  listFor($, "annual-reports", /annual report/i).find("a[href]").each((_, a) => {
    const text = clean($(a).text());
    const year = /(20\d{2})/.exec(text)?.[1];
    const url = abs($(a).attr("href") ?? "");
    if (!year || !url) return;
    const period = `FY${year.slice(-2)}`;
    if (seen.has(period)) return;
    seen.add(period);
    out.push({ period, url, host: /from\s+(\w+)/i.exec(text)?.[1]?.toLowerCase() ?? "" });
  });
  return out;
}

/** Pure parser, separated from the network call so it can be tested on saved HTML. */
export function parseScreenerHtml(html: string, sourceUrl: string): ScreenerPage {
  const $ = cheerio.load(html);
  return {
    company: clean($("h1").first().text()),
    quarterly: parseQuarterly($),
    concalls: parseConcalls($),
    annualReports: parseAnnualReports($),
    sourceUrl,
  };
}

async function getHtml(url: string): Promise<{ html: string; url: string } | null> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`screener.in answered ${res.status}. Try again in a minute.`);
  return { html: await res.text(), url: res.url };
}

/** Tries the consolidated page first, then standalone. Returns null when the symbol is unknown. */
export async function loadScreener(ticker: string): Promise<ScreenerPage | null> {
  const symbol = encodeURIComponent(ticker);
  for (const suffix of ["/consolidated/", "/"]) {
    const got = await getHtml(`${BASE}/${symbol}${suffix}`);
    if (!got) continue;
    const page = parseScreenerHtml(got.html, got.url);
    if (page.quarterly.length || page.concalls.length) return page;
  }
  return null;
}
