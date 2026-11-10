"""
FINN push-side enrichment.

  results             -> Revenue, EBITDA, PBT, PAT for the latest quarter, with QoQ and YoY bases,
                         read from the filing itself. A Reg-33 results table prints the latest
                         quarter, the preceding quarter and the year-ago quarter side by side,
                         so one filing is enough for both comparisons.
  management_change   -> who is joining, and a short sourced background on them.

Trust model: the language model reads, Python checks.
  * Every number the model returns must appear in the filing text, or it is dropped.
  * EBITDA is taken from the filing only if printed; otherwise Python derives it from verified
    components. The model never does the arithmetic.
  * A background with no citation is discarded rather than shown.
"""
from __future__ import annotations

import io
import json
import logging
import re
from typing import Any

log = logging.getLogger("finn.enrich")

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore
try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None  # type: ignore

SKIP: dict[str, Any] = {"skip": True}  # definitive "nothing to enrich", safe to cache

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

UNIT_TO_CRORE = {
    "crore": 1.0, "crores": 1.0, "cr": 1.0,
    "lakh": 0.01, "lakhs": 0.01, "lac": 0.01, "lacs": 0.01,
    "million": 0.1, "millions": 0.1, "mn": 0.1,
    "thousand": 0.0001, "thousands": 0.0001,
}

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def fetch_filing_text(url: str, max_pages: int = 30, max_bytes: int = 20_000_000) -> str | None:
    """Text of a results PDF, or None if it cannot be fetched or read."""
    if requests is None or PdfReader is None:
        log.warning("requests/pypdf not installed; cannot read %s", url)
        return None
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=30)
        r.raise_for_status()
        if len(r.content) > max_bytes or not r.content.startswith(b"%PDF"):
            return None
        reader = PdfReader(io.BytesIO(r.content))
        return "\n".join((p.extract_text() or "") for p in reader.pages[:max_pages])
    except Exception as exc:
        log.warning("could not read filing %s: %s", url, exc)
        return None


def _text(resp: Any) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


def _json_obj(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(text[start:end + 1])


def _call_json(client: Any, model: str, system: str, user: str, max_tokens: int) -> dict[str, Any] | None:
    for attempt in range(2):
        try:
            resp = client.messages.create(
                model=model, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user}],
            )
            return _json_obj(_text(resp))
        except Exception as exc:
            log.warning("model call failed (attempt %d): %s", attempt + 1, exc)
    return None


def quarter_label(period_end: str) -> str | None:
    """'2026-09-30' -> 'Q2 FY27'. Indian financial years run April to March."""
    m = re.match(r"(\d{4})-(\d{2})-\d{2}", period_end or "")
    if not m:
        return None
    year, month = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
        return None
    fy_end = year + 1 if month >= 4 else year
    q = (month - 4) // 3 + 1 if month >= 4 else 4
    return f"Q{q} FY{str(fy_end)[-2:]}"


def _digits_only(text: str) -> str:
    """Drop thousands separators so '62,613.40' and '62613.40' compare equal."""
    return re.sub(r"(?<=\d),(?=\d)", "", text)


def _present(value: float, haystack: str) -> bool:
    """True if the number appears in the filing as a whole token, not inside a longer number."""
    a = abs(value)
    forms = {f"{a:.2f}", f"{a:.1f}", f"{a:.0f}", f"{a:.2f}".rstrip("0").rstrip(".")}
    return any(re.search(rf"(?<![\d.]){re.escape(f)}(?!\d|\.\d)", haystack) for f in forms)


def _squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# --------------------------------------------------------------------------- #
# Quarterly results
# --------------------------------------------------------------------------- #

