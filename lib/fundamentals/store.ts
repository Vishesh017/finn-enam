import { promises as fs } from "node:fs";
import path from "node:path";
import type { FundamentalDoc, FundamentalsFile, QuarterlyRow } from "@/types/pull";
import { fetchPdfText, sliceAnnualReport } from "./pdf";
import { loadScreener, quarterKey } from "./screener";

const BUNDLED_DIR = path.join(process.cwd(), "data", "fundamentals");
// Serverless file systems are read-only apart from /tmp.
const CACHE_DIR = process.env.FINN_CACHE_DIR ?? (process.env.VERCEL ? "/tmp/finn-fundamentals" : BUNDLED_DIR);
const TTL_MS = 7 * 24 * 3_600_000;
const MAX_CALLS = 3;                       // most recent earnings calls to read
const MAX_TRANSCRIPT_CHARS = 40_000;
const QUARTERS_IN_TABLE = 9;               // enough for YoY on the latest quarter and the one before

const inflight = new Map<string, Promise<FundamentalsFile>>();

async function readFile(dir: string, ticker: string): Promise<FundamentalsFile | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${ticker}.json`), "utf8")) as FundamentalsFile;
  } catch {
    return null;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const fmt = (n: number | null) => (n === null ? "n/a" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

function quarterlyDoc(rows: QuarterlyRow[]): FundamentalDoc {
  const recent = rows.slice(-QUARTERS_IN_TABLE);
  const lines = recent.map(
    (r) => `${r.label}: Revenue ${fmt(r.revenue)} | EBITDA ${fmt(r.ebitda)} | PBT ${fmt(r.pbt)} | PAT ${fmt(r.pat)}`,
  );
  return {
    id: "screener-quarterly",
    type: "results",
    period: recent.at(-1)?.label ?? "",
    title: "Quarterly results table (screener.in)",
    text: `Quarterly results as standardised by screener.in. All figures in INR crore. EBITDA is operating profit.\n${lines.join("\n")}`,
  };
}

async function build(ticker: string): Promise<FundamentalsFile> {
  const page = await loadScreener(ticker);
  if (!page) throw new Error(`screener.in has no page for ${ticker}. Check the NSE symbol.`);

  const callTargets = page.concalls.filter((c) => c.transcript).slice(0, MAX_CALLS);
  const reportTarget = page.annualReports[0];

  const [callTexts, reportText] = await Promise.all([
    Promise.all(callTargets.map((c) => fetchPdfText(c.transcript!))),
    reportTarget ? fetchPdfText(reportTarget.url, { timeoutMs: 60_000 }) : Promise.resolve(null),
  ]);

  const calls: FundamentalDoc[] = [];
  callTargets.forEach((c, i) => {
    const text = callTexts[i];
    if (!text) return;
    calls.push({
      id: `concall-${slug(c.period)}`,
      type: "concall",
      period: c.period,
      title: `${c.period} earnings call transcript`,
      url: c.transcript!,
      text: text.slice(0, MAX_TRANSCRIPT_CHARS),
    });
  });
  calls.sort((a, b) => quarterKey(a.period) - quarterKey(b.period)); // chronological for the model

  const docs: FundamentalDoc[] = [];
  if (reportTarget && reportText) {
    docs.push({
      id: `ar-${slug(reportTarget.period)}`,
      type: "annual_report",
      period: reportTarget.period,
      title: `Annual report ${reportTarget.period}, management discussion`,
      url: reportTarget.url,
      text: sliceAnnualReport(reportText),
    });
  }
  docs.push(...calls);

  if (docs.length === 0) {
    throw new Error(
      `Found ${ticker} on screener.in but could not download any transcripts or annual reports. ` +
        `The company may not publish them there, or the exchange blocked the download.`,
    );
  }
  if (page.quarterly.length) docs.push(quarterlyDoc(page.quarterly));

  return {
    ticker,
    company: page.company || ticker,
    fetchedAt: new Date().toISOString(),
    source: "screener.in",
    sourceUrl: page.sourceUrl,
    quarterly: page.quarterly,
    docs,
  };
}

/**
 * Returns primary documents for any NSE symbol. Order: hand-written fixture, fresh cache,
 * live screener.in fetch, stale cache as a last resort. Concurrent callers share one fetch.
 */
export async function getFundamentals(ticker: string): Promise<FundamentalsFile> {
  const bundled = await readFile(BUNDLED_DIR, ticker);
  if (bundled && !bundled.fetchedAt) return bundled; // fixtures never expire

  const cached = bundled ?? (await readFile(CACHE_DIR, ticker));
  if (cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;

  const running = inflight.get(ticker);
  if (running) return running;

  const job = (async () => {
    try {
      const fresh = await build(ticker);
      try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(path.join(CACHE_DIR, `${ticker}.json`), JSON.stringify(fresh));
      } catch (err) {
        console.warn("[fundamentals] could not write cache:", (err as Error).message);
      }
      return fresh;
    } catch (err) {
      if (cached) return cached; // stale beats nothing
      throw err;
    } finally {
      inflight.delete(ticker);
    }
  })();
  inflight.set(ticker, job);
  return job;
}
