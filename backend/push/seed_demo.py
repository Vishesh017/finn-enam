#!/usr/bin/env python3
"""
Writes a SYNTHETIC data/alerts.json with timestamps relative to now, so the Push feed has every
tier and both enrichment types to show before the first real worker run. Enrichment blocks carry
`"sample": true`, which the UI labels "Sample data". The worker's merge keeps these for 30 days;
delete data/alerts.json to start clean.

Headlines, figures and the person are invented fixtures. They do not describe real events.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "data" / "alerts.json"
NOW = datetime.now(timezone.utc)


def ago(hours: float) -> str:
    return (NOW - timedelta(hours=hours)).isoformat()


def ann(ticker, hrs, title, cat, pri, mat, detail="", trig=False, enrichment=None):
    return dict(
        id=hashlib.sha1(f"{ticker}{title}".encode()).hexdigest()[:16], kind="announcement", ticker=ticker,
        ts=ago(hrs), priority=pri, title=title, detail=detail, category=cat, triggered=trig,
        source_url=None, metrics={"materiality": mat}, enrichment=enrichment,
    )


def mkt(ticker, hrs, pct, close, vol, avg, pri="P1", vm=2.0, pp=3.0):
    return dict(
        id=hashlib.sha1(f"mkt{ticker}{hrs}".encode()).hexdigest()[:16], kind="market", ticker=ticker, ts=ago(hrs),
        priority=pri, title=f"{'Up' if pct > 0 else 'Down'} {abs(pct):.1f}%", detail="", category=None,
        triggered=True, source_url=None, enrichment=None,
        metrics=dict(close=close, pct_change=pct, volume=vol, avg_volume=avg, volume_ratio=round(vol / avg, 2), vol_mult=vm, price_pct=pp),
    )


RESULTS_SAMPLE = {"results": {
    "basis": "consolidated", "unit": "INR Cr",
    "periods": {"current": "Q2 FY27", "qoq": "Q1 FY27", "yoy": "Q2 FY26"},
    "current": {"revenue": 64200.0, "ebitda": 17040.0, "pbt": 15900.0, "pat": 12300.0, "ebitda_derived": True},
    "previous_quarter": {"revenue": 62100.5, "ebitda": 16330.0, "pbt": 15200.0, "pat": 11900.0, "ebitda_derived": True},
    "year_ago": {"revenue": 59700.25, "ebitda": 15708.0, "pbt": 14600.0, "pat": 11300.0, "ebitda_derived": True},
    "evidence": None, "unverified": 0, "sample": True,
}}

PERSON_SAMPLE = {"person": {
    "name": "Ananya Rao", "role": "Chief Financial Officer", "action": "appointed",
    "effective": "1 December", "outgoing": None, "found": True,
    "summary": "Finance leader with two decades across manufacturing and technology services, most recently group CFO at a listed engineering company.",
    "career": [
        {"role": "Group CFO", "org": "A listed engineering company", "years": "2019 to 2026"},
        {"role": "VP Finance", "org": "A global IT services firm", "years": "2013 to 2019"},
        {"role": "Finance Controller", "org": "A consumer goods company", "years": "2005 to 2013"},
    ],
    "education": "Chartered accountant; MBA", "sources": [], "sample": True,
}}

alerts = [
    ann("INFY", 3, "Appointment of Chief Financial Officer", "management_change", "P1", 4,
        "Board names a new CFO effective 1 December; the outgoing CFO steps down after a handover period.", True, PERSON_SAMPLE),
    ann("PERSISTENT", 5, "Acquisition of a controlling stake in a data-engineering firm", "M&A", "P1", 4,
        "Agreement to acquire 76% for a cash consideration; completion subject to regulatory approvals.", True),
    mkt("DIXON", 6, -5.8, 11842.5, 3_420_000, 910_000),
    mkt("TATASTEEL", 8, 1.4, 168.2, 61_000_000, 24_000_000, "P2"),
    ann("TCS", 9, "Outcome of Board Meeting: results for the quarter ended 30 September", "results", "P1", 4,
        "Board approved unaudited standalone and consolidated results.", True, RESULTS_SAMPLE),
    ann("SUNPHARMA", 7, "Credit rating reaffirmed at the highest long-term category", "credit_rating", "P2", 3,
        "Agency reaffirmed its top long-term rating with a stable outlook."),
    ann("MARUTI", 11, "Declaration of interim dividend and record date", "dividend", "P2", 3,
        "Interim dividend declared; record date falls next week."),
    ann("LT", 14, "Board approves capital expenditure for a new fabrication facility", "capex", "P2", 3,
        "Spend approved for added capacity; commissioning expected within two years."),
    ann("ITC", 4, "Allotment of shares under employee stock option scheme", "unclassified", "P3", 1),
    ann("HDFCBANK", 10, "Trading window closure intimation", "unclassified", "P3", 1),
    ann("RELIANCE", 12, "Schedule of analyst and institutional investor meetings", "investor_meetings", "P3", 1),
    ann("TITAN", 13, "Transcript of the earnings conference call", "earnings_call", "P3", 1),
    ann("POLYCAB", 16, "Notice of postal ballot", "postal_ballot", "P3", 1),
    ann("ASIANPAINT", 18, "Compliance certificate under Regulation 74(5)", "unclassified", "P3", 1),
    ann("BAJFINANCE", 20, "Newspaper publication of financial results", "unclassified", "P3", 1),
]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(sorted(alerts, key=lambda a: a["ts"], reverse=True), indent=1, ensure_ascii=False))
print(f"Wrote {len(alerts)} synthetic alerts to {OUT}")