RESULTS_SYSTEM = """You read the text of an Indian listed company's quarterly results filing (SEBI LODR Regulation 33 table).

Extract the figures for exactly three columns, ignoring six-month, nine-month and full-year columns:
  "current"           the latest quarter
  "previous_quarter"  the quarter immediately before it
  "year_ago"          the same quarter one year earlier

Use consolidated figures if the filing has both, otherwise standalone.
Copy every number exactly as printed. Do not calculate, round, convert or estimate anything.
"revenue" is Revenue from operations (for a bank or NBFC with no such line, Total income; state the printed label).
"ebitda" only if the filing prints EBITDA or operating profit explicitly, otherwise null.
"finance_costs", "depreciation" (and amortisation) and "other_income" are the printed line items; use positive numbers.
"pbt" is profit before tax and "pat" is net profit after tax for the period. Losses are negative.
"unit" is the unit the table states: crore, lakh, million or thousand.
"evidence" is one verbatim line from the table, 25 words or fewer, that shows the revenue figures.
If the text is not a quarterly results table, return {"not_results": true}.

Return JSON only, no prose, no code fences:
{"basis": "consolidated"|"standalone", "unit": string, "revenue_label": string,
 "columns": [{"role": "current"|"previous_quarter"|"year_ago", "period_end": "YYYY-MM-DD",
   "revenue": number|null, "ebitda": number|null, "pbt": number|null, "pat": number|null,
   "finance_costs": number|null, "depreciation": number|null, "other_income": number|null}],
 "evidence": string}"""


def _figures(col: dict[str, Any], hay: str, factor: float) -> tuple[dict[str, Any], int]:
    bad = 0

    def verified(key: str) -> float | None:
        nonlocal bad
        x = col.get(key)
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            return None
        if _present(float(x), hay):
            return float(x)
        bad += 1  # model returned a number that is not in the filing
        return None

    revenue, pbt, pat = verified("revenue"), verified("pbt"), verified("pat")
    ebitda = verified("ebitda")
    derived = False
    if ebitda is None:
        fin, dep, oth = verified("finance_costs"), verified("depreciation"), verified("other_income")
        if None not in (pbt, fin, dep, oth):
            ebitda = pbt + fin + dep - oth  # type: ignore[operator]
            derived = True

    def conv(x: float | None) -> float | None:
        return None if x is None else round(x * factor, 2)

    return {"revenue": conv(revenue), "ebitda": conv(ebitda), "pbt": conv(pbt), "pat": conv(pat),
            "ebitda_derived": derived and ebitda is not None}, bad


def extract_results(client: Any, model: str, filing_text: str) -> dict[str, Any] | None:
    """Returns an enrichment dict, SKIP (not a results table), or None (transient failure)."""
    raw = _call_json(client, model, RESULTS_SYSTEM, filing_text[:60_000], 1500)
    if raw is None:
        return None
    if raw.get("not_results"):
        return SKIP

    factor = UNIT_TO_CRORE.get(str(raw.get("unit", "")).strip().lower())
    if factor is None:
        log.warning("unrecognised unit %r; skipping", raw.get("unit"))
        return SKIP

    hay = _digits_only(filing_text)
    cols = {c.get("role"): c for c in raw.get("columns", []) if isinstance(c, dict)}
    if "current" not in cols:
        return SKIP

    unverified = 0
    figures: dict[str, dict[str, Any]] = {}
    labels: dict[str, str | None] = {}
    for role in ("current", "previous_quarter", "year_ago"):
        if role not in cols:
            continue
        figures[role], bad = _figures(cols[role], hay, factor)
        unverified += bad
        labels[role] = quarter_label(str(cols[role].get("period_end", "")))

    cur = figures["current"]
    if cur["revenue"] is None and cur["pat"] is None:
        return SKIP

    evidence = raw.get("evidence")
    evidence_ok = isinstance(evidence, str) and len(_squash(evidence)) >= 20 and _squash(evidence) in _squash(filing_text)

    return {
        "basis": raw.get("basis") if raw.get("basis") in ("consolidated", "standalone") else "standalone",
        "unit": "INR Cr",
        "periods": {"current": labels.get("current"), "qoq": labels.get("previous_quarter"), "yoy": labels.get("year_ago")},
        "current": cur,
        "previous_quarter": figures.get("previous_quarter"),
        "year_ago": figures.get("year_ago"),
        "evidence": evidence if evidence_ok else None,
        "unverified": unverified,
        "model": model,
    }


# --------------------------------------------------------------------------- #
# Management change
# --------------------------------------------------------------------------- #

PERSON_SYSTEM = """You read an Indian stock-exchange filing about a change in senior management or the board.
Identify the person who is JOINING or being (re)appointed, if the filing names one.
Use only the text given. If no incoming person is named, set incoming to null.
Return JSON only, no prose, no code fences:
{"incoming": string|null, "incoming_role": string|null, "outgoing": string|null,
 "action": "appointed"|"reappointed"|"resigned"|"retired"|"other",
 "effective": string|null, "company": string|null}"""

