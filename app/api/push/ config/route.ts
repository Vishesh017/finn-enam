import { NextRequest, NextResponse, connection } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CATEGORIES, type Category, type FinnConfig } from "@/types/push";



const FILE = path.join(process.cwd(), "data", "finn_config.json");

// Keep in step with `Config` in backend/push/finn_push.py.
const DEFAULTS: FinnConfig = {
  volume_mult: 2,
  volume_lookback: 20,
  price_pct: 3,
  watch_categories: ["results", "M&A", "management_change", "litigation", "pledging"],
};

async function readStored(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

const pick = (stored: Record<string, unknown>): FinnConfig => ({
  volume_mult: typeof stored.volume_mult === "number" ? stored.volume_mult : DEFAULTS.volume_mult,
  volume_lookback: typeof stored.volume_lookback === "number" ? stored.volume_lookback : DEFAULTS.volume_lookback,
  price_pct: typeof stored.price_pct === "number" ? stored.price_pct : DEFAULTS.price_pct,
  watch_categories: Array.isArray(stored.watch_categories)
    ? (stored.watch_categories.filter((c) => (CATEGORIES as readonly string[]).includes(c)) as Category[])
    : DEFAULTS.watch_categories,
});

export async function GET() {
  await connection(); // render at request time, never at build
  return NextResponse.json(pick(await readStored()), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send a JSON object." }, { status: 400 });
  }

  const { volume_mult, price_pct, watch_categories } = body as Partial<FinnConfig>;
  const inRange = (n: unknown, lo: number, hi: number): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

  if (!inRange(volume_mult, 1.1, 20)) {
    return NextResponse.json({ error: "Volume multiple must be between 1.1× and 20×." }, { status: 400 });
  }
  if (!inRange(price_pct, 0.5, 30)) {
    return NextResponse.json({ error: "Price move must be between 0.5% and 30%." }, { status: 400 });
  }
  if (
    !Array.isArray(watch_categories) ||
    !watch_categories.every((c) => (CATEGORIES as readonly string[]).includes(c) && c !== "unclassified")
  ) {
    return NextResponse.json({ error: "Watch list contains an unknown category." }, { status: 400 });
  }

  // Merge into the stored file so the portfolio and per-ticker overrides survive.
  const next = { ...(await readStored()), volume_mult, price_pct, watch_categories };
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, FILE); // atomic, so the worker never reads a half-written file

  return NextResponse.json(pick(next));
}