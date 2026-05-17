"""
score_normalizer.py
====================
Cross-engine score normalization for Day, Swing, and Regular trading engines.

Normalized score compares setup quality across engines. It does NOT replace the
original engine score — raw scores are preserved in ``raw_engine_score`` and
``engine_score_breakdown``.

Each engine's ``normalize_*`` function returns a dict with these keys:

  raw_engine_score       float          original score preserved verbatim
  normalized_score       int            0-100 common scale
  normalized_state       str            GO | READY | WATCH | WAIT | EXTENDED |
                                        AVOID | NO-GO
  confidence_band        str            LOW | MEDIUM | HIGH | VERY_HIGH
  execution_bias         str            ENTER_NOW | WAIT_FOR_CONFIRMATION |
                                        WAIT_FOR_PULLBACK | AVOID_CHASE |
                                        NO_CLEAN_ENTRY
  risk_band              str            LOW | MEDIUM | HIGH
  normalized_reason      str            human-readable sentence
  engine_score_breakdown dict           original sub-scores
"""

from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NORMALIZED_REASON_PREAMBLE = (
    "Normalized score compares setup quality across engines. "
    "It does not replace the original engine score."
)


def _confidence_band(confidence: int) -> str:
    if confidence >= 76:
        return "VERY_HIGH"
    if confidence >= 51:
        return "HIGH"
    if confidence >= 26:
        return "MEDIUM"
    return "LOW"


def _risk_band_from_vix(vix: Optional[float], default: str = "MEDIUM") -> str:
    if vix is None:
        return default
    if vix >= 25:
        return "HIGH"
    if vix >= 20:
        return "MEDIUM"
    return "LOW"


def _risk_band_from_label(risk_label: str, vix: Optional[float] = None) -> str:
    rl = str(risk_label or "").upper()
    if rl in ("HIGH", "EXTREME", "VERY_HIGH"):
        return "HIGH"
    if rl == "LOW":
        if vix is not None and vix >= 30:
            return "HIGH"
        return "LOW"
    if vix is not None:
        return _risk_band_from_vix(vix)
    return "MEDIUM"


# State-ranking helpers — higher = better for normalized_score tiebreakers
_NORMALIZED_STATE_RANK: dict[str, int] = {
    "GO": 6,
    "READY": 5,
    "WATCH": 4,
    "WAIT": 3,
    "EXTENDED": 2,
    "AVOID": 1,
    "NO-GO": 0,
}


def normalized_state_rank(state: str) -> int:
    return _NORMALIZED_STATE_RANK.get(str(state).upper().replace("_", "-"), -1)


# ---------------------------------------------------------------------------
# Execution-bias helpers
# ---------------------------------------------------------------------------

def _execution_bias_day(verdict: str, entry_guidance: dict) -> str:
    eg = entry_guidance or {}
    should_enter = str(eg.get("should_enter_now") or "").strip().upper()
    eg_state = str(eg.get("state") or "").strip().upper()

    if should_enter == "YES":
        return "ENTER_NOW"
    if "PULLBACK" in eg_state:
        return "WAIT_FOR_PULLBACK"
    if should_enter == "CONDITIONAL" or "WAIT" in eg_state:
        return "WAIT_FOR_CONFIRMATION"
    if str(verdict).upper() in ("NO-GO",) or "AVOID" in str(verdict).upper():
        return "AVOID_CHASE"
    return "NO_CLEAN_ENTRY"


def _execution_bias_swing(final_action: str, entry_quality: str) -> str:
    fa = str(final_action or "").upper()
    eq = str(entry_quality or "").upper()

    if fa.startswith("STRONG_GO") or fa in ("QUALITY_LONG", "QUALITY_SHORT"):
        return "ENTER_NOW"
    if "WAIT_PULLBACK" in fa or eq == "WAIT_PULLBACK":
        return "WAIT_FOR_PULLBACK"
    if "WAIT" in fa or "WATCH" in fa or eq == "CAUTION_ENTRY":
        return "WAIT_FOR_CONFIRMATION"
    if "AVOID" in fa or eq in ("BAD_ENTRY", "NO_CLEAN_ENTRY"):
        return "AVOID_CHASE"
    return "NO_CLEAN_ENTRY"


