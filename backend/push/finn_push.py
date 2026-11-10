#!/usr/bin/env python3
"""
FINN push worker.

Pulls end-of-day prices for the portfolio, flags unusual volume / price moves,
classifies exchange announcements into the 17-category taxonomy, scores their
priority, and writes one merged feed to data/alerts.json for the Next.js app.

Model routing
  1. Regex rules       -> free, handles unambiguous routine filings
  2. Haiku-class model -> batched classification of everything else
  3. Haiku-class model -> reads results filings (Revenue/EBITDA/PBT/PAT) and names the
                          incoming executive; Python verifies every number (see enrich.py)
  4. Everything is cached by announcement id, so re-runs cost nothing

Schedule (NSE closes 15:30 IST = 10:00 UTC; leave time for Yahoo to settle):
  30 10 * * 1-5  cd /srv/finn && python backend/push/finn_push.py

Usage:
  python finn_push.py
  python finn_push.py --volume-mult 2.5 --price-pct 4
  python finn_push.py --config data/finn_config.json --announcements data/announcements.json
  python finn_push.py --max-enrich 5        # cap enrichment calls per run (web search costs extra)

Announcement records may carry `attachment_url` (a results PDF) and/or `filing_text`
(the filing's text, used instead of downloading the PDF) and `body`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf

from enrich import SKIP, enrich_announcement

try:
    from anthropic import Anthropic
except ImportError:  # the script still runs rules-only without the SDK
    Anthropic = None  # type: ignore

log = logging.getLogger("finn.push")

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"

# --------------------------------------------------------------------------- #
# Taxonomy
# --------------------------------------------------------------------------- #

CATEGORIES: dict[str, str] = {
    "results": "Quarterly/annual results, board meeting approving them, results decks, shareholder letters, ads confirming results.",
    "M&A": "Acquisition, merger, demerger, joint venture; investing in or selling a stake in a subsidiary.",
    "fund_raise": "Rights issues, QIPs, preferential allotments, buybacks, debt such as commercial paper.",
    "management_change": "CEO, CFO, MD or director joining, resigning or retiring.",
    "litigation": "Lawsuits, regulatory orders, fines, warnings, insolvency or restructuring proceedings.",
    "insider_trading": "A promoter or insider buying/selling their own personal shareholding.",
    "earnings_call": "Notice, transcript or recording link of the investor conference call.",
    "investor_meetings": "One-on-one or small-group investor meetings; attending an investor conference.",
    "credit_rating": "A rating agency assigning, upgrading, downgrading or reaffirming a rating.",
    "dividend": "A cash dividend declared, with its record date.",
    "bonus_split": "A bonus issue or stock split; share count changes, no cash.",
    "capex": "Approving spend on a new plant, facility or capacity expansion.",
    "press_release": "General news: order wins, new products, partnerships, rumour clarifications.",
    "postal_ballot": "Shareholder voting by postal ballot: notice and result.",
    "agm_egm": "Annual or Extraordinary General Meeting: notice and result.",
    "pledging": "A promoter pledging, releasing or changing pledge status of shares.",
    "unclassified": "Routine paperwork: ESOP allotments, compliance certificates, ESG reports, auditor appointments.",
}

# How much each category tends to matter before the model's materiality score
# (1-5) shifts it. Explicit so the ranking is auditable.
BASE_WEIGHT: dict[str, int] = {
    "results": 3, "M&A": 3, "management_change": 3, "litigation": 3, "pledging": 3,
    "fund_raise": 2, "insider_trading": 2, "credit_rating": 2, "capex": 2,
    "dividend": 2, "bonus_split": 2,
    "earnings_call": 1, "investor_meetings": 1, "press_release": 1,
    "postal_ballot": 1, "agm_egm": 1,
    "unclassified": 0,
}

# Only unambiguous patterns. Anything fuzzy goes to the model.
RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"trading window|esop|employee stock (option|purchase)|esg|business responsibility|"
                r"certificate under regulation|regulation 74\(5\)|newspaper publication|"
                r"statutory auditor|secretarial compliance", re.I), "unclassified"),
    (re.compile(r"postal ballot", re.I), "postal_ballot"),
    (re.compile(r"credit rating|rating (action|rationale)|reaffirm", re.I), "credit_rating"),
    (re.compile(r"record date.*dividend|declaration of dividend|interim dividend|final dividend", re.I), "dividend"),
    (re.compile(r"invocation|creation of pledge|release of pledge|encumbrance", re.I), "pledging"),
    (re.compile(r"analyst.*meet|investor.*(meet|conference)|schedule of (analyst|investor)", re.I), "investor_meetings"),
    (re.compile(r"transcript|audio recording|earnings call|conference call", re.I), "earnings_call"),
    (re.compile(r"stock split|sub-division|bonus (issue|shares)", re.I), "bonus_split"),
]

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

DEFAULT_PORTFOLIO = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "ITC", "LT", "SUNPHARMA",
    "MARUTI", "TITAN", "BAJFINANCE", "ADANIPORTS", "ASIANPAINT", "TATASTEEL",
    "ETERNAL", "DIXON", "POLYCAB", "PERSISTENT",
]


@dataclass
class Config:
    portfolio: list[str] = field(default_factory=lambda: list(DEFAULT_PORTFOLIO))
    volume_mult: float = 2.0          # flag when volume >= N x trailing average
    volume_lookback: int = 20         # trading days in the average (today excluded)
    price_pct: float = 3.0            # flag when |1-day move| >= X %
    overrides: dict[str, dict[str, float]] = field(default_factory=dict)  # per-ticker thresholds
    watch_categories: list[str] = field(
        default_factory=lambda: ["results", "M&A", "management_change", "litigation", "pledging"]
    )
    suffix: str = ".NS"
    retention_days: int = 30

    @classmethod
    def load(cls, path: Path | None) -> "Config":
        if path and path.exists():
            raw = json.loads(path.read_text())
            return cls(**{k: v for k, v in raw.items() if k in cls.__dataclass_fields__})
        return cls()

    def thresholds(self, ticker: str) -> tuple[float, float]:
        o = self.overrides.get(ticker, {})
        return o.get("volume_mult", self.volume_mult), o.get("price_pct", self.price_pct)


# --------------------------------------------------------------------------- #
# Alert model
# --------------------------------------------------------------------------- #

@dataclass
class Alert:
    id: str
    kind: str                         # "market" | "announcement"
    ticker: str
    ts: str                           # ISO-8601 UTC
    priority: str                     # "P1" | "P2" | "P3"
    title: str
    detail: str = ""
    category: str | None = None
    triggered: bool = False           # crossed a user threshold / watched category
    source_url: str | None = None
    metrics: dict[str, Any] | None = None
    enrichment: dict[str, Any] | None = None   # {"results": ...} or {"person": ...}


def _hash(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def _session_close_utc(idx: pd.Timestamp) -> str:
    """NSE closes 15:30 IST; stamp the alert at the close of the flagged session."""
    ts = pd.Timestamp(idx)
    ts = ts.tz_localize("Asia/Kolkata") if ts.tzinfo is None else ts.tz_convert("Asia/Kolkata")
    return ts.normalize().replace(hour=15, minute=30).tz_convert("UTC").isoformat()


# --------------------------------------------------------------------------- #
# Market signals (EOD)
# --------------------------------------------------------------------------- #

def fetch_eod(tickers: list[str], suffix: str, lookback: int) -> dict[str, pd.DataFrame]:
    """One batched download for the whole portfolio. Returns {ticker: OHLCV frame}."""
    symbols = [f"{t}{suffix}" for t in tickers]
    raw = yf.download(
        symbols, period=f"{max(lookback * 2 + 10, 45)}d", interval="1d", group_by="ticker",
        auto_adjust=False, progress=False, threads=True,
    )
    out: dict[str, pd.DataFrame] = {}
    for t, sym in zip(tickers, symbols):
        try:
            df = raw[sym] if isinstance(raw.columns, pd.MultiIndex) else raw
            df = df.dropna(subset=["Close"])
            df = df[df["Volume"] > 0]  # drop holidays / halted sessions
            if len(df) >= lookback + 2:
                out[t] = df
            else:
                log.warning("%s: only %d clean sessions, skipping", t, len(df))
        except KeyError:
            log.warning("%s: no data returned from Yahoo", t)
    return out


def market_alerts(frames: dict[str, pd.DataFrame], cfg: Config) -> list[Alert]:
    alerts: list[Alert] = []
    for ticker, df in frames.items():
        vol_mult, price_pct = cfg.thresholds(ticker)
        last, prev = df.iloc[-1], df.iloc[-2]
        baseline = df["Volume"].iloc[-(cfg.volume_lookback + 1):-1].mean()
        ratio = float(last["Volume"] / baseline) if baseline else 0.0
        move = float((last["Close"] / prev["Close"] - 1) * 100)
        session = pd.Timestamp(df.index[-1]).date().isoformat()

        hit_vol, hit_px = ratio >= vol_mult, abs(move) >= price_pct
        if not (hit_vol or hit_px):
            continue

        parts = []
        if hit_px:
            parts.append(f"{'Up' if move > 0 else 'Down'} {abs(move):.1f}% to ₹{last['Close']:,.2f}")
        if hit_vol:
            parts.append(f"volume {ratio:.1f}× the {cfg.volume_lookback}-day average")
        title = parts[0] if len(parts) == 1 else f"{parts[0]} on {ratio:.1f}× volume"
        title = title[0].upper() + title[1:]

        # Both signals together, or either at 1.5x its threshold, is a P1.
        strong = (hit_vol and hit_px) or ratio >= vol_mult * 1.5 or abs(move) >= price_pct * 1.5
        alerts.append(Alert(
            id=_hash("market", ticker, session),
            kind="market", ticker=ticker,
            ts=_session_close_utc(df.index[-1]),
            priority="P1" if strong else "P2",
            title=title,
            detail=f"Session {session}. Your thresholds: {vol_mult:g}× volume, ±{price_pct:g}% price.",
            triggered=True,
            metrics={
                "close": round(float(last["Close"]), 2),
                "pct_change": round(move, 2),
                "volume": int(last["Volume"]),
                "avg_volume": int(baseline),
                "volume_ratio": round(ratio, 2),
                "vol_mult": vol_mult,
                "price_pct": price_pct,
            },
        ))
    return alerts


# --------------------------------------------------------------------------- #
# Announcement classification
# --------------------------------------------------------------------------- #

CLASSIFIER_SYSTEM = (
    "You classify Indian exchange (NSE/BSE) corporate announcements for an investor.\n"
    "Pick exactly one category per announcement from this list:\n"
    + "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    + "\n\nAlso give `materiality` 1-5 for how likely the filing is to move the stock or change an "
    "investment thesis (1 = routine compliance, 3 = notable, 5 = thesis-changing). Base it only on "
    "what the filing says. Give `summary`: one plain sentence, under 22 words, stating the concrete "
    "facts (names, amounts, dates). Use \"\" for summary when materiality <= 2.\n"
    "Respond with a JSON array only, no prose and no code fences, one object per input in the same "
    'order: [{"id": str, "category": str, "materiality": int, "summary": str}]'
)


def rule_classify(headline: str) -> str | None:
    for pattern, category in RULES:
        if pattern.search(headline):
            return category
    return None


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError("no JSON array in model output")
    return json.loads(text[start:end + 1])


def llm_classify(client: Any, model: str, batch: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    payload = [
        {"id": a["id"], "company": a["ticker"], "headline": a["headline"], "body": (a.get("body") or "")[:700]}
        for a in batch
    ]
    for attempt in range(3):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=2500,
                system=[{"type": "text", "text": CLASSIFIER_SYSTEM, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            )
            rows = _extract_json_array("".join(b.text for b in resp.content if b.type == "text"))
            return {r["id"]: r for r in rows if "id" in r}
        except Exception as exc:  # network, rate limit, malformed JSON
            wait = 2 ** attempt
            log.warning("classifier attempt %d failed (%s); retrying in %ds", attempt + 1, exc, wait)
            time.sleep(wait)
    return {}


def priority_for(category: str, materiality: int) -> str:
    score = BASE_WEIGHT.get(category, 0) + (materiality - 3)
    return "P1" if score >= 4 else "P2" if score >= 2 else "P3"


def classify_announcements(
    announcements: list[dict[str, Any]], cfg: Config, cache_path: Path, model: str, client: Any
) -> list[Alert]:
    cache: dict[str, dict[str, Any]] = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    pending: list[dict[str, Any]] = []

    for a in announcements:
        if a["id"] in cache:
            continue
        rule = rule_classify(a["headline"])
        if rule:
            cache[a["id"]] = {"category": rule, "materiality": 1 if rule == "unclassified" else 2,
                              "summary": "", "via": "rule"}
        else:
            pending.append(a)

    if pending and client:
        for i in range(0, len(pending), 15):
            batch = pending[i:i + 15]
            results = llm_classify(client, model, batch)
            for a in batch:
                r = results.get(a["id"])
                if not r:
                    continue  # not cached, so the next run retries it
                cat = r.get("category") if r.get("category") in CATEGORIES else "unclassified"
                try:
                    mat = min(5, max(1, int(r.get("materiality", 2))))
                except (TypeError, ValueError):
                    mat = 2
                cache[a["id"]] = {"category": cat, "materiality": mat,
                                  "summary": str(r.get("summary", "")).strip(), "via": model}
    elif pending:
        log.warning("%d announcements left unclassified (no ANTHROPIC_API_KEY or SDK)", len(pending))

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=1))

    alerts: list[Alert] = []
    for a in announcements:
        c = cache.get(a["id"]) or {"category": "unclassified", "materiality": 2, "summary": ""}
        category = c["category"]
        alerts.append(Alert(
            id=_hash("ann", a["id"]),
            kind="announcement", ticker=a["ticker"], ts=a["ts"],
            priority=priority_for(category, c["materiality"]),
            title=a["headline"],
            detail=c.get("summary", ""),
            category=category,
            triggered=category in cfg.watch_categories and c["materiality"] >= 3,
            source_url=a.get("attachment_url"),
            metrics={"materiality": c["materiality"]},
        ))
    return alerts


# --------------------------------------------------------------------------- #
# Enrichment
# --------------------------------------------------------------------------- #

ENRICHABLE = {"results", "management_change"}


def apply_enrichment(
    alerts: list[Alert],
    sources: dict[str, dict[str, Any]],
    client: Any,
    cache_path: Path,
    extractor_model: str,
    enrich_model: str,
    limit: int,
) -> None:
    """Attach results numbers / executive backgrounds to material alerts, in place."""
    cache: dict[str, dict[str, Any]] = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    spent = 0

    for alert in alerts:
        src = sources.get(alert.id)
        if not src or alert.category not in ENRICHABLE or (alert.metrics or {}).get("materiality", 0) < 3:
            continue

        hit = cache.get(src["id"])
        if hit is None and client and spent < limit:
            spent += 1
            hit = enrich_announcement(client, src, alert.category, extractor_model, enrich_model)
            if hit is not None:  # None means a transient failure: retry next run
                cache[src["id"]] = hit
        if hit and hit is not SKIP and not hit.get("skip"):
            alert.enrichment = hit

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
    log.info("Enrichment: %d model calls, %d alerts enriched", spent, sum(1 for a in alerts if a.enrichment))


# --------------------------------------------------------------------------- #
# Feed merge + entry point
# --------------------------------------------------------------------------- #

def merge_feed(path: Path, fresh: list[Alert], retention_days: int) -> list[dict[str, Any]]:
    existing = {a["id"]: a for a in json.loads(path.read_text())} if path.exists() else {}
    for a in fresh:
        existing[a.id] = asdict(a)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    kept = [a for a in existing.values() if datetime.fromisoformat(a["ts"]) >= cutoff]
    return sorted(kept, key=lambda a: a["ts"], reverse=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="FINN push worker")
    p.add_argument("--config", type=Path, default=DATA / "finn_config.json")
    p.add_argument("--announcements", type=Path, default=DATA / "announcements.json")
    p.add_argument("--out", type=Path, default=DATA / "alerts.json")
    p.add_argument("--volume-mult", type=float)
    p.add_argument("--price-pct", type=float)
    p.add_argument("--classifier-model", default=os.getenv("FINN_CLASSIFIER_MODEL", "claude-haiku-5-5"))
    p.add_argument("--extractor-model", default=os.getenv("FINN_EXTRACTOR_MODEL", "claude-haiku-5-5"))
    p.add_argument("--enrich-model", default=os.getenv("FINN_ENRICH_MODEL", "claude-haiku-5-5"),
                   help="model that runs the web-search background lookup")
    p.add_argument("--max-enrich", type=int, default=10, help="max enrichment calls per run")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s")

    cfg = Config.load(args.config)
    if args.volume_mult:
        cfg.volume_mult = args.volume_mult
    if args.price_pct:
        cfg.price_pct = args.price_pct

    api_key = os.getenv("ANTHROPIC_API_KEY")
    client = Anthropic(api_key=api_key) if (api_key and Anthropic) else None
    if client is None:
        log.warning("No ANTHROPIC_API_KEY or SDK: rules-only classification, no enrichment")

    fresh: list[Alert] = []

    log.info("Fetching EOD for %d tickers", len(cfg.portfolio))
    frames = fetch_eod(cfg.portfolio, cfg.suffix, cfg.volume_lookback)
    market = market_alerts(frames, cfg)
    fresh += market
    log.info("Market: %d flagged of %d tickers", len(market), len(frames))

    if args.announcements.exists():
        anns = [a for a in json.loads(args.announcements.read_text()) if a["ticker"] in cfg.portfolio]
        classified = classify_announcements(
            anns, cfg, DATA / ".classification_cache.json", args.classifier_model, client)
        by_alert_id = {_hash("ann", a["id"]): a for a in anns}
        apply_enrichment(classified, by_alert_id, client, DATA / ".enrichment_cache.json",
                         args.extractor_model, args.enrich_model, args.max_enrich)
        fresh += classified
        log.info("Announcements: %d classified (%d triggered)", len(classified),
                 sum(a.triggered for a in classified))
    else:
        log.warning("No announcements file at %s", args.announcements)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    feed = merge_feed(args.out, fresh, cfg.retention_days)
    args.out.write_text(json.dumps(feed, indent=1, ensure_ascii=False))
    log.info("Wrote %d alerts to %s", len(feed), args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
