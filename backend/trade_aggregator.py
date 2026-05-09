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

import threading
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

import bar_cache

from analysis import generate_signals
from day_trade import run_day_trade_scan
from decision_resolver import resolve_trade_decision
from engine import pick_expiry_by_dte, run_engine
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
    Merge day_trade_watchlist + swing_trade_watchlist + watchlist into a
    deduplicated list of {ticker, id, sources} dicts, sorted by ticker.
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

    for raw in state.get("watchlist") or []:
        if isinstance(raw, dict):
            _ensure(
                str(raw.get("ticker", "")),
                source="regular",
                notes=str(raw.get("notes", "") or ""),
                added_at=str(raw.get("addedAt", "") or ""),
            )
    for t in state.get("day_trade_watchlist") or []:
        _ensure(str(t), source="day")
    for t in state.get("swing_trade_watchlist") or []:
        _ensure(str(t), source="swing")

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
    }


# ---------------------------------------------------------------------------
# Per-ticker multi-engine runner
# ---------------------------------------------------------------------------

def _compute_ticker_engines(ticker: str) -> dict:
    """
    Run all three engines for one ticker and return resolved decision payloads.
    Each engine is isolated — a failure in one does not abort the others.
    """
    # ── Day ──────────────────────────────────────────────────────────────────
    day_decision = None
    day_reason   = ""
    day_raw      = ""
    day_metrics: dict = {}
    try:
        day_scan = run_day_trade_scan(ticker)
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

    # ── Swing ─────────────────────────────────────────────────────────────────
    swing_decision = None
    swing_reason   = ""
    swing_raw      = ""
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

    return {
        "day":          decision_payload(day_decision,     label="day",     raw_signal=day_raw,     reason=day_reason),
        "swing":        decision_payload(swing_decision,   label="swing",   raw_signal=swing_raw,   reason=swing_reason),
        "regular":      decision_payload(regular_decision, label="regular", raw_signal=regular_raw, reason=regular_reason),
        "regular_data": regular_data,
        "day_metrics":  day_metrics,
    }


def run_all_engines_cached(ticker: str) -> dict:
    """Thread-safe cached wrapper around _compute_ticker_engines."""
    key = ticker.strip().upper()
    now = time.time()
    with _agg_cache_lock:
        entry = _agg_cache.get(key)
        if entry and now - entry[0] < _cache_ttl():
            return entry[1]
    result = _compute_ticker_engines(key)
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