def _execution_bias_regular(rec: Optional[dict]) -> str:
    if rec is None:
        return "NO_CLEAN_ENTRY"
    ev = float(rec.get("expected_value") or 0.0)
    dte = int(rec.get("dte") or 0)
    passes_liq = bool(rec.get("passes_liquidity_filter", False))
    passes_rr = bool(rec.get("passes_rr_filter", False))

    if not passes_liq or not passes_rr:
        return "AVOID_CHASE"
    # 3-6 week window (21-42 DTE): tiered entry by time-horizon
    if 21 <= dte <= 27:
        # 3-week: theta accelerating — require positive EV above noise floor
        if ev > 0.10:
            return "ENTER_NOW"
        return "WAIT_FOR_CONFIRMATION"
    if 28 <= dte <= 42:
        # 4-6 week: sweet spot for credit/debit spreads
        if ev > 0.0:
            return "ENTER_NOW"
        return "WAIT_FOR_CONFIRMATION"
    # Outside 3-6w window
    if dte < 21:
        return "WAIT_FOR_CONFIRMATION"
    return "NO_CLEAN_ENTRY"


# ---------------------------------------------------------------------------
# Day engine normalizer
# ---------------------------------------------------------------------------

def _day_score_to_norm(raw: float) -> int:
    """
    Map raw day bull/bear score (0–~9.5) to 0-100 anchored on engine thresholds:
      GO_THRESHOLD  = 4.5  →  ~60
      STRONG_BULL   = 7.0  →  ~85
      Max practical = 9.5  → 100

    VIX thresholds differ intentionally across engines:
      Day:   VIX_NO_GO=40, VIX_CAUTION=30  (intraday — same-day close)
      Swing: VIX_NO_GO=35, VIX_CAUTION=25  (overnight — higher overnight risk)
    These asymmetric gates are correct; do not "unify" them.
    """
    if raw >= 7.0:
        return min(100, int(round(85 + (raw - 7.0) / 2.5 * 15)))
    if raw >= 4.5:
        return int(round(60 + (raw - 4.5) / 2.5 * 25))
    return int(round(raw / 4.5 * 60))


def normalize_day_score(
    *,
    bull_score: float,
    bear_score: float,
    verdict: str,
    metrics: dict,
    decision_confidence: int = 0,
    decision_risk_state: str = "MEDIUM",
    entry_guidance: Optional[dict] = None,
    reasons: Optional[list[str]] = None,
) -> dict:
    """Normalize a Day trade engine result."""
    raw = max(float(bull_score or 0.0), float(bear_score or 0.0))
    norm_score = _day_score_to_norm(raw)

    vix_in = float(metrics.get("vix") or 0) or None

    state = _day_verdict_to_state(str(verdict or ""), vix_in)
    conf_band = _confidence_band(decision_confidence)

    eg = entry_guidance or {}
    exec_bias = _execution_bias_day(verdict, eg)

    risk_val = _risk_band_from_label(decision_risk_state, vix_in)

    reason_list = list(reasons or [])
    detail = reason_list[0] if reason_list else ""
    norm_reason = f"{_NORMALIZED_REASON_PREAMBLE} Day: {detail}" if detail else (
        f"{_NORMALIZED_REASON_PREAMBLE} Day trade evaluation."
    )

    breakdown = {
        "bull_score": round(float(bull_score or 0.0), 2),
        "bear_score": round(float(bear_score or 0.0), 2),
        "verdict": str(verdict or ""),
    }

    return {
        "raw_engine_score": round(raw, 2),
        "normalized_score": norm_score,
        "normalized_state": state,
        "confidence_band": conf_band,
        "execution_bias": exec_bias,
        "risk_band": risk_val,
        "normalized_reason": norm_reason,
        "engine_score_breakdown": breakdown,
    }


def _day_verdict_to_state(verdict: str, vix: Optional[float]) -> str:
    v = verdict.upper().replace("_", "-").replace(" ", "-")

    # Day engine intentionally uses higher VIX gates than swing (40/30 vs 35/25)
    # because intraday trades close same day — overnight gap risk is absent.
    if vix is not None and vix >= 40:
        return "AVOID"

    downgrade = vix is not None and vix >= 30

    if v == "STRONG-GO":
        return "READY" if downgrade else "GO"
    if v == "GO":
        return "WATCH" if downgrade else "READY"
    if v == "WATCH":
        return "WATCH"
    if v == "WAIT":
        return "WAIT"
    if v in ("NO-GO", "NOGO", "NO_GO"):
        return "NO-GO"
    return "WATCH"


# ---------------------------------------------------------------------------
# Swing engine normalizer
# ---------------------------------------------------------------------------

