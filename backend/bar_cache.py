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
import re
import threading
import time
from datetime import date, datetime, timedelta
from typing import Dict, Optional, Tuple

import pandas as pd
import yfinance as yf
from zoneinfo import ZoneInfo

import backup_data

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------
BAR_CACHE_TTL_INTRADAY_MARKET    = int(os.getenv("BAR_CACHE_TTL_INTRADAY_MARKET",   "30"))
BAR_CACHE_TTL_INTRADAY_OFF       = int(os.getenv("BAR_CACHE_TTL_INTRADAY_OFF",      "300"))
BAR_CACHE_TTL_DAILY_SHORT_MARKET = int(os.getenv("BAR_CACHE_TTL_DAILY_SHORT_MARKET","90"))
BAR_CACHE_TTL_DAILY_SHORT_OFF    = int(os.getenv("BAR_CACHE_TTL_DAILY_SHORT_OFF",   "600"))
BAR_CACHE_TTL_DAILY_LONG_MARKET  = int(os.getenv("BAR_CACHE_TTL_DAILY_LONG_MARKET", "300"))
BAR_CACHE_TTL_DAILY_LONG_OFF     = int(os.getenv("BAR_CACHE_TTL_DAILY_LONG_OFF",    "3600"))
BAR_CACHE_TTL_INFO_MARKET        = int(os.getenv("BAR_CACHE_TTL_INFO_MARKET",        "60"))
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


def _massive_daily_history(ticker: str, period: str) -> pd.DataFrame:
    """Fallback daily bars via backup_data; returns empty DataFrame when unavailable."""
    try:
        start, end = backup_data.period_to_dates(period)
        rows = backup_data.get_daily_bars(ticker, start, end)
        if not rows:
            return pd.DataFrame()
        df = backup_data.bars_to_dataframe(rows)
        if df is None or df.empty:
            return pd.DataFrame()
        return df
    except Exception as exc:
        log.warning("bar_cache massive daily fallback failed %s: %s", ticker, exc)
        return pd.DataFrame()


_ALPACA_TF = {"1m": "1Min", "5m": "5Min", "15m": "15Min", "30m": "30Min", "60m": "1Hour", "1h": "1Hour"}


def _period_to_days(period: str) -> int:
    m = re.match(r"\s*(\d+)\s*(d|wk|mo|y)", str(period).lower())
    if not m:
        return 5
    n, unit = int(m.group(1)), m.group(2)
    return n if unit == "d" else n * 7 if unit == "wk" else n * 31 if unit == "mo" else n * 366


def _alpaca_intraday(ticker: str, period: str, interval: str) -> pd.DataFrame:
    """Live intraday bars via Alpaca's data API (reliable when Yahoo lags). Empty if
    Alpaca isn't configured or the interval isn't supported."""
    tf = _ALPACA_TF.get(interval)
    if not tf:
        return pd.DataFrame()
    try:
        import alpaca_trader
        if not alpaca_trader.is_configured():
            return pd.DataFrame()
        df = alpaca_trader.get_stock_bars(ticker, timeframe=tf, days=min(30, _period_to_days(period)))
        return df if df is not None and not df.empty else pd.DataFrame()
    except Exception as exc:
        log.warning("bar_cache alpaca intraday fetch failed %s: %s", ticker, exc)
        return pd.DataFrame()


def _massive_intraday_history(ticker: str, period: str, interval: str) -> pd.DataFrame:
    """Fallback 1-minute intraday bars via backup_data; returns empty when unavailable."""
    if interval != "1m":
        return pd.DataFrame()
    try:
        start, end = backup_data.period_to_dates(period)
        rows = backup_data.get_1min_bars(ticker, start, end, limit=50000)
        if not rows:
            return pd.DataFrame()
        df = backup_data.bars_to_dataframe(rows)
        if df is None or df.empty:
            return pd.DataFrame()
        return df
    except Exception as exc:
        log.warning("bar_cache massive intraday fallback failed %s: %s", ticker, exc)
        return pd.DataFrame()


