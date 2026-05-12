"""
day_option_risk.py
==================
Lightweight options-awareness overlay for the Day Trade Engine.

Computes option execution risks (theta/gamma, IV, liquidity) without building
any option strategies. The Day Trade Engine remains intraday/VWAP focused.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

import bar_cache
import storage as _storage

log = logging.getLogger(__name__)

_TODAY_CACHE: Optional[str] = None


def _today_str() -> str:
    global _TODAY_CACHE
    if _TODAY_CACHE is None:
        _TODAY_CACHE = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    return _TODAY_CACHE


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        f = float(val)
        return f if f == f else default
    except Exception:
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_day_option_risk_context(
    ticker: str,
    info: Optional[dict] = None,
) -> dict:
    """
    Build an ``option_risk_context`` dict for the Day Trade Engine.

    This is a **lightweight** check — no strategy construction, no chain
    iteration, no Black-Scholes. It reads at most the nearest expiry chain
    to assess 0DTE exposure, IV level, and ATM liquidity.

    Returns
    -------
    dict with keys:
        theta_risk              "HIGH" | "MEDIUM" | "LOW" | "NONE"
        gamma_risk              "HIGH" | "MEDIUM" | "LOW" | "NONE"
        iv_risk                 "HIGH" | "MEDIUM" | "LOW"
        liquidity_risk          "HIGH" | "MEDIUM" | "LOW"
        suggested_contract_window  str
        option_execution_warning   str
    """
    if info is None:
        try:
            info = bar_cache.get_info(ticker)
        except Exception:
            info = {}

    optionable = bool(info.get("optionable", info.get("hasOptions", True)))
    if not optionable:
        return _no_options()

    today = _today_str()

    # -- Nearest expiry ----------------------------------------------------
    nearest_expiry: Optional[str] = None
    is_0dte = False
    try:
        dates = bar_cache.get_option_dates(ticker)
        if dates:
            nearest_expiry = dates[0]
            is_0dte = nearest_expiry == today
    except Exception:
        pass

    if nearest_expiry is None:
        return _no_options()

    # -- ATM chain (just calls at nearest expiry) --------------------------
    atm_strike: Optional[float] = None
    bid: float = 0.0
    ask: float = 0.0
    volume: int = 0
    oi: int = 0
    chain_iv: Optional[float] = None

    try:
        last_price = _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
        calls_df, puts_df = bar_cache.get_option_chain(ticker, nearest_expiry)
        if last_price > 0 and calls_df is not None and not calls_df.empty:
            calls_df = calls_df.copy()
            calls_df["dist"] = (calls_df["strike"] - last_price).abs()
            atm = calls_df.loc[calls_df["dist"].idxmin()] if not calls_df.empty else None
            if atm is not None:
                atm_strike = _safe_float(atm.get("strike"))
                bid = _safe_float(atm.get("bid"))
                ask = _safe_float(atm.get("ask"))
                volume = _safe_int(atm.get("volume"))
                oi = _safe_int(atm.get("openInterest"))
                chain_iv = _safe_float(atm.get("impliedVolatility"))
    except Exception:
        pass

    # -- IV rank from storage ----------------------------------------------
    iv_rank: Optional[float] = None
    try:
        session_et = today
        iv_hist = _storage.fetch_iv_atm_history_strict_before(ticker, session_et, limit=380)
        if iv_hist and len(iv_hist) >= 20:
            current_iv_pct = (chain_iv * 100.0) if chain_iv and chain_iv > 0 else None
            if current_iv_pct is None:
                stock_iv = _safe_float(info.get("impliedVolatility"))
                current_iv_pct = stock_iv * 100.0 if stock_iv and stock_iv > 0 else None
            if current_iv_pct is not None:
                sorted_hist = sorted(iv_hist)
                count = len(sorted_hist)
                rank = sum(1 for v in sorted_hist if v <= current_iv_pct) / count * 100.0
                iv_rank = round(rank, 1)
    except Exception:
        pass

    # -- Fallback IV from info ---------------------------------------------
    stock_iv: Optional[float] = None
    if chain_iv is None:
        raw_iv = _safe_float(info.get("impliedVolatility"))
        if raw_iv and raw_iv > 0:
            stock_iv = raw_iv

    # -- Compute risk dimensions -------------------------------------------

    # Theta / gamma risk
    if is_0dte:
        theta_risk = "HIGH"
        gamma_risk = "HIGH"
    elif nearest_expiry and _days_until(nearest_expiry, today) <= 2:
        theta_risk = "MEDIUM"
        gamma_risk = "MEDIUM"
    else:
        theta_risk = "LOW"
        gamma_risk = "LOW"

    # IV risk
    effective_iv = chain_iv or stock_iv
    if effective_iv is not None:
        iv_pct = effective_iv * 100.0
        if iv_rank is not None and iv_rank >= 80:
            iv_risk = "HIGH"
        elif iv_rank is not None and iv_rank >= 60:
            iv_risk = "MEDIUM"
        elif iv_pct >= 80:
            iv_risk = "HIGH"
        elif iv_pct >= 50:
            iv_risk = "MEDIUM"
        else:
            iv_risk = "LOW"
    else:
        iv_risk = "LOW"

    # Liquidity risk
    if atm_strike is not None and ask > 0 and bid > 0:
        mid = (bid + ask) / 2.0
        spread_pct = (ask - bid) / mid * 100.0 if mid > 0 else 0.0
        if spread_pct > 10.0 or (volume < 10 and oi < 50):
            liquidity_risk = "HIGH"
        elif spread_pct > 5.0 or volume < 50 or oi < 200:
            liquidity_risk = "MEDIUM"
        else:
            liquidity_risk = "LOW"
    else:
        liquidity_risk = "LOW"

    # Suggested contract window
    if is_0dte:
        suggested_contract_window = "0DTE"
    elif nearest_expiry and _days_until(nearest_expiry, today) <= 2:
        suggested_contract_window = "1-2 DTE"
    else:
        suggested_contract_window = "3-7 DTE"

    # Human-readable warning
    warning_parts: list[str] = []
    risk_labels: list[str] = []
    if theta_risk == "HIGH":
        warning_parts.append("0DTE theta/gamma risk is high")
        risk_labels.append("high theta/gamma")
    if gamma_risk == "HIGH":
        if theta_risk != "HIGH":
            warning_parts.append("gamma risk is elevated")
            risk_labels.append("elevated gamma")
    if iv_risk == "HIGH":
        warning_parts.append("IV expansion/crush risk is elevated")
        risk_labels.append("high IV")
    elif iv_risk == "MEDIUM":
        warning_parts.append("IV can move premium quickly")
        risk_labels.append("moderate IV")
    if liquidity_risk == "HIGH":
        warning_parts.append("spreads are wide or option flow is thin")
        risk_labels.append("poor liquidity")
    elif liquidity_risk == "MEDIUM":
        warning_parts.append("liquidity is only fair")
        risk_labels.append("fair liquidity")

    execution_warning = ""
    option_execution_warning = ""
    if not warning_parts:
        execution_warning = "Option execution conditions appear normal."
        option_execution_warning = execution_warning
    elif theta_risk == "HIGH":
        execution_warning = (
            f"Signal is strong, but {warning_parts[0]}. "
            "Use smaller size and confirm VWAP hold."
        )
        option_execution_warning = execution_warning
    else:
        execution_warning = (
            f"Signal is active — note that {'; '.join(warning_parts)}. "
            "Adjust size accordingly."
        )
        option_execution_warning = execution_warning

    return {
        "theta_risk": theta_risk,
        "gamma_risk": gamma_risk,
        "iv_risk": iv_risk,
        "liquidity_risk": liquidity_risk,
        "suggested_contract_window": suggested_contract_window,
        "option_execution_warning": option_execution_warning,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _no_options() -> dict:
    return {
        "theta_risk": "NONE",
        "gamma_risk": "NONE",
        "iv_risk": "LOW",
        "liquidity_risk": "LOW",
        "suggested_contract_window": "N/A",
        "option_execution_warning": "No options traded or option data unavailable.",
    }


def _days_until(expiry_str: str, today_str: str) -> int:
    try:
        exp = datetime.strptime(expiry_str[:10], "%Y-%m-%d").date()
        today_dt = datetime.strptime(today_str[:10], "%Y-%m-%d").date()
        return (exp - today_dt).days
    except Exception:
        return 999
