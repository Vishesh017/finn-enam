import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tierOf, type Alert, type FeedAlert, type PushFeed, type Tier } from "@/types/push";

const FILE = path.join(process.cwd(), "data", "alerts.json");
const MAX_HOURS = 24 * 30;
const TIER_RANK: Record<Tier, number> = { attention: 0, review: 1, routine: 2 };
const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 } as const;

const isAlert = (x: unknown): x is Alert => {
  const a = x as Alert;
  return !!a && typeof a.id === "string" && typeof a.ticker === "string" &&
    typeof a.ts === "string" && !Number.isNaN(Date.parse(a.ts)) && a.priority in PRIORITY_RANK;
};

/** Market alerts have no model score; treat a tripped threshold as materiality 4. */
const materiality = (a: Alert) => a.metrics?.materiality ?? (a.kind === "market" ? 4 : 2);

export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("hours") ?? 24);
  const hours = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), MAX_HOURS) : 24;
  const tickers = req.nextUrl.searchParams.get("tickers")?.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  let generatedAt: string | null = null;
  let all: Alert[] = [];
  try {
    const [text, stat] = await Promise.all([fs.readFile(FILE, "utf8"), fs.stat(FILE)]);
    all = (JSON.parse(text) as unknown[]).filter(isAlert);
    generatedAt = stat.mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[push] could not read alerts.json", err);
      return NextResponse.json({ error: "The alert feed could not be read." }, { status: 500 });
    }
    // No worker run yet: an empty feed is a valid answer, not an error.
  }

  const since = Date.now() - hours * 3_600_000;
  const alerts: FeedAlert[] = all
    .filter((a) => Date.parse(a.ts) >= since && (!tickers?.length || tickers.includes(a.ticker)))
    .map((a) => ({ ...a, category: a.category ?? null, detail: a.detail ?? "", source_url: a.source_url ?? null, metrics: a.metrics ?? null, enrichment: a.enrichment ?? null, tier: tierOf(a) }))
    .sort((a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      materiality(b) - materiality(a) ||
      Date.parse(b.ts) - Date.parse(a.ts),
    );

  const counts: Record<Tier, number> = { attention: 0, review: 0, routine: 0 };
  for (const a of alerts) counts[a.tier]++;

  const body: PushFeed = { alerts, windowHours: hours, generatedAt, counts };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
