"""
trade_aggregator.py
===================
Shared per-ticker engine running + aggregation for:
  - /trade-command-center  (command_center_router.py)
  - /watchlistx             (main.py can reuse the helpers)

Imports ONLY from engine modules, analysis, storage, models.
Never imports from main.py to avoid the circular import that would arise because
main.py imports command_center_router which now imports trade_aggregator.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

import bar_cache

from analysis import generate_signals
from day_trade import run_day_trade_scan
from decision_resolver import resolve_trade_decision
from engine import pick_expiry_by_dte, run_engine
from score_normalizer import normalize_day_score, normalize_regular_score, normalize_swing_score
from storage import (
    fetch_iv_atm_history_strict_before,
    get_user_state,
    normalize_email,
    upsert_iv_atm_snapshot,
)
from swing_trade import run_swing_trade_scan

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_agg_cache: dict[str, tuple[float, dict]] = {}
_agg_cache_lock = threading.Lock()

MARKET_HOURS_TTL = 90    # seconds during market hours
OFF_HOURS_TTL    = 600   # 10 minutes off-hours

# Cap tickers evaluated per command-center request (first call is slow — 3 engine
# calls × N yfinance fetches; cache makes subsequent calls instant).
MAX_TICKERS      = 15
# Parallelism for the per-ticker engine runs
THREAD_POOL_SIZE = 6


def _is_market_hours() -> bool:
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    return 4 * 60 <= mins < 13 * 60


def _cache_ttl() -> int:
    return MARKET_HOURS_TTL if _is_market_hours() else OFF_HOURS_TTL


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        f = float(val)
        return f if f == f else default  # NaN guard
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Watchlist source items
# Mirrors _watchlistx_source_items() in main.py — must stay in sync.
# ---------------------------------------------------------------------------

def get_source_items(state: dict) -> list[dict]:
    """
    Build ticker list from my_tickers only.
    """
    merged: dict[str, dict] = {}

    def _ensure(ticker: str, *, source: str, notes: str = "", added_at: str = "") -> None:
        t = str(ticker or "").strip().upper()
        if not t:
            return
        item = merged.get(t)
        if item is None:
            item = {"ticker": t, "id": f"wlx-{t}", "notes": notes or None, "added_at": added_at, "sources": []}
            merged[t] = item
        if source not in item["sources"]:
            item["sources"].append(source)
        if not item.get("notes") and notes and notes.strip():
            item["notes"] = notes.strip()

    for mt in state.get("my_tickers") or []:
        sym = str(mt.get("symbol", "") or "").strip().upper()
        if not sym:
            continue
        types = mt.get("trade_types") or ["regular"]
        company = str(mt.get("company_name", "") or "")
        for src in types:
            _ensure(sym, source=src, notes=company)

    return sorted(merged.values(), key=lambda x: str(x.get("ticker") or ""))


# ---------------------------------------------------------------------------
# Regular engine (options analysis) — stripped-down version of _analyze_ticker
# Returns a dict suitable for resolve_trade_decision; no AnalyzeResponse object.
# ---------------------------------------------------------------------------

def _analyze_regular(ticker: str) -> Optional[dict]:
    """
    Run the regular (options) engine for a single ticker.

    Returns a minimal dict:
      signals:         dict of signal fields the resolver needs
      recommendations: list of recommendation dicts the resolver needs
      price, change_pct, trend, rsi, company_name, target_expiry

    Returns None on any failure (no history, no options, yfinance error, etc.).
    """
    try:
        hist = bar_cache.get_history(ticker, period="1y", interval="1d")
        if hist is None or hist.empty or len(hist) < 60:
            return None

        opt_dates = list(bar_cache.get_option_dates(ticker) or [])
        if not opt_dates:
            return None

        # ~4-week expiry (21–35 DTE), fallback to 3rd listed
        target_expiry = pick_expiry_by_dte(opt_dates, 21, 35)
        if target_expiry is None:
            target_expiry = opt_dates[min(2, len(opt_dates) - 1)]

        try:
            calls_raw, puts_raw = bar_cache.get_option_chain(ticker, target_expiry)
        except Exception:
            return None

        # Live price (prefer .info; fall back to last hist close)
        hist_close = _safe_float(hist["Close"].iloc[-1])
        try:
            info       = bar_cache.get_info(ticker)
            live_price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        except Exception:
            info       = {}
            live_price = 0.0
        price = live_price if live_price > 0 else hist_close
        if price <= 0:
            return None

        # Strike filter ±30% of spot (mirrors _analyze_ticker in main.py)
        calls_f = calls_raw[(calls_raw["strike"] >= price * 0.75) & (calls_raw["strike"] <= price * 1.30)].copy()
        puts_f  = puts_raw[(puts_raw["strike"]  >= price * 0.75) & (puts_raw["strike"]  <= price * 1.30)].copy()

        # IV rank history
        session_et = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
        iv_hist = fetch_iv_atm_history_strict_before(ticker, session_et, limit=380)

        signals = generate_signals(hist, calls_f, puts_f, reference_price=price, implied_iv_history=iv_hist)
        try:
            upsert_iv_atm_snapshot(ticker, session_et, signals.current_iv)
        except Exception:
            pass

        trades = run_engine(signals, calls_f, puts_f, opt_dates, weeks_out=4, strategy_mode="all")

        # Flat dict — the resolver calls _to_dict() which handles plain dicts natively
        signals_dict: dict = {
            "current_price":     signals.current_price,
            "prev_close":        signals.prev_close,
            "price_change_pct":  signals.price_change_pct,
            "trend":             signals.trend,
            "rsi":               signals.rsi,
            "directional_bias":  signals.directional_bias,
            "bias_confidence":   signals.bias_confidence,
            "iv_rank":           signals.iv_rank,
            "iv_environment":    signals.iv_environment,
            "volatility_regime": signals.volatility_regime,
        }

        recs_list: list[dict] = [
            {
                "strategy":               t.strategy,
                "bias":                   t.bias,
                "expiry":                 t.expiry,
                "dte":                    t.dte,
                "net_credit":             t.net_credit,
                "spread_width":           t.spread_width,
                "expected_value":         t.expected_value,
                "edge_ratio":             t.edge_ratio,
                "passes_rr_filter":       t.passes_rr_filter,
                "passes_liquidity_filter":t.passes_liquidity_filter,
                "passes_credit_filter":   t.passes_credit_filter,
                "scores":                 {"total_score": t.total_score, "signal_score": t.signal_score},
                "warnings":               list(t.warnings or []),
            }
            for t in trades
        ]

        return {
            "signals":         signals_dict,
            "recommendations": recs_list,
            "price":           price,
            "change_pct":      _safe_float(signals.price_change_pct),
            "trend":           str(signals.trend or "NEUTRAL"),
            "rsi":             _safe_float(signals.rsi),
            "company_name":    str((info or {}).get("longName") or ticker),
            "target_expiry":   target_expiry,
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Decision payload builder
# Mirrors _watchlistx_decision_payload() in main.py — keep in sync.
# ---------------------------------------------------------------------------

def decision_payload(
    decision: Any,
    *,
    label: str,
    raw_signal: str = "",
    reason: str = "",
) -> dict:
    """
    Normalise a ResolvedTradeDecision (or None) into a flat dict.
    Preserves the resolver's final_decision verbatim (no watchlistx remapping)
    so the command center gets READY / WATCH / WAIT / AVOID / EXIT / NO_EDGE.

    Normalized scoring fields are added by _compute_ticker_engines() after
    calling the engine-specific normalizer.
    """
    reason_text = str(reason or "")
    if decision is None:
        return {
            "engine":              label,
            "market_bias":         "NEUTRAL",
            "setup_quality":       "WEAK",
            "execution_readiness": "WAIT",
            "final_decision":      "NO_EDGE",
            "confidence":          0,
            "reason":              reason_text or f"{label.title()} evaluation unavailable.",
            "supporting_factors":  [],
            "missing_confirmations": [],
            "risk_state":          "MEDIUM",
            "raw_signal":          raw_signal,
            "signal_quality":      "",
            "execution_timing":    "",
            "risk_category":       "",
            "explanation":         {},
            "risk_reason":         "",
            "display_confidence":  0,
            "execution_fields":    [],
            "raw_engine_score":    0.0,
            "normalized_score":    0,
            "normalized_state":    "",
            "confidence_band":     "LOW",
            "execution_bias":      "NO_CLEAN_ENTRY",
            "risk_band":           "MEDIUM",
            "normalized_reason":   "",
            "engine_score_breakdown": {},
            "option_risk_context":   {},
        }
    return {
        "engine":              label,
        "market_bias":         decision.market_bias,
        "setup_quality":       decision.setup_quality,
        "execution_readiness": decision.execution_readiness,
        "final_decision":      str(decision.final_decision or "NO_EDGE").upper(),
        "confidence":          int(decision.confidence or 0),
        "reason":              decision.reason or reason_text,
        "supporting_factors":  list(decision.supporting_factors or []),
        "missing_confirmations": list(decision.missing_confirmations or []),
        "risk_state":          decision.risk_state,
        "raw_signal":          raw_signal,
        "signal_quality":      decision.signal_quality or "",
        "execution_timing":    decision.execution_timing or "",
        "risk_category":       decision.risk_category or "",
        "explanation":         dict(decision.explanation or {}),
        "risk_reason":         decision.risk_reason or "",
        "display_confidence":  int(decision.display_confidence or 0),
        "execution_fields":    list(decision.execution_fields or []),
        "raw_engine_score":    0.0,
        "normalized_score":    0,
        "normalized_state":    "",
        "confidence_band":     "LOW",
        "execution_bias":      "NO_CLEAN_ENTRY",
        "risk_band":           "MEDIUM",
        "normalized_reason":   "",
        "engine_score_breakdown": {},
        "option_risk_context":   {},
    }


# ---------------------------------------------------------------------------
# Per-ticker multi-engine runner
# ---------------------------------------------------------------------------

def _compute_ticker_engines(ticker: str) -> dict:
    """
    Run all three engines for one ticker and return resolved decision payloads.
    Each engine is isolated — a failure in one does not abort the others.
    Swing runs first to provide daily trend context to the day engine.
    """
    # ── Swing (runs first to provide daily context for day engine) ──────────────
    swing_decision = None
    swing_reason   = ""
    swing_raw      = ""
    swing_scan     = None
    try:
        swing_scan = run_swing_trade_scan(ticker)
        swing_decision = resolve_trade_decision({
            "engine_type":         "swing",
            "ticker":              swing_scan.ticker,
            "verdict":             swing_scan.verdict,
            "bias":                swing_scan.bias,
            "reasons":             swing_scan.reasons,
            "metrics":             swing_scan.metrics,
            "swing_bias":          swing_scan.swing_bias,
            "entry_quality":       swing_scan.entry_quality,
            "risk_level":          swing_scan.risk_level,
            "final_action":        swing_scan.final_action,
            "trade_quality_score": swing_scan.trade_quality_score,
            "decision_message":    swing_scan.decision_message,
            "confirmation_needed": swing_scan.confirmation_needed,
            "avoid_reason":        swing_scan.avoid_reason,
        })
        swing_reason = swing_decision.reason
        swing_raw    = str(swing_scan.final_action or "")
    except Exception as exc:
        swing_reason = f"Swing evaluation unavailable: {exc}"

    # Build daily trend context from swing scan for the day engine
    _daily_context: Optional[dict] = None
    if swing_scan is not None:
        _sb = getattr(swing_scan, "bias", None)
        _sv = str(getattr(swing_scan, "verdict", "") or "")
        if _sb and _sv:
            _daily_context = {"bias": str(_sb), "verdict": _sv}

    # ── Day (with swing daily trend context) ───────────────────────────────────
    day_decision = None
    day_reason   = ""
    day_raw      = ""
    day_metrics: dict = {}
    day_scan     = None
    try:
        day_scan = run_day_trade_scan(ticker, daily_trend_context=_daily_context)
        day_decision = resolve_trade_decision({
            "engine_type":     "day",
            "ticker":          day_scan.ticker,
            "verdict":         day_scan.verdict,
            "bias":            day_scan.bias,
            "reasons":         day_scan.reasons,
            "metrics":         day_scan.metrics,
            "trader_decision": day_scan.trader_decision,
        })
        day_metrics = dict(day_scan.metrics or {})
        day_reason  = day_decision.reason
        day_raw     = str(day_scan.verdict or "")
    except Exception as exc:
        day_reason = f"Day evaluation unavailable: {exc}"

    # ── Regular ───────────────────────────────────────────────────────────────
    regular_decision = None
    regular_reason   = ""
    regular_raw      = ""
    regular_data: Optional[dict] = None
    try:
        regular_data = _analyze_regular(ticker)
        if regular_data:
            regular_decision = resolve_trade_decision({
                "engine_type":     "regular",
                "signals":         regular_data["signals"],
                "recommendations": regular_data["recommendations"],
            })
            regular_reason = regular_decision.reason
            regular_raw    = str(regular_decision.final_decision or "")
        else:
            regular_reason = "No options data available."
    except Exception as exc:
        regular_reason = f"Regular evaluation unavailable: {exc}"

    # ── Build decision payloads ───────────────────────────────────────────────
    day_payload     = decision_payload(day_decision,     label="day",     raw_signal=day_raw,     reason=day_reason)
    swing_payload   = decision_payload(swing_decision,   label="swing",   raw_signal=swing_raw,   reason=swing_reason)
    regular_payload = decision_payload(regular_decision, label="regular", raw_signal=regular_raw, reason=regular_reason)

    # ── Attach day-trade option risk context ──────────────────────────────────
    if day_scan is not None:
        day_payload["option_risk_context"] = day_scan.option_risk_context

    # ── Apply cross-engine score normalization ────────────────────────────────
    if day_scan is not None and day_decision is not None:
        day_norm = normalize_day_score(
            bull_score=day_scan.bull_score,
            bear_score=day_scan.bear_score,
            verdict=str(day_scan.verdict or ""),
            metrics=day_metrics,
            decision_confidence=int(day_decision.confidence or 0),
            decision_risk_state=str(day_decision.risk_state or "MEDIUM"),
            entry_guidance=day_scan.entry_guidance,
            reasons=day_scan.reasons,
        )
        day_payload.update(day_norm)

    if swing_scan is not None and swing_decision is not None:
        swing_norm = normalize_swing_score(
            trade_quality_score=swing_scan.trade_quality_score,
            verdict=str(swing_scan.verdict or ""),
            final_action=str(swing_scan.final_action or ""),
            entry_quality=str(swing_scan.entry_quality or ""),
            risk_level=str(swing_scan.risk_level or "MEDIUM"),
            swing_bias=str(swing_scan.swing_bias or ""),
            decision_confidence=int(swing_decision.confidence or 0),
            decision_risk_state=str(swing_decision.risk_state or "MEDIUM"),
            metrics=swing_scan.metrics,
            bull_score=swing_scan.bull_score,
            bear_score=swing_scan.bear_score,
            reasons=swing_scan.reasons,
        )
        swing_payload.update(swing_norm)

    if regular_decision is not None:
        top_rec = regular_data["recommendations"][0] if regular_data and regular_data.get("recommendations") else None
        regular_norm = normalize_regular_score(
            top_candidate=top_rec,
            signals=regular_data.get("signals") if regular_data else None,
            decision_confidence=int(regular_decision.confidence or 0),
            decision_risk_state=str(regular_decision.risk_state or "MEDIUM"),
            decision_reason=regular_reason,
        )
        regular_payload.update(regular_norm)

    cross_engine_conflict = _detect_cross_engine_conflict(day_scan, swing_scan)

    return {
        "day":                    day_payload,
        "swing":                  swing_payload,
        "regular":                regular_payload,
        "regular_data":           regular_data,
        "day_metrics":            day_metrics,
        "swing_suggested_strategy": swing_scan.suggested_strategy if swing_scan else "",
        "cross_engine_conflict":  cross_engine_conflict,
    }


def _detect_cross_engine_conflict(day_scan: Any, swing_scan: Any) -> Optional[dict]:
    """
    Detect when the day engine and swing engine have opposite directional biases
    for the same ticker.  Returns a conflict descriptor or None when there is no
    conflict (or either engine is unavailable / has no bias).

    Conflict levels:
      HARD  — opposite biases AND both engines are GO or stronger (clear contradiction)
      SOFT  — opposite biases but at least one engine is WATCH or WAIT
    """
    if day_scan is None or swing_scan is None:
        return None

    day_bias   = str(getattr(day_scan,   "bias",   None) or "").lower()
    swing_bias = str(getattr(swing_scan, "bias",   None) or "").lower()

    if not day_bias or not swing_bias:
        return None
    if day_bias == swing_bias:
        return None

    # Opposite biases detected
    day_verdict   = str(getattr(day_scan,   "verdict", "") or "").upper()
    swing_verdict = str(getattr(swing_scan, "verdict", "") or "").upper()

    _go_verdicts = {"STRONG GO", "STRONG-GO", "GO"}
    both_active = day_verdict in _go_verdicts and swing_verdict in _go_verdicts
    level = "HARD" if both_active else "SOFT"

    msg = (
        f"Day engine signals {day_bias.upper()} ({day_verdict}) while "
        f"Swing engine signals {swing_bias.upper()} ({swing_verdict}). "
        f"{'Both engines are active — trading both sides would result in opposing positions.' if both_active else 'One engine is not yet active — monitor before acting.'}"
    )

    log.warning(
        "CROSS_ENGINE_CONFLICT ticker=%s day=%s(%s) swing=%s(%s) level=%s",
        getattr(day_scan, "ticker", "?"),
        day_bias, day_verdict, swing_bias, swing_verdict, level,
    )

    return {
        "level":         level,
        "day_bias":      day_bias,
        "day_verdict":   day_verdict,
        "swing_bias":    swing_bias,
        "swing_verdict": swing_verdict,
        "message":       msg,
    }


def _compute_overall_decision(engine_cards: list[dict]) -> dict:
    """
    Option B gating — synthesise the three engine cards into one meta-signal.

    Rules (applied in order):
      1. Any AVOID  → overall capped at WATCH (even if another engine is READY)
      2. HARD directional conflict → cap at WATCH
      3. All three READY/TRADE  → STRONG GO
      4. Day + Swing both READY → GO
      5. Day READY, Swing WATCH → GO  (intraday setup; swing confirming)
      6. Only one engine READY  → WATCH
      7. Any engine WATCH       → WATCH
      8. Default                → WAIT
    """
    card_by = {str(c.get("engine_type") or "").lower(): c for c in engine_cards}
    day_c   = card_by.get("day",     {})
    swing_c = card_by.get("swing",   {})
    reg_c   = card_by.get("regular", {})

    day_fd   = str(day_c.get("final_decision")   or "NO_EDGE").upper()
    swing_fd = str(swing_c.get("final_decision") or "NO_EDGE").upper()
    reg_fd   = str(reg_c.get("final_decision")   or "NO_EDGE").upper()

    _GO     = {"READY", "TRADE"}
    _WATCH  = {"WATCH"}
    _AVOID  = {"AVOID", "EXIT"}

    pairs = [("day", day_fd), ("swing", swing_fd), ("regular", reg_fd)]
    avoiding  = [e for e, fd in pairs if fd in _AVOID]
    go_list   = [e for e, fd in pairs if fd in _GO]
    watch_list= [e for e, fd in pairs if fd in _WATCH]

    # Directional conflict between day and swing
    day_bias   = str(day_c.get("market_bias")   or "").upper()
    swing_bias = str(swing_c.get("market_bias") or "").upper()
    hard_conflict = (
        ("BULL" in day_bias and "BEAR" in swing_bias) or
        ("BEAR" in day_bias and "BULL" in swing_bias)
    ) and day_fd in _GO and swing_fd in _GO

    def _avg_conf(*cards: dict) -> int:
        vals = [int(c.get("confidence") or 0) for c in cards if c]
        return int(sum(vals) / len(vals)) if vals else 0

    # ── Rule 1: AVOID cap ───────────────────────────────────────────────────
    if avoiding:
        return {
            "verdict":             "WATCH",
            "label":               "Partial Setup",
            "confidence":          25 + 15 * len(go_list),
            "reason":              (
                f"{', '.join(e.upper() for e in avoiding)} "
                f"engine{'s' if len(avoiding) > 1 else ''} "
                f"{'are' if len(avoiding) > 1 else 'is'} signalling AVOID — "
                "overall capped at WATCH until resolved."
            ),
            "engines_agreeing":    go_list + watch_list,
            "engines_conflicting": avoiding,
        }

    # ── Rule 2: HARD directional conflict ───────────────────────────────────
    if hard_conflict:
        return {
            "verdict":             "WATCH",
            "label":               "Directional Conflict",
            "confidence":          35,
            "reason":              (
                f"Day signals {day_bias} while Swing signals {swing_bias} — "
                "opposing directions active simultaneously. Stand aside or halve size."
            ),
            "engines_agreeing":    [],
            "engines_conflicting": ["day", "swing"],
        }

    # ── Rule 3: All three READY ──────────────────────────────────────────────
    if len(go_list) == 3:
        return {
            "verdict":             "STRONG GO",
            "label":               "Full Alignment",
            "confidence":          min(95, _avg_conf(day_c, swing_c, reg_c) + 10),
            "reason":              "All three engines confirm — maximum conviction setup across every timeframe.",
            "engines_agreeing":    ["day", "swing", "regular"],
            "engines_conflicting": [],
        }

    # ── Rule 4: Day + Swing both READY ──────────────────────────────────────
    if day_fd in _GO and swing_fd in _GO:
        agreeing = ["day", "swing"] + (["regular"] if reg_fd in _WATCH else [])
        return {
            "verdict":             "GO",
            "label":               "Day + Swing Aligned",
            "confidence":          min(85, _avg_conf(day_c, swing_c)),
            "reason":              (
                "Day and Swing engines both READY — high-conviction active setup. "
                + ("Regular options engine confirming." if reg_fd in _WATCH else "")
            ).strip(),
            "engines_agreeing":    agreeing,
            "engines_conflicting": [],
        }

    # ── Rule 5: Day READY + Swing WATCH ─────────────────────────────────────
    if day_fd in _GO and swing_fd in _WATCH:
        return {
            "verdict":             "GO",
            "label":               "Day Ready, Swing Watching",
            "confidence":          min(72, int(day_c.get("confidence") or 0)),
            "reason":              "Day engine READY; Swing is watching — intraday entry valid but multi-day follow-through not yet confirmed.",
            "engines_agreeing":    ["day", "swing"],
            "engines_conflicting": [],
        }

    # ── Rule 6: Single READY engine ─────────────────────────────────────────
    if go_list:
        lead = go_list[0]
        lead_c = card_by.get(lead, {})
        return {
            "verdict":             "WATCH",
            "label":               f"{lead.title()} Only",
            "confidence":          min(55, int(lead_c.get("confidence") or 0)),
            "reason":              f"Only the {lead.upper()} engine is READY — wait for at least one more engine to confirm before acting.",
            "engines_agreeing":    go_list + watch_list,
            "engines_conflicting": [],
        }

    # ── Rule 7: Any WATCH ────────────────────────────────────────────────────
    if watch_list:
        return {
            "verdict":             "WATCH",
            "label":               "Monitoring",
            "confidence":          35,
            "reason":              "Engines in watch mode — setup developing but entry conditions not yet met.",
            "engines_agreeing":    watch_list,
            "engines_conflicting": [],
        }

    # ── Default: Wait ────────────────────────────────────────────────────────
    return {
        "verdict":             "WAIT",
        "label":               "No Setup",
        "confidence":          0,
        "reason":              "No engine is reporting an actionable signal — stand aside.",
        "engines_agreeing":    [],
        "engines_conflicting": [],
    }


def run_all_engines_cached(ticker: str) -> dict:
    """Thread-safe cached wrapper around _compute_ticker_engines."""
    key = ticker.strip().upper()
    now = time.time()
    with _agg_cache_lock:
        entry = _agg_cache.get(key)
        if entry and now - entry[0] < _cache_ttl():
            log.debug("AGG_CACHE hit ticker=%s age=%.0fs", key, now - entry[0])
            return entry[1]
    t0 = time.perf_counter()
    result = _compute_ticker_engines(key)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    log.info("AGG_CACHE miss ticker=%s computed=%dms", key, elapsed_ms)
    with _agg_cache_lock:
        _agg_cache[key] = (time.time(), result)
    return result


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

_ENGINE_META = {
    "day":     {"timeframe": "same day",  "best_use_case": "fast momentum"},
    "swing":   {"timeframe": "2–5 days",  "best_use_case": "trend capture"},
    "regular": {"timeframe": "2–4 weeks", "best_use_case": "strategic trades"},
}

# Higher = better for sorting recommendations
_SIGNAL_RANK: dict[str, int] = {
    "READY": 5, "TRADE": 5, "WATCH": 4, "WAIT": 3, "AVOID": 2, "EXIT": 2, "NO_EDGE": 1,
}


def _risk_label(risk_state: str) -> str:
    rs = str(risk_state or "").upper()
    if rs in ("HIGH", "EXTREME"):
        return "high"
    if rs == "LOW":
        return "low"
    return "medium"


def _action_label(final_decision: str) -> str:
    return {
        "READY":  "Enter now",
        "TRADE":  "Enter now",
        "WATCH":  "Monitor closely",
        "WAIT":   "Hold — not ready",
        "AVOID":  "Stand down",
        "EXIT":   "Exit or scale out",
        "NO_EDGE":"No edge",
        "MANAGE": "Manage position",
    }.get(str(final_decision or "").upper(), "Review")


def _is_spread_strategy(strategy: str) -> bool:
    s = str(strategy or "").lower()
    for kw in ("spread", "condor", "calendar", "vertical", "diagonal"):
        if kw in s:
            return True
    return False


def _direction_from_bias(market_bias: str) -> str:
    b = str(market_bias or "").upper()
    if "BULL" in b:
        return "Call"
    if "BEAR" in b:
        return "Put"
    return "Spread"


def _expiry_label(engine: str, regular_data: Optional[dict]) -> str:
    if engine == "day":
        return "0DTE"
    if engine == "swing":
        return "2–5d"
    if regular_data and regular_data.get("target_expiry"):
        return str(regular_data["target_expiry"])
    return "~4w"


def _strategy_label(engine: str, market_bias: str, regular_data: Optional[dict], swing_suggested_strategy: str = "") -> str:
    if engine == "regular" and regular_data and regular_data.get("recommendations"):
        first = regular_data["recommendations"][0]
        return str(first.get("strategy") or "Defined-Risk Spread")
    if engine == "day":
        return "Intraday Scalp"
    if engine == "swing" and swing_suggested_strategy and swing_suggested_strategy not in ("NO_TRADE", ""):
        norm = swing_suggested_strategy.replace("_", " ").title()
        synonyms = {
            "Call Debit Spread": "Bull Call Spread",
            "Put Debit Spread":  "Bear Put Spread",
            "Credit Put Spread":  "Bull Put Spread",
            "Credit Call Spread": "Bear Call Spread",
        }
        return synonyms.get(norm, norm)
    b = str(market_bias or "").upper()
    if "BULL" in b:
        return "Long Call"
    if "BEAR" in b:
        return "Long Put"
    return "Directional Play"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empty_payload(
    engine_filter: Optional[str],
    signal_filter: Optional[str],
    direction_filter: Optional[str],
    risk_filter: Optional[str],
) -> dict:
    """Return a structurally complete but empty payload (used when watchlist is empty)."""
    zero_dist = [
        {"engine": "Day",     "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        {"engine": "Swing",   "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        {"engine": "Regular", "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
    ]
    return {
        "engines":         [],
        "recommendations": [],
        "conflicts":       [],
        "alerts_summary": {
            "active_alerts": 0, "critical_alerts": 0,
            "positions_requiring_exit": 0, "near_expiry_trades": 0,
            "high_iv_warnings": 0,
        },
        "recent_activity": [],
        "charts": {
            "trend_strength":             [],
            "engine_signal_distribution": zero_dist,
            "risk_distribution":          [{"label": k, "value": 0} for k in ("Low", "Medium", "High")],
            "style_allocation":           [{"label": k, "value": 0} for k in ("Day", "Swing", "Regular", "Avoid")],
        },
        "filters": {
            "engine": engine_filter, "signal": signal_filter,
            "direction": direction_filter, "risk": risk_filter,
        },
    }


# ---------------------------------------------------------------------------
# Main aggregation entry point
# ---------------------------------------------------------------------------

def build_command_center_payload(
    email: str,
    engine_filter: Optional[str],
    signal_filter: Optional[str],
    direction_filter: Optional[str],
    risk_filter: Optional[str],
) -> dict:
    """
    Build a live Trade Command Center payload from real engine outputs.
    Replaces _trade_command_center_stub() in command_center_router.py.

    Runs all three engines for each watchlist ticker (with caching),
    then aggregates into engine cards, recommendations, conflicts, and charts.
    """
    state = get_user_state(normalize_email(email))
    items = get_source_items(state)[:MAX_TICKERS]

    if not items:
        return _empty_payload(engine_filter, signal_filter, direction_filter, risk_filter)

    # ── Run engines in parallel ───────────────────────────────────────────────
    per_ticker: list[dict] = []
    tickers = [str(item.get("ticker") or "").strip().upper() for item in items if item.get("ticker")]

    with ThreadPoolExecutor(max_workers=THREAD_POOL_SIZE) as pool:
        futures = {pool.submit(run_all_engines_cached, t): t for t in tickers}
        for fut in as_completed(futures):
            t = futures[fut]
            try:
                engines = fut.result()
            except Exception:
                engines = {
                    "day":     decision_payload(None, label="day"),
                    "swing":   decision_payload(None, label="swing"),
                    "regular": decision_payload(None, label="regular"),
                    "regular_data": None,
                    "day_metrics":  {},
                    "swing_suggested_strategy": "",
                }
            per_ticker.append({"ticker": t, "engines": engines})

    # Restore watchlist order
    ticker_order = {t: i for i, t in enumerate(tickers)}
    per_ticker.sort(key=lambda r: ticker_order.get(r["ticker"], 999))

    # ── Build flat recommendation rows ────────────────────────────────────────
    all_recs: list[dict] = []
    for row in per_ticker:
        ticker  = row["ticker"]
        engines = row["engines"]
        for eng_key in ("day", "swing", "regular"):
            p     = engines[eng_key]
            fd    = str(p.get("final_decision") or "").upper()
            rdata = engines.get("regular_data") if eng_key == "regular" else None
            swing_strat = engines.get("swing_suggested_strategy", "")
            all_recs.append({
                "id":                    f"{ticker.lower()}-{eng_key}-{str(uuid.uuid4())[:8]}",
                "ticker":                ticker,
                "engine_type":           eng_key,
                "direction":             _direction_from_bias(p.get("market_bias", "")),
                "strategy":              _strategy_label(eng_key, p.get("market_bias", ""), rdata, swing_strat),
                "signal":                p.get("raw_signal") or fd,
                "entry_zone":            "—",
                "target":                "—",
                "stop_loss":             "—",
                "expiry":                _expiry_label(eng_key, rdata),
                "risk_level":            _risk_label(p.get("risk_state", "MEDIUM")),
                "action_label":          _action_label(fd),
                "recommended_action":    p.get("reason") or "",
                "market_bias":           p.get("market_bias") or "NEUTRAL",
                "setup_quality":         p.get("setup_quality") or "WEAK",
                "execution_readiness":   p.get("execution_readiness") or "WAIT",
                "final_decision":        fd,
                "confidence":            int(p.get("confidence") or 0),
                "reason":                p.get("reason") or "",
                "supporting_factors":    list(p.get("supporting_factors") or []),
                "missing_confirmations": list(p.get("missing_confirmations") or []),
                "risk_state":            p.get("risk_state") or "MEDIUM",
                "signal_quality":        p.get("signal_quality") or "",
                "execution_timing":      p.get("execution_timing") or "",
                "risk_category":         p.get("risk_category") or "",
                "explanation":           p.get("explanation") or {},
                "risk_reason":           p.get("risk_reason") or "",
                "display_confidence":    int(p.get("display_confidence") or 0),
                "execution_fields":      list(p.get("execution_fields") or []),
                # Normalized scoring fields
                "raw_engine_score":      float(p.get("raw_engine_score") or 0.0),
                "normalized_score":      int(p.get("normalized_score") or 0),
                "normalized_state":      p.get("normalized_state") or "",
                "confidence_band":       p.get("confidence_band") or "LOW",
                "execution_bias":        p.get("execution_bias") or "NO_CLEAN_ENTRY",
                "risk_band":             p.get("risk_band") or "MEDIUM",
                "normalized_reason":     p.get("normalized_reason") or "",
                "engine_score_breakdown": p.get("engine_score_breakdown") or {},
                "option_risk_context":   p.get("option_risk_context") or {},
            })

    # Rows with NO_EDGE are omitted from the visible recommendation list
    # but are kept in all_recs for chart accounting
    visible_recs = [r for r in all_recs if r.get("final_decision") != "NO_EDGE"]

    # ── Apply filters ─────────────────────────────────────────────────────────
    ef = (engine_filter  or "").strip().lower()
    sf = (signal_filter  or "").strip().upper()
    df = (direction_filter or "").strip().lower()
    rf = (risk_filter    or "").strip().lower()

    filtered = list(visible_recs)
    if ef in ("day", "swing", "regular"):
        filtered = [r for r in filtered if r.get("engine_type") == ef]
    if sf:
        filtered = [r for r in filtered if str(r.get("final_decision", "")).upper() == sf]
    if df:
        if df == "spread":
            filtered = [r for r in filtered if
                        str(r.get("direction", "")).lower() == "spread" or
                        _is_spread_strategy(r.get("strategy", ""))]
        else:
            filtered = [r for r in filtered if str(r.get("direction", "")).lower() == df]
    if rf in ("low", "medium", "high"):
        filtered = [r for r in filtered if str(r.get("risk_level", "")).lower() == rf]

    # Sort: highest signal rank first, then normalized_score, then confidence
    filtered.sort(
        key=lambda r: (
            _SIGNAL_RANK.get(str(r.get("final_decision", "")).upper(), 0),
            int(r.get("normalized_score") or 0),
            int(r.get("confidence") or 0),
        ),
        reverse=True,
    )

    # ── Engine cards ──────────────────────────────────────────────────────────
    engine_cards: list[dict] = []
    for eng_key in ("day", "swing", "regular"):
        eng_visible = [r for r in visible_recs if r.get("engine_type") == eng_key]
        if not eng_visible:
            engine_cards.append({
                "engine_type":           eng_key,
                "timeframe":             _ENGINE_META[eng_key]["timeframe"],
                "best_use_case":         _ENGINE_META[eng_key]["best_use_case"],
                "signal":                "NO_EDGE",
                "signal_count":          0,
                "top_recommendation":    None,
                "risk_level":            "medium",
                "summary":               "No actionable signals found for the current watchlist.",
                "market_bias":           "NEUTRAL",
                "setup_quality":         "WEAK",
                "execution_readiness":   "WAIT",
                "final_decision":        "NO_EDGE",
                "confidence":            0,
                "reason":                "Engine returned no actionable signals.",
                "supporting_factors":    [],
                "missing_confirmations": [],
                "risk_state":            "MEDIUM",
                "signal_quality":        "",
                "execution_timing":      "",
                "risk_category":         "",
                "explanation":           {},
                "risk_reason":           "",
                "display_confidence":    0,
                "execution_fields":      [],
                "raw_engine_score":      0.0,
                "normalized_score":      0,
                "normalized_state":      "",
                "confidence_band":       "LOW",
                "execution_bias":        "NO_CLEAN_ENTRY",
                "risk_band":             "MEDIUM",
                "normalized_reason":     "",
                "engine_score_breakdown": {},
                "option_risk_context":   {},
            })
            continue

        # Best ticker for this engine card
        top = max(
            eng_visible,
            key=lambda r: (
                _SIGNAL_RANK.get(str(r.get("final_decision", "")).upper(), 0),
                int(r.get("normalized_score") or 0),
                int(r.get("confidence") or 0),
            ),
        )
        ready_count = sum(
            1 for r in eng_visible
            if str(r.get("final_decision", "")).upper() in ("READY", "TRADE", "WATCH")
        )
        fd_counts   = Counter(str(r.get("final_decision", "")).upper() for r in eng_visible)
        card_signal = fd_counts.most_common(1)[0][0] if fd_counts else "WAIT"

        engine_cards.append({
            "engine_type":           eng_key,
            "timeframe":             _ENGINE_META[eng_key]["timeframe"],
            "best_use_case":         _ENGINE_META[eng_key]["best_use_case"],
            "signal":                card_signal,
            "signal_count":          ready_count,
            "top_recommendation":    {
                "ticker":       top["ticker"],
                "reason":       (top.get("reason") or "")[:200],
                "risk_warning": (top.get("reason") or "")[:120],
            },
            "risk_level":            _risk_label(top.get("risk_state", "MEDIUM")),
            "summary":               (top.get("reason") or "")[:300],
            "market_bias":           top.get("market_bias") or "NEUTRAL",
            "setup_quality":         top.get("setup_quality") or "WEAK",
            "execution_readiness":   top.get("execution_readiness") or "WAIT",
            "final_decision":        str(top.get("final_decision") or "WAIT"),
            "confidence":            int(top.get("confidence") or 0),
            "reason":                top.get("reason") or "",
            "supporting_factors":    list(top.get("supporting_factors") or []),
            "missing_confirmations": list(top.get("missing_confirmations") or []),
            "risk_state":            top.get("risk_state") or "MEDIUM",
            "signal_quality":        top.get("signal_quality") or "",
            "execution_timing":      top.get("execution_timing") or "",
            "risk_category":         top.get("risk_category") or "",
            "explanation":           top.get("explanation") or {},
            "risk_reason":           top.get("risk_reason") or "",
            "display_confidence":    int(top.get("display_confidence") or 0),
            "execution_fields":      list(top.get("execution_fields") or []),
            "raw_engine_score":      float(top.get("raw_engine_score") or 0.0),
            "normalized_score":      int(top.get("normalized_score") or 0),
            "normalized_state":      top.get("normalized_state") or "",
            "confidence_band":       top.get("confidence_band") or "LOW",
            "execution_bias":        top.get("execution_bias") or "NO_CLEAN_ENTRY",
            "risk_band":             top.get("risk_band") or "MEDIUM",
            "normalized_reason":     top.get("normalized_reason") or "",
            "engine_score_breakdown": top.get("engine_score_breakdown") or {},
            "option_risk_context":   top.get("option_risk_context") or {},
        })
    # ── Conflicts: tickers with mixed GO/AVOID signals across engines ────────
    conflicts: list[dict] = []
    by_ticker: dict[str, list[dict]] = {}
    for r in all_recs:
        t = str(r.get("ticker") or "").upper()
        by_ticker.setdefault(t, []).append(r)

    for ticker, rows in by_ticker.items():
        if len(rows) < 2:
            continue
        signals = [str(r.get("final_decision") or r.get("signal") or "").upper() for r in rows]
        has_go    = any(s in ("READY", "TRADE", "WATCH") for s in signals)
        has_avoid = any(s in ("AVOID", "EXIT", "NO_EDGE") for s in signals)
        if not has_go or not has_avoid:
            continue
        conflicts.append({
            "id":               f"conflict-{ticker.lower()}",
            "ticker":           ticker,
            "state":            "CONFLICTING_SIGNALS",
            "summary":          f"{ticker} has conflicting signals across engines.",
            "resolution":       "Timeframe or options pricing is creating a disagreement.",
            "suggested_action": "Prefer smaller size or wait for cleaner agreement before acting.",
            "signals": [
                {
                    "engine_type": str(r.get("engine_type") or "").upper(),
                    "signal":      str(r.get("final_decision") or r.get("signal") or "").upper(),
                    "note":        r.get("reason") or "",
                }
                for r in rows
            ],
        })

    # ── Charts: computed from all_recs (unfiltered for accurate distribution) ─
    eng_dist_map: dict[str, dict] = {
        "Day":     {"engine": "Day",     "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        "Swing":   {"engine": "Swing",   "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        "Regular": {"engine": "Regular", "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
    }
    risk_counts = {"Low": 0, "Medium": 0, "High": 0}
    style_counts = {"Day": 0, "Swing": 0, "Regular": 0, "Avoid": 0}

    for r in all_recs:
        eng_key  = str(r.get("engine_type") or "").lower()
        eng_label = {"day": "Day", "swing": "Swing", "regular": "Regular"}.get(eng_key, "")
        sig = str(r.get("final_decision") or r.get("signal") or "").upper()
        if eng_label and eng_label in eng_dist_map:
            bucket = sig if sig in ("READY", "WATCH", "WAIT", "AVOID", "NO_EDGE") else "NO_EDGE"
            # TRADE maps to READY bucket
            if sig == "TRADE":
                bucket = "READY"
            eng_dist_map[eng_label][bucket] += 1

        risk = str(r.get("risk_level") or "").capitalize()
        if risk in risk_counts:
            risk_counts[risk] += 1

        if sig in ("AVOID", "EXIT", "NO_EDGE"):
            style_counts["Avoid"] += 1
        elif eng_label and eng_label in style_counts:
            style_counts[eng_label] += 1

    overall_decision = _compute_overall_decision(engine_cards)

    return {
        "engines":          engine_cards,
        "overall_decision": overall_decision,
        "recommendations":  filtered,
        "conflicts":        conflicts,
        "alerts_summary": {
            "active_alerts": 0, "critical_alerts": 0,
            "positions_requiring_exit": 0, "near_expiry_trades": 0,
            "high_iv_warnings": 0,
        },
        "recent_activity": [],
        "charts": {
            "trend_strength":             [],
            "engine_signal_distribution": list(eng_dist_map.values()),
            "risk_distribution":          [{"label": k, "value": v} for k, v in risk_counts.items()],
            "style_allocation":           [{"label": k, "value": v} for k, v in style_counts.items()],
        },
        "filters": {
            "engine": engine_filter, "signal": signal_filter,
            "direction": direction_filter, "risk": risk_filter,
        },
    }