def _swing_score_to_norm(raw: float) -> int:
    """
    Map swing trade_quality_score (0–10, clamped by engine) to 0-100 anchored on thresholds:
      GO_THRESHOLD     = 5.5  →  ~60
      STRONG_THRESHOLD = 8.0  →  ~85
      Max              = 10   → 100

    Comparable to _day_score_to_norm: both engines' GO signals map to ~60.
    """
    if raw >= 8.0:
        return min(100, int(round(85 + (raw - 8.0) / 2.0 * 15)))
    if raw >= 5.5:
        return int(round(60 + (raw - 5.5) / 2.5 * 25))
    return int(round(raw / 5.5 * 60))


def normalize_swing_score(
    *,
    trade_quality_score: Optional[float],
    verdict: str,
    final_action: str,
    entry_quality: str,
    risk_level: str,
    swing_bias: str,
    decision_confidence: int = 0,
    decision_risk_state: str = "MEDIUM",
    metrics: Optional[dict] = None,
    bull_score: float = 0.0,
    bear_score: float = 0.0,
    reasons: Optional[list[str]] = None,
) -> dict:
    """Normalize a Swing trade engine result."""
    raw = float(trade_quality_score or 0.0)
    norm_score = _swing_score_to_norm(raw)

    _metrics = metrics or {}
    vix_in = float(_metrics.get("vix") or 0) or None

    state = _swing_quality_to_state(trade_quality_score, verdict, final_action, vix_in)
    conf_band = _confidence_band(decision_confidence)
    exec_bias = _execution_bias_swing(final_action, entry_quality)
    risk_val = _risk_band_from_label(risk_level, vix_in)

    reason_list = list(reasons or [])
    detail = reason_list[0] if reason_list else ""
    norm_reason = f"{_NORMALIZED_REASON_PREAMBLE} Swing: {detail}" if detail else (
        f"{_NORMALIZED_REASON_PREAMBLE} Swing trade evaluation."
    )

    breakdown = {
        "trade_quality_score": round(raw, 2),
        "bull_score": round(float(bull_score or 0.0), 2),
        "bear_score": round(float(bear_score or 0.0), 2),
        "verdict": str(verdict or ""),
        "final_action": str(final_action or ""),
    }

    return {
        "raw_engine_score": round(raw, 2),
        "normalized_score": norm_score,
        "normalized_state": state,
        "confidence_band": conf_band,
        "execution_bias": exec_bias,
        "risk_band": risk_val,
        "normalized_reason": norm_reason,
        "engine_score_breakdown": breakdown,
    }


def _swing_quality_to_state(
    trade_quality_score: Optional[float],
    verdict: str,
    final_action: str,
    vix: Optional[float],
) -> str:
    tqs = float(trade_quality_score or 0.0)
    fa = str(final_action or "").upper()
    v = str(verdict or "").upper().replace("_", "-")

    if vix is not None and vix >= 35:
        return "AVOID"

    downgrade = vix is not None and vix >= 25

    # Score-based thresholds first (higher priority than action labels)
    if tqs >= 8.5:
        return "WATCH" if downgrade else "GO"
    if tqs >= 7.0:
        if fa.startswith("AVOID") or fa.startswith("NO_TRADE"):
            return "AVOID"  # risk override
        return "WATCH" if downgrade else "READY"
    if tqs >= 5.0:
        return "WATCH"

    # Low-score: use final_action labels but don't elevate to GO when score is low
    if fa.startswith("STRONG_GO") or fa in ("QUALITY_LONG", "QUALITY_SHORT", "STRONG_GO_CALL", "STRONG_GO_PUT"):
        return "WATCH"  # score too low for full GO elevation
    if fa.startswith("WATCH") or fa.startswith("WAIT_PULLBACK"):
        return "WATCH"
    if fa.startswith("WAIT_BREAKOUT") or fa.startswith("WAIT"):
        return "WAIT"
    if fa.startswith("AVOID") or fa.startswith("NO_TRADE"):
        return "AVOID"

    if tqs >= 3.0:
        return "WAIT"
    return "NO-GO"


# ---------------------------------------------------------------------------
# Regular (options) engine normalizer
# ---------------------------------------------------------------------------

def _regular_score_to_norm(raw: float) -> int:
    """Map total_score (0-100) to 0-100 normalized scale anchored on state thresholds:
      GO    >= 70  →  ~85
      READY >= 50  →  ~60
      WATCH >= 30  →  ~30
    """
    if raw >= 70:
        return min(100, int(round(85 + (raw - 70) / 30 * 15)))
    if raw >= 50:
        return int(round(60 + (raw - 50) / 20 * 25))
    if raw >= 30:
        return int(round(30 + (raw - 30) / 20 * 30))
    return int(round(raw / 30 * 30))


