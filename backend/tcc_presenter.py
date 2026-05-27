"""
tcc_presenter.py — Trade Command Center presentation layer (backend).

All business logic for the TCC "What to trade today?" view lives here:
  - Unified verdict derivation per recommendation
  - Verdict rank, label, tone
  - Sub-indicator tone classification
  - Pre-sorted / pre-grouped sections (ready_now, high_conf_watch,
    low_signals, top_by_engine)
  - Detail URL key per engine (frontend uses this to build the route)

The frontend receives a pre-computed `tcc_sections` dict and only renders it.
No sorting, no filtering, no verdict logic on the UI side.
"""
from __future__ import annotations

from typing import Any

from verdict import VERDICT_LABELS, VERDICT_RANK, VERDICT_TONE

# ── Constants ────────────────────────────────────────────────────────────────

_HIGH_CONF_WATCH_THRESHOLD = 65  # minimum confidence for WATCH to appear in watch section


# ── Verdict helpers ──────────────────────────────────────────────────────────

def rec_verdict(rec: dict[str, Any]) -> str:
    """
    Derive the unified verdict for a recommendation dict.
    Prefers the explicit `verdict` field; falls back to `final_decision` / `signal`.
    """
    v = str(rec.get("verdict") or "").upper().replace(" ", "_").replace("-", "_")
    if v in VERDICT_RANK:
        return v

    # Legacy / engine-native fallback
    fd = str(rec.get("final_decision") or rec.get("signal") or "").upper().replace(" ", "_").replace("-", "_")
    _MAP: dict[str, str] = {
        "STRONG_GO": "STRONG_GO",
        "READY":     "GO",
        "TRADE":     "GO",
        "GO":        "GO",
        "WATCH":     "WATCH",
        "WAIT":      "WAIT",
        "AVOID":     "AVOID",
        "EXIT":      "AVOID",
        "SCALE_OUT": "AVOID",
        "MANAGE":    "WATCH",
    }
    return _MAP.get(fd, "NO_EDGE")


def _verdict_display(verdict: str) -> dict[str, str]:
    """Returns label + tone for the given unified verdict string."""
    return {
        "label": VERDICT_LABELS.get(verdict, verdict),
        "tone":  VERDICT_TONE.get(verdict, "neutral"),
    }


# ── Sub-indicator tone classification ────────────────────────────────────────

_BULLISH_TOKENS = frozenset(["STRONG", "PRIME", "READY", "HIGH_QUALITY", "LOW_RISK", "BULLISH", "CONFIRMED", "ALIGNED"])
_BEARISH_TOKENS = frozenset(["WEAK", "AVOID", "HIGH_RISK", "EXTREME_RISK", "NO_EDGE", "POOR", "FAILED"])
_NEUTRAL_TOKENS = frozenset(["WATCH", "MODERATE", "MEDIUM", "PARTIAL", "MIXED", "ELEVATED", "CAUTION"])


def indicator_tone(value: str) -> str:
    """
    Classify a sub-indicator string as 'bullish', 'bearish', 'warning', or 'neutral'.
    Used for setup_quality, execution_readiness, signal_quality, risk_state, market_bias.
    """
    v = str(value or "").upper()
    if any(t in v for t in _BULLISH_TOKENS):
        return "bullish"
    if any(t in v for t in _BEARISH_TOKENS):
        return "bearish"
    if any(t in v for t in _NEUTRAL_TOKENS):
        return "warning"
    return "neutral"


def _sub_indicators(rec: dict[str, Any]) -> list[dict[str, str]]:
    """Build the list of sub-indicator rows for a recommendation card."""
    fields = [
        ("Setup",     "setup_quality"),
        ("Execution", "execution_readiness"),
        ("Signal",    "signal_quality"),
        ("Risk",      "risk_state"),
        ("Bias",      "market_bias"),
    ]
    rows = []
    for label, key in fields:
        val = str(rec.get(key) or "").strip()
        if val:
            rows.append({"label": label, "value": val, "tone": indicator_tone(val)})
    return rows