BIO_PROMPT = """Find the professional background of {name}, who is being appointed {role} at {company} (India).

Use web search. Rules:
- State only facts that appear in the search results. Do not use memory.
- Confirm it is the same person: the results must connect the name to {company} or to a career consistent with this role. If you cannot confirm that, return {{"found": false}}.
- No speculation about character, performance or the reason for the change.
Return JSON only, no prose, no code fences:
{{"found": true, "summary": "at most 45 words on who they are and where they come from",
  "career": [{{"role": string, "org": string, "years": string|null}}],
  "education": string|null}}
career has at most 4 entries, most recent first."""


def _citations(resp: Any) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for block in resp.content:
        if getattr(block, "type", "") == "text":
            for c in getattr(block, "citations", None) or []:
                url = getattr(c, "url", None)
                if url and url not in seen:
                    seen[url] = {"title": getattr(c, "title", None) or url, "url": url}
    if not seen:  # fall back to the pages the search actually returned
        for block in resp.content:
            if getattr(block, "type", "") == "web_search_tool_result" and isinstance(getattr(block, "content", None), list):
                for r in block.content[:3]:
                    url = getattr(r, "url", None)
                    if url and url not in seen:
                        seen[url] = {"title": getattr(r, "title", None) or url, "url": url}
    return list(seen.values())[:4]


def lookup_background(client: Any, model: str, name: str, role: str, company: str) -> dict[str, Any] | None:
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": BIO_PROMPT.format(name=name, role=role, company=company)}
    ]
    tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
    try:
        resp = None
        for _ in range(3):  # long searches can pause the turn
            resp = client.messages.create(model=model, max_tokens=1500, tools=tools, messages=messages)
            if resp.stop_reason != "pause_turn":
                break
            messages = [messages[0], {"role": "assistant", "content": resp.content}]
        data = _json_obj(_text(resp))
    except Exception as exc:
        log.warning("background lookup failed for %s: %s", name, exc)
        return None

    sources = _citations(resp)
    if not data.get("found") or not sources:
        return {"found": False}  # no citation, no bio
    career = [c for c in data.get("career", []) if isinstance(c, dict) and c.get("role") and c.get("org")][:4]
    return {
        "found": True,
        "summary": str(data.get("summary", "")).strip(),
        "career": [{"role": str(c["role"]), "org": str(c["org"]), "years": c.get("years")} for c in career],
        "education": data.get("education"),
        "sources": sources,
    }


def extract_person(client: Any, model: str, headline: str, body: str) -> dict[str, Any] | None:
    return _call_json(client, model, PERSON_SYSTEM, f"{headline}\n\n{body[:2500]}", 400)


def enrich_person(client: Any, extractor_model: str, enrich_model: str, a: dict[str, Any]) -> dict[str, Any] | None:
    info = extract_person(client, extractor_model, a["headline"], a.get("body") or "")
    if info is None:
        return None
    name = (info.get("incoming") or "").strip()
    if not name:
        return SKIP
    role = (info.get("incoming_role") or "a senior role").strip()
    company = (info.get("company") or a["ticker"]).strip()

    bio = lookup_background(client, enrich_model, name, role, company)
    if bio is None:
        return None
    return {"person": {
        "name": name, "role": role, "action": info.get("action") or "appointed",
        "effective": info.get("effective"), "outgoing": info.get("outgoing"),
        **bio,
    }}


# --------------------------------------------------------------------------- #
# Entry point used by finn_push.py
# --------------------------------------------------------------------------- #

def enrich_announcement(
    client: Any, a: dict[str, Any], category: str, extractor_model: str, enrich_model: str
) -> dict[str, Any] | None:
    """Returns {"results": ...} or {"person": ...}, SKIP, or None when it should be retried later."""
    if category == "results":
        text = a.get("filing_text") or (fetch_filing_text(a["attachment_url"]) if a.get("attachment_url") else None)
        if not text:
            return None if a.get("attachment_url") else SKIP
        out = extract_results(client, extractor_model, text)
        return out if out is None or out is SKIP else {"results": out}
    if category == "management_change":
        return enrich_person(client, extractor_model, enrich_model, a)
    return SKIP