def _normalize_yahoo_download_frame(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Normalize yf.download output to the same OHLCV shape as Ticker.history."""
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        # yfinance may return either (field, ticker) or (ticker, field).
        t = ticker.upper().strip()
        levels = [list(map(str, out.columns.get_level_values(i))) for i in range(out.columns.nlevels)]
        if t in {x.upper() for x in levels[-1]}:
            try:
                out = out.xs(t, axis=1, level=-1, drop_level=True)
            except Exception:
                out.columns = out.columns.get_level_values(0)
        elif t in {x.upper() for x in levels[0]}:
            try:
                out = out.xs(t, axis=1, level=0, drop_level=True)
            except Exception:
                out.columns = out.columns.get_level_values(-1)
        else:
            out.columns = out.columns.get_level_values(0)
    rename = {str(c).lower().replace(" ", ""): c for c in out.columns}
    required = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    }
    normalized: dict[str, pd.Series] = {}
    for key, label in required.items():
        col = rename.get(key)
        if col is None:
            return pd.DataFrame()
        normalized[label] = out[col]
    return pd.DataFrame(normalized, index=out.index).dropna(subset=["Open", "High", "Low", "Close"])


def _yahoo_download_history(
    ticker: str,
    *,
    period: str | None = None,
    interval: str = "1d",
    auto_adjust: bool = True,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> pd.DataFrame:
    try:
        df = yf.download(
            ticker,
            period=period,
            interval=interval,
            start=start,
            end=end,
            auto_adjust=auto_adjust,
            progress=False,
            threads=False,
        )
        return _normalize_yahoo_download_frame(df, ticker)
    except Exception as exc:
        log.warning("bar_cache yf.download fallback failed %s: %s", ticker, exc)
        return pd.DataFrame()


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _exclusive_end_for_yahoo(start: Optional[str], end: Optional[str]) -> Optional[str]:
    start_date = _parse_date(start)
    end_date = _parse_date(end)
    if start_date and end_date and end_date <= start_date:
        return (start_date + timedelta(days=1)).isoformat()
    return end


def _date_range_backup_history(ticker: str, start: Optional[str], end: Optional[str], interval: str) -> pd.DataFrame:
    start_date = _parse_date(start)
    end_date = _parse_date(end) or start_date
    if start_date is None or end_date is None:
        return pd.DataFrame()
    if end_date < start_date:
        end_date = start_date
    if interval in _INTRADAY_INTERVALS:
        if interval != "1m":
            return pd.DataFrame()
        rows = backup_data.get_1min_bars(ticker, start_date, end_date, limit=50000)
    elif interval in ("1d", "1wk", "1mo"):
        rows = backup_data.get_daily_bars(ticker, start_date, end_date)
    else:
        rows = None
    if not rows:
        return pd.DataFrame()
    df = backup_data.bars_to_dataframe(rows)
    return df if df is not None and not df.empty else pd.DataFrame()


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


def _get_stale(key: str) -> Optional[object]:
    """Return the cached value regardless of TTL — used as fallback when Yahoo fails."""
    with _lock:
        entry = _store.get(key)
        return entry[1] if entry else None


# Tracks tickers that served stale data on the most recent fetch attempt.
# Cleared at the start of each get_history / get_info call that succeeds.
_stale_served: set = set()
_stale_lock = threading.Lock()


def was_stale(ticker: str) -> bool:
    """Return True if the last fetch for *ticker* fell back to stale cached data."""
    with _stale_lock:
        return ticker.upper().strip() in _stale_served


def _mark_stale(ticker: str) -> None:
    with _stale_lock:
        _stale_served.add(ticker.upper().strip())


def _clear_stale(ticker: str) -> None:
    with _stale_lock:
        _stale_served.discard(ticker.upper().strip())


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
        yahoo_end = _exclusive_end_for_yahoo(start, end)
        try:
            tkr = yf.Ticker(t)
            df = tkr.history(start=start, end=yahoo_end, interval=interval, auto_adjust=auto_adjust)
            if df is not None and not df.empty:
                return df
            raise ValueError("Yahoo returned empty DataFrame")
        except Exception as exc:
            log.warning("bar_cache.get_history date-range failed %s: %s — trying download fallback", t, exc)
            fallback = _yahoo_download_history(
                t,
                interval=interval,
                auto_adjust=auto_adjust,
                start=start,
                end=yahoo_end,
            )
            if not fallback.empty:
                return fallback
            backup = _date_range_backup_history(t, start, end, interval)
            if not backup.empty:
                log.warning("bar_cache.get_history serving backup date-range data for %s", t)
                _mark_stale(t)
                return backup
            return pd.DataFrame()

    key = _cache_key(t, period, interval, str(auto_adjust))
    ttl = _history_ttl(period, interval)

    cached = _get(key, ttl, force_refresh)
    if cached is not None:
        log.debug("bar_cache.get_history CACHE_HIT %s period=%s interval=%s", t, period, interval)
        return cached  # type: ignore[return-value]

    log.debug("bar_cache.get_history MISS %s period=%s interval=%s — fetching", t, period, interval)
    # Prefer Alpaca for intraday when configured — Yahoo's free 1-minute feed
    # intermittently lags or stops serving today's bars, which blanks Day Trade.
    if interval in _INTRADAY_INTERVALS:
        alp = _alpaca_intraday(t, period, interval)
        if not alp.empty:
            _clear_stale(t)
            _set(key, alp)
            log.debug("bar_cache.get_history served Alpaca intraday %s %s", t, interval)
            return alp
    try:
        tkr = yf.Ticker(t)
        df = tkr.history(period=period, interval=interval, auto_adjust=auto_adjust)
        if df.empty:
            raise ValueError("Yahoo returned empty DataFrame")
    except Exception as exc:
        log.warning("bar_cache.get_history failed %s: %s — trying download fallback", t, exc)
        download = _yahoo_download_history(
            t,
            period=period,
            interval=interval,
            auto_adjust=auto_adjust,
        )
        if not download.empty:
            _clear_stale(t)
            _set(key, download)
            return download
        stale = _get_stale(key)
        if stale is not None:
            log.warning("bar_cache.get_history serving stale data for %s", t)
            _mark_stale(t)
            return stale  # type: ignore[return-value]
        if interval in _INTRADAY_INTERVALS:
            fallback = _massive_intraday_history(t, period, interval)
            if not fallback.empty:
                log.warning("bar_cache.get_history serving backup intraday data for %s", t)
                _mark_stale(t)
                _set(key, fallback)
                return fallback
        if interval in ("1d", "1wk", "1mo"):
            fallback = _massive_daily_history(t, period)
            if not fallback.empty:
                log.warning("bar_cache.get_history serving backup daily data for %s", t)
                _mark_stale(t)
                _set(key, fallback)
                return fallback
        return pd.DataFrame()

    _clear_stale(t)
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
        if not info:
            raise ValueError("Yahoo returned empty info")
    except Exception as exc:
        log.warning("bar_cache.get_info failed %s: %s — trying stale fallback", t, exc)
        stale = _get_stale(key)
        if stale is not None:
            log.warning("bar_cache.get_info serving stale data for %s", t)
            _mark_stale(t)
            return stale  # type: ignore[return-value]
        return {}

    _clear_stale(t)
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
        stale = _get_stale(key)
        if stale is not None:
            log.warning("bar_cache.get_option_chain serving stale data for %s %s", t, exp)
            calls, puts = stale  # type: ignore[misc]
            return calls, puts
        calls, puts = pd.DataFrame(), pd.DataFrame()

    if not calls.empty or not puts.empty:
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
        tk = yf.Ticker(t)
        cal = tk.calendar
        result = cal if isinstance(cal, dict) else {}
        # Attach last (most recent past) earnings date from earnings_dates history
        try:
            import pandas as _pd
            from datetime import date as _date
            ed_df = tk.earnings_dates
            if ed_df is not None and not ed_df.empty:
                today = _date.today()
                past = [
                    idx.date() if hasattr(idx, "date") else _pd.Timestamp(idx).date()
                    for idx in ed_df.index
                    if (idx.date() if hasattr(idx, "date") else _pd.Timestamp(idx).date()) < today
                ]
                if past:
                    result["Last Earnings Date"] = max(past).isoformat()
        except Exception:
            pass
    except Exception as exc:
        log.warning("bar_cache.get_calendar failed %s: %s", t, exc)
        result = {}

    _set(key, result)
    return result


def get_earnings_dates(ticker: str, force_refresh: bool = False) -> list[str]:
    """Return this ticker's earnings dates (past and upcoming) as sorted ISO date
    strings. Powers the earnings-volatility radar's historical-move statistics.

    TTL = BAR_CACHE_TTL_CALENDAR — earnings dates change infrequently.
    """
    t = ticker.upper().strip()
    key = _cache_key(t, "EARNINGS_DATES")

    cached = _get(key, BAR_CACHE_TTL_CALENDAR, force_refresh)
    if cached is not None:
        return cached  # type: ignore[return-value]

    result: list[str] = []
    try:
        import pandas as _pd
        ed_df = yf.Ticker(t).earnings_dates
        if ed_df is not None and not ed_df.empty:
            seen: set[str] = set()
            for idx in ed_df.index:
                d = (idx.date() if hasattr(idx, "date") else _pd.Timestamp(idx).date()).isoformat()
                if d not in seen:
                    seen.add(d)
                    result.append(d)
            result.sort()
    except Exception as exc:
        log.warning("bar_cache.get_earnings_dates failed %s: %s", t, exc)
        result = []

    _set(key, result)
    return result