def normalize_regular_score(
    *,
    top_candidate: Optional[dict],
    signals: Optional[dict],
    decision_confidence: int = 0,
    decision_risk_state: str = "MEDIUM",
    decision_reason: str = "",
) -> dict:
    """Normalize a Regular (options) engine result."""
    raw: float = 0.0
    norm_score: int = 0

    if top_candidate is not None:
        scores = top_candidate.get("scores") or {}
        raw = float(scores.get("total_score") or 0.0)
        norm_score = _regular_score_to_norm(raw)

    sig = signals or {}
    bias_conf = int(sig.get("bias_confidence") or 0)
    conf_band = _confidence_band(max(decision_confidence, bias_conf))

    state = _regular_score_to_state(top_candidate, raw)
    exec_bias = _execution_bias_regular(top_candidate)

    iv_rank = float(sig.get("iv_rank") or 0)
    env = str(sig.get("iv_environment") or "").upper()
    if iv_rank >= 65 and "sell" not in env.lower():
        risk_val = "HIGH"
    elif decision_risk_state in ("HIGH", "EXTREME"):
        risk_val = "HIGH"
    elif decision_risk_state == "LOW":
        risk_val = "LOW"
    else:
        risk_val = "MEDIUM"

    detail = decision_reason or ""
    norm_reason = f"{_NORMALIZED_REASON_PREAMBLE} Regular: {detail}" if detail else (
        f"{_NORMALIZED_REASON_PREAMBLE} Options evaluation."
    )

    breakdown: dict[str, Any] = {"total_score": round(raw, 2)}
    if top_candidate is not None:
        scores = top_candidate.get("scores") or {}
        for k in ("signal_score", "structure_score", "liquidity_score", "iv_fit_score"):
            if k in scores:
                breakdown[k] = scores[k]
        if "expected_value" in top_candidate:
            breakdown["expected_value"] = round(float(top_candidate["expected_value"]), 4)
        if "edge_ratio" in top_candidate:
            breakdown["edge_ratio"] = round(float(top_candidate["edge_ratio"]), 4)

    return {
        "raw_engine_score": round(raw, 2),
        "normalized_score": norm_score,
        "normalized_state": state,
        "confidence_band": conf_band,
        "execution_bias": exec_bias,
        "risk_band": risk_val,
        "normalized_reason": norm_reason,
        "engine_score_breakdown": breakdown,
    }


def _regular_score_to_state(top_candidate: Optional[dict], total_score: float) -> str:
    if top_candidate is None:
        return "NO-GO"

    ev = float(top_candidate.get("expected_value") or 0.0)
    if ev <= 0.0:
        return "NO-GO"

    if total_score >= 70:
        return "GO"
    if total_score >= 50:
        return "READY"
    if total_score >= 30:
        return "WATCH"
    if total_score >= 15:
        return "WAIT"
    return "NO-GO"


# ---------------------------------------------------------------------------
# Cross-engine confidence block normalizer
# ---------------------------------------------------------------------------

def normalize_confidence_block(engine: str, raw_conf: Optional[dict]) -> dict:
    """
    Return a unified confidence structure with consistent field names across engines.

    Day engine produces:   trend_strength, breakout_quality, volume_confirmation,
                           market_alignment, risk
    Swing engine produces: trend_quality, momentum_health, volume_participation, risk

    This function maps both to a common schema so the frontend can use one layout.
    Missing fields from either engine are filled with None.
    """
    c = raw_conf or {}
    if engine == "day":
        return {
            "trend_strength":       c.get("trend_strength"),
            "trend_quality":        c.get("trend_strength"),        # alias
            "breakout_quality":     c.get("breakout_quality"),
            "volume_confirmation":  c.get("volume_confirmation"),
            "volume_participation": c.get("volume_confirmation"),   # alias
            "market_alignment":     c.get("market_alignment"),
            "momentum_health":      None,                           # day engine N/A
            "risk":                 c.get("risk"),
        }
    if engine == "swing":
        return {
            "trend_strength":       c.get("trend_quality"),         # alias
            "trend_quality":        c.get("trend_quality"),
            "breakout_quality":     None,                           # swing engine N/A
            "volume_confirmation":  c.get("volume_participation"),  # alias
            "volume_participation": c.get("volume_participation"),
            "market_alignment":     None,                           # swing engine N/A
            "momentum_health":      c.get("momentum_health"),
            "risk":                 c.get("risk"),
        }
    # Regular engine has no confidence block
    return {k: None for k in (
        "trend_strength", "trend_quality", "breakout_quality",
        "volume_confirmation", "volume_participation",
        "market_alignment", "momentum_health", "risk",
    )}