def _strategy_label(engine: str, market_bias: str, regular_data: Optional[dict]) -> str:
    if engine == "regular" and regular_data and regular_data.get("recommendations"):
        first = regular_data["recommendations"][0]
        return str(first.get("strategy") or "Defined-Risk Spread")
    if engine == "day":
        return "Intraday Scalp"
    b = str(market_bias or "").upper()
    if "BULL" in b:
        return "Long Call"
    if "BEAR" in b:
        return "Long Put"
    return "Directional Play"


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
            all_recs.append({
                "id":                    f"{ticker.lower()}-{eng_key}-{str(uuid.uuid4())[:8]}",
                "ticker":                ticker,
                "engine_type":           eng_key,
                "direction":             _direction_from_bias(p.get("market_bias", "")),
                "strategy":              _strategy_label(eng_key, p.get("market_bias", ""), rdata),
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

    # Sort: highest signal rank first, then confidence
    filtered.sort(
        key=lambda r: (
            _SIGNAL_RANK.get(str(r.get("final_decision", "")).upper(), 0),
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
            })
            continue

        # Best ticker for this engine card
        top = max(
            eng_visible,
            key=lambda r: (
                _SIGNAL_RANK.get(str(r.get("final_decision", "")).upper(), 0),
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
        })

    # ── Conflicts ─────────────────────────────────────────────────────────────
    # A ticker is in conflict when at least one engine is READY/WATCH and at
    # least one other engine is AVOID/EXIT.
    conflicts: list[dict] = []
    ticker_eng_map: dict[str, dict[str, dict]] = defaultdict(dict)
    for rec in visible_recs:
        ticker_eng_map[rec["ticker"]][rec["engine_type"]] = rec

    for ticker, eng_recs in ticker_eng_map.items():
        decisions = {k: str(v.get("final_decision", "")).upper() for k, v in eng_recs.items()}
        go_set    = {"READY", "TRADE", "WATCH"}
        avoid_set = {"AVOID", "EXIT"}
        has_go    = any(v in go_set    for v in decisions.values())
        has_avoid = any(v in avoid_set for v in decisions.values())
        if not (has_go and has_avoid):
            continue
        conflicts.append({
            "id":             f"conflict-{ticker.lower()}",
            "ticker":         ticker,
            "state":          "CONFLICTING_SIGNALS",
            "summary":        f"{ticker} has conflicting signals across engines.",
            "resolution":     "Timeframe or IV environment is creating engine disagreement.",
            "suggested_action": "Prefer the longer timeframe or wait for alignment before acting.",
            "signals": [
                {
                    "engine_type": k.upper(),
                    "signal":      v,
                    "note":        (eng_recs[k].get("reason") or "")[:120],
                }
                for k, v in decisions.items()
            ],
        })

    # ── Charts ────────────────────────────────────────────────────────────────
    eng_sig_map: dict[str, dict] = {
        "Day":     {"engine": "Day",     "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        "Swing":   {"engine": "Swing",   "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        "Regular": {"engine": "Regular", "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
    }
    risk_counts: dict[str, int] = {"Low": 0, "Medium": 0, "High": 0}

    for rec in all_recs:  # include NO_EDGE in chart counts
        ek = str(rec.get("engine_type") or "").capitalize()
        fd = str(rec.get("final_decision") or "").upper()
        rl = str(rec.get("risk_level") or "").capitalize()
        if ek in eng_sig_map:
            bucket = eng_sig_map[ek]
            if fd in ("READY", "TRADE"):
                bucket["READY"] += 1
            elif fd == "WATCH":
                bucket["WATCH"] += 1
            elif fd == "WAIT":
                bucket["WAIT"] += 1
            elif fd in ("AVOID", "EXIT"):
                bucket["AVOID"] += 1
            else:
                bucket["NO_EDGE"] += 1
        if rl in risk_counts:
            risk_counts[rl] += 1

    # Style allocation based on actionable recs
    style_counts: dict[str, int] = {"Day": 0, "Swing": 0, "Regular": 0, "Avoid": 0}
    for r in visible_recs:
        ek = str(r.get("engine_type") or "").capitalize()
        fd = str(r.get("final_decision") or "").upper()
        if fd in ("AVOID", "EXIT"):
            style_counts["Avoid"] += 1
        elif ek in style_counts:
            style_counts[ek] += 1
    style_total = sum(style_counts.values()) or 1
    style_alloc = [{"label": k, "value": round(v / style_total * 100)} for k, v in style_counts.items()]

    charts = {
        "trend_strength":             [],  # populated by caller via live_mkt
        "engine_signal_distribution": list(eng_sig_map.values()),
        "risk_distribution": [
            {"label": "Low",    "value": risk_counts["Low"]},
            {"label": "Medium", "value": risk_counts["Medium"]},
            {"label": "High",   "value": risk_counts["High"]},
        ],
        "style_allocation": style_alloc,
    }

    # ── Alerts summary ────────────────────────────────────────────────────────
    alerts_summary = {
        "active_alerts":            len(visible_recs),
        "critical_alerts":          sum(
            1 for r in visible_recs
            if str(r.get("risk_state", "")).upper() in ("HIGH", "EXTREME")
            and str(r.get("final_decision", "")).upper() in ("AVOID", "EXIT")
        ),
        "positions_requiring_exit": sum(
            1 for r in visible_recs if str(r.get("final_decision", "")).upper() == "EXIT"
        ),
        "near_expiry_trades":       0,
        "high_iv_warnings":         sum(
            1 for r in visible_recs if str(r.get("risk_state", "")).upper() == "HIGH"
        ),
    }

    return {
        "engines":         engine_cards,
        "recommendations": filtered,
        "conflicts":       conflicts,
        "alerts_summary":  alerts_summary,
        "recent_activity": [],
        "charts":          charts,
        "filters": {
            "engine":    engine_filter,
            "signal":    signal_filter,
            "direction": direction_filter,
            "risk":      risk_filter,
        },
    }


# ---------------------------------------------------------------------------
# Empty-watchlist fallback
# ---------------------------------------------------------------------------

def _empty_payload(
    engine_filter: Optional[str],
    signal_filter: Optional[str],
    direction_filter: Optional[str],
    risk_filter: Optional[str],
) -> dict:
    """Return an honest empty payload when the user has no watchlist tickers."""
    engine_cards = [
        {
            "engine_type":           eng_key,
            "timeframe":             _ENGINE_META[eng_key]["timeframe"],
            "best_use_case":         _ENGINE_META[eng_key]["best_use_case"],
            "signal":                "NO_EDGE",
            "signal_count":          0,
            "top_recommendation":    None,
            "risk_level":            "medium",
            "summary":               "Add tickers to your watchlist to see live signals.",
            "market_bias":           "NEUTRAL",
            "setup_quality":         "WEAK",
            "execution_readiness":   "WAIT",
            "final_decision":        "NO_EDGE",
            "confidence":            0,
            "reason":                "No watchlist tickers to evaluate.",
            "supporting_factors":    [],
            "missing_confirmations": ["Watchlist tickers"],
            "risk_state":            "MEDIUM",
        }
        for eng_key in ("day", "swing", "regular")
    ]
    zero_dist = [
        {"engine": "Day",     "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        {"engine": "Swing",   "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
        {"engine": "Regular", "READY": 0, "WATCH": 0, "WAIT": 0, "AVOID": 0, "NO_EDGE": 0},
    ]
    return {
        "engines":         engine_cards,
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