# ── Detail route key ─────────────────────────────────────────────────────────

def _detail_route_key(rec: dict[str, Any]) -> str:
    """
    Returns 'day' | 'swing' | 'regular' — the frontend maps this to the actual URL.
    engine_type is authoritative; strategy keywords are only a fallback for unknown engines.
    """
    eng = str(rec.get("engine_type") or "").lower()
    if eng == "day":
        return "day"
    if eng == "regular":
        return "regular"
    if eng == "swing":
        return "swing"
    # Unknown engine: use strategy as fallback (avoid generic options terms like "put"/"call")
    strat = str(rec.get("strategy") or "").lower()
    swing_keywords = ("swing", "credit spread", "debit spread", "iron condor", "butterfly spread")
    if any(k in strat for k in swing_keywords):
        return "swing"
    return "regular"


# ── Full rec enrichment ───────────────────────────────────────────────────────

def enrich_recommendation(rec: dict[str, Any]) -> dict[str, Any]:
    """
    Add presentation fields to a recommendation dict in-place (returns same dict).
    Frontend receives these and renders directly — no derivation needed on UI.
    """
    verdict = rec_verdict(rec)
    rec["verdict"]         = verdict
    rec["verdict_label"]   = VERDICT_LABELS.get(verdict, verdict)
    rec["verdict_tone"]    = VERDICT_TONE.get(verdict, "neutral")
    rec["verdict_rank"]    = VERDICT_RANK.get(verdict, 0)
    rec["sub_indicators"]  = _sub_indicators(rec)
    rec["detail_route_key"] = _detail_route_key(rec)
    return rec


# ── Section builder ──────────────────────────────────────────────────────────

def build_tcc_sections(recommendations: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Given the full enriched recommendation list (already filtered, enriched),
    compute the four pre-grouped sections the TCC page renders directly.

    Returns:
        {
          "top_by_engine":    { "day": rec | None, "swing": rec | None, "regular": rec | None },
          "ready_now":        [rec, ...],   # STRONG_GO + GO, sorted by verdict_rank desc then confidence
          "high_conf_watch":  [rec, ...],   # WATCH with display_confidence >= threshold
          "low_signals":      [rec, ...],   # WAIT + lower-confidence WATCH
        }
    """
    # Enrich all recs (idempotent — safe to call multiple times)
    recs = [enrich_recommendation(dict(r)) for r in recommendations]

    # Sort: verdict_rank desc → display_confidence desc
    recs.sort(key=lambda r: (r["verdict_rank"], int(r.get("display_confidence") or r.get("confidence") or 0)), reverse=True)

    # Top pick per engine (first in sorted order = best)
    top_by_engine: dict[str, Any] = {"day": None, "swing": None, "regular": None}
    for rec in recs:
        eng = str(rec.get("engine_type") or "").lower()
        if eng in top_by_engine and top_by_engine[eng] is None:
            top_by_engine[eng] = rec

    # Sections
    ready_now: list[dict] = []
    high_conf_watch: list[dict] = []
    low_signals: list[dict] = []

    for rec in recs:
        v    = rec["verdict"]
        conf = int(rec.get("display_confidence") or rec.get("confidence") or 0)

        if v in ("STRONG_GO", "GO"):
            ready_now.append(rec)
        elif v == "WATCH" and conf >= _HIGH_CONF_WATCH_THRESHOLD:
            high_conf_watch.append(rec)
        elif v == "WAIT" or (v == "WATCH" and conf < _HIGH_CONF_WATCH_THRESHOLD):
            low_signals.append(rec)
        # AVOID / NO_EDGE are intentionally excluded from all sections

    return {
        "top_by_engine":   top_by_engine,
        "ready_now":       ready_now,
        "high_conf_watch": high_conf_watch,
        "low_signals":     low_signals,
        "conf_threshold":  _HIGH_CONF_WATCH_THRESHOLD,
    }
