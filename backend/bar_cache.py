"""
bar_cache.py — Shared OHLCV bar, info, options, and calendar cache.

ALL yfinance .history(), .info, .options, .option_chain(), and .calendar
calls from engines, alerts, and background scanners must go through this
module.  Direct yf.Ticker(...) usage is forbidden outside this file and
quote_cache.py.

Public API
----------
get_history(ticker, period, interval, auto_adjust, force_refresh) -> pd.DataFrame
get_info(ticker, force_refresh)                                    -> dict
get_option_dates(ticker, force_refresh)                            -> tuple[str, ...]
get_option_chain(ticker, expiry, force_refresh)                    -> (calls_df, puts_df)
get_calendar(ticker, force_refresh)                                -> dict

TTL rules (configurable via env vars)
--------------------------------------
Intraday (interval="1m","2m","5m"):
  BAR_CACHE_TTL_INTRADAY_MARKET   default 60s
  BAR_CACHE_TTL_INTRADAY_OFF      default 300s

Daily short (period ≤ "5d"):
  BAR_CACHE_TTL_DAILY_SHORT_MARKET  default 90s
  BAR_CACHE_TTL_DAILY_SHORT_OFF     default 600s

Daily long (period "1mo" and above):
  BAR_CACHE_TTL_DAILY_LONG_MARKET   default 300s
  BAR_CACHE_TTL_DAILY_LONG_OFF      default 3600s

Info / option dates / option chain:
  BAR_CACHE_TTL_INFO_MARKET         default 120s
  BAR_CACHE_TTL_INFO_OFF            default 600s

Earnings calendar:
  BAR_CACHE_TTL_CALENDAR            default 3600s  (changes infrequently)
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Dict, Optional, Tuple

import pandas as pd
import yfinance as yf
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------
BAR_CACHE_TTL_INTRADAY_MARKET    = int(os.getenv("BAR_CACHE_TTL_INTRADAY_MARKET",   "60"))
BAR_CACHE_TTL_INTRADAY_OFF       = int(os.getenv("BAR_CACHE_TTL_INTRADAY_OFF",      "300"))
BAR_CACHE_TTL_DAILY_SHORT_MARKET = int(os.getenv("BAR_CACHE_TTL_DAILY_SHORT_MARKET","90"))
BAR_CACHE_TTL_DAILY_SHORT_OFF    = int(os.getenv("BAR_CACHE_TTL_DAILY_SHORT_OFF",   "600"))
BAR_CACHE_TTL_DAILY_LONG_MARKET  = int(os.getenv("BAR_CACHE_TTL_DAILY_LONG_MARKET", "300"))
BAR_CACHE_TTL_DAILY_LONG_OFF     = int(os.getenv("BAR_CACHE_TTL_DAILY_LONG_OFF",    "3600"))
BAR_CACHE_TTL_INFO_MARKET        = int(os.getenv("BAR_CACHE_TTL_INFO_MARKET",        "120"))
BAR_CACHE_TTL_INFO_OFF           = int(os.getenv("BAR_CACHE_TTL_INFO_OFF",           "600"))
BAR_CACHE_TTL_CALENDAR           = int(os.getenv("BAR_CACHE_TTL_CALENDAR",           "3600"))

# ---------------------------------------------------------------------------
# Internal store: cache_key -> (stored_at, value)
# ---------------------------------------------------------------------------
_store: Dict[str, Tuple[float, object]] = {}
_lock  = threading.Lock()

# ---------------------------------------------------------------------------
# TTL helpers
# ---------------------------------------------------------------------------
_SHORT_PERIODS = {"1d", "2d", "3d", "4d", "5d", "6d", "7d"}
_INTRADAY_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}


def _is_market_hours() -> bool:
    from datetime import datetime as _dt
    dt = _dt.fromtimestamp(time.time(), tz=_ET)
    if dt.weekday() >= 5:
        return False
    minutes = dt.hour * 60 + dt.minute
    return 9 * 60 + 30 <= minutes < 16 * 60


def _history_ttl(period: str, interval: str) -> int:
    market = _is_market_hours()
    if interval in _INTRADAY_INTERVALS:
        return BAR_CACHE_TTL_INTRADAY_MARKET if market else BAR_CACHE_TTL_INTRADAY_OFF
    if period in _SHORT_PERIODS:
        return BAR_CACHE_TTL_DAILY_SHORT_MARKET if market else BAR_CACHE_TTL_DAILY_SHORT_OFF
    return BAR_CACHE_TTL_DAILY_LONG_MARKET if market else BAR_CACHE_TTL_DAILY_LONG_OFF


def _info_ttl() -> int:
    return BAR_CACHE_TTL_INFO_MARKET if _is_market_hours() else BAR_CACHE_TTL_INFO_OFF


# ---------------------------------------------------------------------------
# Generic cache helpers
# ---------------------------------------------------------------------------
def _cache_key(*parts: str) -> str:
    return "|".join(str(p).upper() for p in parts)


def _get(key: str, ttl: int, force_refresh: bool) -> Optional[object]:
    if force_refresh:
        return None
    with _lock:
        entry = _store.get(key)
        if entry and (time.time() - entry[0]) < ttl:
            return entry[1]
    return None


def _set(key: str, value: object) -> None:
    with _lock:
        _store[key] = (time.time(), value)


def invalidate(ticker: str) -> None:
    """Remove all cache entries for *ticker* (e.g. after a watchlist change)."""
    prefix = ticker.upper().strip() + "|"
    with _lock:
        stale = [k for k in _store if k.startswith(prefix) or k == ticker.upper().strip()]
        for k in stale:
            del _store[k]


def invalidate_all() -> None:
    """Wipe the entire bar cache."""
    with _lock:
        _store.clear()


# ---------------------------------------------------------------------------
# get_history
# ---------------------------------------------------------------------------
def get_history(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    auto_adjust: bool = True,
    force_refresh: bool = False,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> pd.DataFrame:
    """
    Return OHLCV bars for *ticker*, using the bar cache.

    Parameters mirror yf.Ticker.history() for period/interval/auto_adjust.
    Use start/end (YYYY-MM-DD strings) for date-range fetches (backtest,
    journal refresh) — these are NOT cached because the key space is unbounded.
    """
    t = ticker.upper().strip()

    # Date-range fetches bypass cache (unbounded key space)
    if start is not None or end is not None:
        log.debug("bar_cache.get_history %s date-range %s→%s (no cache)", t, start, end)
        try:
            tkr = yf.Ticker(t)
            return tkr.history(start=start, end=end, auto_adjust=auto_adjust)
        except Exception as exc:
            log.warning("bar_cache.get_history date-range failed %s: %s", t, exc)
            return pd.DataFrame()

    key = _cache_key(t, period, interval, str(auto_adjust))
    ttl = _history_ttl(period, interval)

    cached = _get(key, ttl, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_history CACHE_HIT %s period=%s interval=%s", t, period, interval)
        return cached  # type: ignore[return-value]

    log.debug("bar_cache.get_history MISS %s period=%s interval=%s — fetching Yahoo", t, period, interval)
    try:
        tkr = yf.Ticker(t)
        df = tkr.history(period=period, interval=interval, auto_adjust=auto_adjust)
    except Exception as exc:
        log.warning("bar_cache.get_history failed %s: %s", t, exc)
        return pd.DataFrame()

    _set(key, df)
    return df


# ---------------------------------------------------------------------------
# get_info
# ---------------------------------------------------------------------------
def get_info(ticker: str, force_refresh: bool = False) -> dict:
    """Return yfinance .info dict for *ticker*, using the bar cache."""
    t = ticker.upper().strip()
    key = _cache_key(t, "INFO")
    ttl = _info_ttl()

    cached = _get(key, ttl, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_info CACHE_HIT %s", t)
        return cached  # type: ignore[return-value]

    log.debug("bar_cache.get_info MISS %s — fetching Yahoo", t)
    try:
        info = yf.Ticker(t).info or {}
    except Exception as exc:
        log.warning("bar_cache.get_info failed %s: %s", t, exc)
        info = {}

    _set(key, info)
    return info


# ---------------------------------------------------------------------------
# get_option_dates
# ---------------------------------------------------------------------------
def get_option_dates(ticker: str, force_refresh: bool = False) -> Tuple[str, ...]:
    """Return available option expiry dates for *ticker*, using the bar cache."""
    t = ticker.upper().strip()
    key = _cache_key(t, "OPTION_DATES")
    ttl = _info_ttl()

    cached = _get(key, ttl, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_option_dates CACHE_HIT %s", t)
        return cached  # type: ignore[return-value]

    log.debug("bar_cache.get_option_dates MISS %s — fetching Yahoo", t)
    try:
        dates: Tuple[str, ...] = yf.Ticker(t).options or ()
    except Exception as exc:
        log.warning("bar_cache.get_option_dates failed %s: %s", t, exc)
        dates = ()

    _set(key, dates)
    return dates


# ---------------------------------------------------------------------------
# get_option_chain
# ---------------------------------------------------------------------------
def get_option_chain(
    ticker: str,
    expiry: str,
    force_refresh: bool = False,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Return (calls_df, puts_df) for *ticker* and *expiry*, using the bar cache.

    TTL = _info_ttl() (120s market / 600s off-hours).
    """
    t = ticker.upper().strip()
    exp = expiry.strip()
    key = _cache_key(t, "CHAIN", exp)
    ttl = _info_ttl()

    cached = _get(key, ttl, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_option_chain CACHE_HIT %s %s", t, exp)
        calls, puts = cached  # type: ignore[misc]
        return calls, puts

    log.debug("bar_cache.get_option_chain MISS %s %s — fetching Yahoo", t, exp)
    try:
        chain = yf.Ticker(t).option_chain(exp)
        calls = chain.calls.copy()
        puts  = chain.puts.copy()
    except Exception as exc:
        log.warning("bar_cache.get_option_chain failed %s %s: %s", t, exp, exc)
        calls, puts = pd.DataFrame(), pd.DataFrame()

    _set(key, (calls, puts))
    return calls, puts


# ---------------------------------------------------------------------------
# get_calendar (earnings)
# ---------------------------------------------------------------------------
def get_calendar(ticker: str, force_refresh: bool = False) -> dict:
    """
    Return yfinance .calendar dict for *ticker*.

    TTL = BAR_CACHE_TTL_CALENDAR (3600s) — earnings dates change infrequently.
    """
    t = ticker.upper().strip()
    key = _cache_key(t, "CALENDAR")

    cached = _get(key, BAR_CACHE_TTL_CALENDAR, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_calendar CACHE_HIT %s", t)
        return cached  # type: ignore[return-value]

    log.debug("bar_cache.get_calendar MISS %s — fetching Yahoo", t)
    try:
        cal = yf.Ticker(t).calendar
        result = cal if isinstance(cal, dict) else {}
    except Exception as exc:
        log.warning("bar_cache.get_calendar failed %s: %s", t, exc)
        result = {}

    _set(key, result)
    return result
