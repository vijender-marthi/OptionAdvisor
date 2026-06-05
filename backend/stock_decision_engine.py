"""
Stock position decision engine.

For each open stock position, computes:
  - MA20 / MA50 from 3-month daily history (bar_cache)
  - Trailing stop level:  max(hard_stop_loss, high_water_mark × (1 − trailing_pct))
  - MA-based targets:     Target 1 ≈ MA20 zone,  Target 2 ≈ MA50 zone
  - Decision:             HOLD | WATCH | TRIM | SELL | STOP_HIT
  - Per-position P&L, day P&L, health score, smart alerts

Entry point: analyze_stock_position(position_dict, pnl_data=None) → dict
"""
from __future__ import annotations

from typing import Any, Optional

import bar_cache


def _float_or(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Market data helpers
# ---------------------------------------------------------------------------

def _get_ma_data(ticker: str) -> dict[str, Any]:
    """Fetch MA20, MA50, RSI-14, 5-day momentum from 3-month daily history."""
    try:
        h = bar_cache.get_history(ticker, period="3mo", interval="1d", auto_adjust=True)
        if h is None or h.empty:
            return {}
        c = h["Close"].dropna()
        if len(c) < 5:
            return {}

        current = float(c.iloc[-1])
        prev_close = float(c.iloc[-2]) if len(c) >= 2 else current
        ma20 = float(c.tail(20).mean()) if len(c) >= 20 else float(c.mean())
        ma50 = float(c.tail(50).mean()) if len(c) >= 50 else ma20

        gains = c.diff()
        avg_gain = gains.clip(lower=0).tail(14).mean()
        avg_loss = (-gains.clip(upper=0)).tail(14).mean()
        if avg_loss > 0:
            rs = avg_gain / avg_loss
            rsi_raw = 100.0 - (100.0 / (1.0 + rs))
        else:
            rsi_raw = 50.0
        rsi_val = float(rsi_raw.iloc[-1]) if hasattr(rsi_raw, "iloc") else float(rsi_raw)

        mom_5d = (current / float(c.iloc[-6]) - 1.0) * 100.0 if len(c) >= 6 else 0.0

        return {
            "current_price": current,
            "prev_close":    prev_close,
            "ma20":          round(ma20, 4),
            "ma50":          round(ma50, 4),
            "rsi":           round(rsi_val, 1),
            "mom_5d":        round(mom_5d, 2),
            "bar_count":     len(c),
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Target calculation (MA-based)
# ---------------------------------------------------------------------------

def _calc_targets(
    entry_price: float,
    ma20: float,
    ma50: float,
    current_price: float,
) -> tuple[float, float]:
    """
    MA-based targets.

    Target 1:
      - If price already above MA20: MA20 × 1.02  (2% extended zone above MA20)
      - Else: MA20 itself  (reclaim as first milestone)

    Target 2:
      - max(MA50 × 1.03, entry_price × 1.15)  (greater of MA50+3% or 15% gain)
    """
    if ma20 > 0 and current_price > ma20:
        target1 = round(ma20 * 1.02, 2)
    elif ma20 > 0:
        target1 = round(ma20, 2)
    else:
        target1 = round(entry_price * 1.08, 2)

    if ma50 > 0:
        target2 = round(max(ma50 * 1.03, entry_price * 1.15), 2)
    else:
        target2 = round(entry_price * 1.15, 2)

    return target1, target2


# ---------------------------------------------------------------------------
# Trailing stop
# ---------------------------------------------------------------------------

def _compute_trailing_stop(
    entry_price: float,
    current_price: float,
    stop_loss: float,
    trailing_stop_pct: float,
    high_water_mark: float,
) -> float:
    """
    Effective trailing stop = max(hard_stop_loss, hwm × (1 − trailing_pct)).

    hwm is the highest price seen since entry (persisted in position JSON).
    Approximation when hwm not stored: use max(entry_price, current_price).
    """
    hwm = max(high_water_mark, entry_price, current_price)
    trailing = hwm * (1.0 - trailing_stop_pct) if trailing_stop_pct > 0 else 0.0
    effective = max(stop_loss, trailing) if trailing > 0 else stop_loss
    return round(effective, 4)


# ---------------------------------------------------------------------------
# Decision tree
# ---------------------------------------------------------------------------

def _stock_decision(
    current_price: float,
    entry_price: float,
    stop_loss: float,
    trailing_stop: float,
    target1: float,
    target2: float,
    ma20: float,
    ma50: float,
    rsi: float,
    pnl_pct: float,
) -> tuple[str, str, str]:
    """
    Returns (decision, decision_label, reasoning).

    Priority (most urgent first):
      STOP_HIT  → at or below effective stop
      SELL      → at/above Target 2, or big-gain reversal below MA50
      TRIM      → within 2% of Target 1 with meaningful gain
      WATCH     → below MA20 while at a loss
      HOLD      → trend intact
    """
    eff_stop = trailing_stop if trailing_stop > 0 else stop_loss

    if eff_stop > 0 and current_price <= eff_stop:
        return (
            "STOP_HIT",
            "Stop Hit",
            f"Price ${current_price:.2f} at or below stop ${eff_stop:.2f}. Exit immediately.",
        )

    if target2 > 0 and current_price >= target2:
        return (
            "SELL",
            "Sell — Target 2",
            f"Price ${current_price:.2f} reached Target 2 (${target2:.2f}). Full exit or lock gains.",
        )

    if pnl_pct >= 15 and ma50 > 0 and current_price < ma50 and rsi > 55:
        return (
            "SELL",
            "Sell — Extended & Reversing",
            f"Up {pnl_pct:.1f}% but falling below MA50. Lock in gains before further reversal.",
        )

    if target1 > 0 and current_price >= target1 * 0.98 and pnl_pct >= 5:
        return (
            "TRIM",
            "Trim — Near Target 1",
            f"Price ${current_price:.2f} near Target 1 (${target1:.2f}). Sell 25–50% and trail the rest.",
        )

    if ma20 > 0 and current_price < ma20 and pnl_pct < 0:
        return (
            "WATCH",
            "Watch — Below MA20",
            f"Price ${current_price:.2f} below MA20 (${ma20:.2f}) at a loss. Monitor stop at ${eff_stop:.2f}.",
        )

    return (
        "HOLD",
        "Hold — Trend Intact",
        f"Price ${current_price:.2f} above MA20 (${ma20:.2f}). Trail stop at ${eff_stop:.2f}.",
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def analyze_stock_position(
    position: dict[str, Any],
    pnl_data: Optional[dict[str, Any]] = None,  # unused — kept for API symmetry with options analyzer
) -> dict[str, Any]:
    """
    Full stock position analysis.

    Reads from position dict:
      entryPrice / entry_price : float  — cost basis per share
      shares                   : int    — number of shares held
      stopLoss / stop_loss     : float  — hard stop price (0 = no hard stop)
      trailing_stop_pct        : float  — e.g. 0.08 = 8%  (default 0.08)
      high_water_mark          : float  — highest price since entry (default = entry_price)

    Returns a dict consumed by the Stocks tab frontend.
    Also returns `high_water_mark` so the caller can persist it when a new high is detected.
    """
    ticker = str(position.get("ticker") or "").upper()
    entry_price = _float_or(
        position.get("entryPrice") or position.get("entry_price"), 0.0
    )
    shares = max(1, int(_float_or(position.get("shares"), 1.0)))
    stop_loss = _float_or(
        position.get("stopLoss") or position.get("stop_loss"), 0.0
    )
    trailing_stop_pct = _float_or(
        position.get("trailing_stop_pct") or position.get("trailingStopPct"), 0.08
    )
    high_water_mark = _float_or(
        position.get("high_water_mark") or position.get("highWaterMark"), entry_price
    )
    if high_water_mark <= 0:
        high_water_mark = entry_price

    # ── Market data ────────────────────────────────────────────────────────
    mkt = _get_ma_data(ticker)
    current_price = mkt.get("current_price", entry_price) if mkt else entry_price
    prev_close    = mkt.get("prev_close", current_price)
    ma20          = mkt.get("ma20", 0.0)
    ma50          = mkt.get("ma50", 0.0)
    rsi           = mkt.get("rsi", 50.0)
    mom_5d        = mkt.get("mom_5d", 0.0)

    # ── P&L ────────────────────────────────────────────────────────────────
    cost_basis = entry_price * shares
    market_value = current_price * shares

    if entry_price > 0 and current_price > 0:
        pnl_dollar = round((current_price - entry_price) * shares, 2)
        pnl_pct    = round((current_price / entry_price - 1.0) * 100.0, 2)
    else:
        pnl_dollar = 0.0
        pnl_pct    = 0.0

    if prev_close > 0:
        day_pl_dollar = round((current_price - prev_close) * shares, 2)
        day_pl_pct    = round((current_price / prev_close - 1.0) * 100.0, 2)
    else:
        day_pl_dollar = 0.0
        day_pl_pct    = 0.0

    # ── Trailing stop & targets ────────────────────────────────────────────
    trailing_stop = _compute_trailing_stop(
        entry_price, current_price, stop_loss, trailing_stop_pct, high_water_mark
    )
    target1, target2 = _calc_targets(entry_price, ma20, ma50, current_price)

    # ── Decision ───────────────────────────────────────────────────────────
    decision, decision_label, reasoning = _stock_decision(
        current_price, entry_price, stop_loss, trailing_stop,
        target1, target2, ma20, ma50, rsi, pnl_pct,
    )

    # ── Distances ──────────────────────────────────────────────────────────
    eff_stop = trailing_stop if trailing_stop > 0 else stop_loss
    price_vs_ma20_pct = round((current_price / ma20 - 1.0) * 100.0, 1) if ma20 > 0 else 0.0
    price_vs_ma50_pct = round((current_price / ma50 - 1.0) * 100.0, 1) if ma50 > 0 else 0.0
    dist_to_stop_pct  = round((current_price / eff_stop - 1.0) * 100.0, 1) if eff_stop > 0 else 0.0
    dist_to_t1_pct    = round((target1 / current_price - 1.0) * 100.0, 1) if current_price > 0 and target1 > 0 else 0.0
    dist_to_t2_pct    = round((target2 / current_price - 1.0) * 100.0, 1) if current_price > 0 and target2 > 0 else 0.0

    # ── Health score (0–100) ───────────────────────────────────────────────
    score = 50
    if pnl_pct > 0:
        score += min(int(pnl_pct * 0.4), 25)
    else:
        score -= min(int(abs(pnl_pct) * 0.5), 20)
    if ma20 > 0 and current_price > ma20:
        score += 10
    if ma50 > 0 and current_price > ma50:
        score += 5
    if 40.0 <= rsi <= 65.0:
        score += 5
    elif rsi > 75.0 or rsi < 30.0:
        score -= 10
    if mom_5d > 2.0:
        score += 5
    elif mom_5d < -2.0:
        score -= 5
    if decision == "STOP_HIT":
        score = max(0, score - 30)
    score = max(0, min(100, score))

    if score >= 80:
        health_label = "STRONG"
    elif score >= 60:
        health_label = "HEALTHY"
    elif score >= 40:
        health_label = "CAUTION"
    else:
        health_label = "WEAKENING"

    # ── Smart alerts ───────────────────────────────────────────────────────
    smart_alerts: list[dict[str, str]] = []

    if decision == "STOP_HIT":
        smart_alerts.append({
            "type":     "STOP_HIT",
            "label":    "Stop Hit",
            "message":  f"{ticker} hit stop ${eff_stop:.2f}. Close position immediately.",
            "severity": "CRITICAL",
        })

    if eff_stop > 0 and dist_to_stop_pct < 3.0 and decision != "STOP_HIT":
        smart_alerts.append({
            "type":     "NEAR_STOP",
            "label":    "Near Stop",
            "message":  f"{ticker} is {dist_to_stop_pct:.1f}% above trailing stop (${eff_stop:.2f}).",
            "severity": "WARNING",
        })

    if target1 > 0 and current_price >= target1 * 0.97 and pnl_pct >= 5:
        smart_alerts.append({
            "type":     "TARGET1_NEAR",
            "label":    "Near Target 1",
            "message":  f"{ticker} within 3% of Target 1 (${target1:.2f}). Consider trimming 25–50%.",
            "severity": "INFO",
        })

    if rsi > 75.0 and pnl_pct > 10.0:
        smart_alerts.append({
            "type":     "RSI_OVERBOUGHT",
            "label":    "RSI Overbought",
            "message":  f"{ticker} RSI {rsi:.0f} — overbought at +{pnl_pct:.1f}%. Tighten stop.",
            "severity": "WARNING",
        })

    if ma20 > 0 and current_price < ma20 and pnl_pct < 0:
        smart_alerts.append({
            "type":     "BELOW_MA20",
            "label":    "Below MA20",
            "message":  f"{ticker} below MA20 (${ma20:.2f}) at a loss. Trend weakening.",
            "severity": "WARNING",
        })

    # ── Management actions ─────────────────────────────────────────────────
    management_actions: list[str] = {
        "STOP_HIT": ["Exit position NOW", "Place market order"],
        "SELL":     ["Close full position", "Set exit alert"],
        "TRIM":     [
            "Sell 25–50% at market",
            "Trail stop on remainder",
            f"Set Target 2 alert at ${target2:.2f}",
        ],
        "WATCH":    ["Watch MA20 reclaim", "Tighten stop", "Reduce size if below MA50"],
        "HOLD":     [
            f"Trail stop at ${eff_stop:.2f}",
            f"Set Target 1 alert at ${target1:.2f}",
        ],
    }.get(decision, ["Monitor position"])

    # ── Updated high_water_mark for caller to persist ──────────────────────
    new_hwm = round(max(high_water_mark, current_price), 4)

    return {
        "decision":           decision,
        "decision_label":     decision_label,
        "reasoning":          reasoning,
        "position_type":      "stock",
        # Pricing
        "current_price":      round(current_price, 4),
        "entry_price":        round(entry_price, 4),
        "shares":             shares,
        "cost_basis":         round(cost_basis, 2),
        "market_value":       round(market_value, 2),
        # P&L
        "pnl_dollar":         pnl_dollar,
        "pnl_pct":            pnl_pct,
        "day_pl_dollar":      day_pl_dollar,
        "day_pl_pct":         day_pl_pct,
        "is_profitable":      pnl_pct > 0,
        # Risk levels
        "trailing_stop":      round(trailing_stop, 4),
        "stop_loss":          round(stop_loss, 4),
        "trailing_stop_pct":  trailing_stop_pct,
        "high_water_mark":    new_hwm,
        # Targets
        "target1":            target1,
        "target2":            target2,
        # Technicals
        "ma20":               round(ma20, 4),
        "ma50":               round(ma50, 4),
        "rsi":                rsi,
        "mom_5d":             mom_5d,
        # Distance metrics
        "price_vs_ma20_pct":  price_vs_ma20_pct,
        "price_vs_ma50_pct":  price_vs_ma50_pct,
        "dist_to_stop_pct":   dist_to_stop_pct,
        "dist_to_t1_pct":     dist_to_t1_pct,
        "dist_to_t2_pct":     dist_to_t2_pct,
        # Health
        "health_score":       score,
        "health_label":       health_label,
        # Alerts & actions
        "smart_alerts":       smart_alerts,
        "management_actions": management_actions,
    }
