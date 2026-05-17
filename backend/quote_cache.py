"""
quote_cache.py — Shared in-process quote cache for SignalFeed and engines.

Provides:
  get_quotes(tickers, force_refresh=False) -> dict[ticker, QuoteData]

TTL rules (configurable via env):
  QUOTE_CACHE_TTL_MARKET_HOURS  default 90  seconds   (6:30 AM–4 PM ET, M–F)
  QUOTE_CACHE_TTL_AFTER_HOURS   default 900 seconds   (pre/post-market, M–F)
  QUOTE_CACHE_TTL_WEEKEND       default 3600 seconds  (Sat–Sun)

Cache key: uppercase ticker symbol.
Thread-safe via threading.Lock.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import yfinance as yf
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL constants (seconds) — overridable via environment variables
# ---------------------------------------------------------------------------
QUOTE_CACHE_TTL_MARKET_HOURS: int = int(os.getenv("QUOTE_CACHE_TTL_MARKET_HOURS", "90"))
QUOTE_CACHE_TTL_AFTER_HOURS: int  = int(os.getenv("QUOTE_CACHE_TTL_AFTER_HOURS",  "900"))
QUOTE_CACHE_TTL_WEEKEND: int      = int(os.getenv("QUOTE_CACHE_TTL_WEEKEND",       "3600"))

_ET = ZoneInfo("America/New_York")


def _current_ttl() -> int:
    """Return the appropriate quote TTL based on the current ET time."""
    now = time.time()
    from datetime import datetime as _dt
    dt = _dt.fromtimestamp(now, tz=_ET)
    if dt.weekday() >= 5:
        return QUOTE_CACHE_TTL_WEEKEND
    minutes = dt.hour * 60 + dt.minute
    # Regular market hours: 9:30 AM – 4:00 PM ET
    in_market = 9 * 60 + 30 <= minutes < 16 * 60
    return QUOTE_CACHE_TTL_MARKET_HOURS if in_market else QUOTE_CACHE_TTL_AFTER_HOURS


# ---------------------------------------------------------------------------
# Data container
# ---------------------------------------------------------------------------
@dataclass
class QuoteData:
    ticker: str
    price: float
    previous_close: float
    change: float
    change_percent: float
    volume: int
    avg_volume: int
    high: float
    low: float
    open: float
    timestamp: float          # unix epoch when fetched
    source: str               # "yahoo_live" | "yahoo_cache" | "error"
    cache_age_seconds: float  # seconds since this entry was stored

    def as_dict(self) -> dict:
        return {
            "ticker":            self.ticker,
            "price":             self.price,
            "previous_close":    self.previous_close,
            "change":            self.change,
            "change_percent":    self.change_percent,
            "volume":            self.volume,
            "avg_volume":        self.avg_volume,
            "high":              self.high,
            "low":               self.low,
            "open":              self.open,
            "timestamp":         self.timestamp,
            "source":            self.source,
            "cache_age_seconds": round(self.cache_age_seconds, 1),
        }


# ---------------------------------------------------------------------------
# Internal store: ticker -> (stored_at_epoch, QuoteData)
# ---------------------------------------------------------------------------
_store: Dict[str, Tuple[float, QuoteData]] = {}
_lock  = threading.Lock()


def _is_stale(stored_at: float, ttl: int) -> bool:
    return time.time() - stored_at >= ttl


def _make_error_quote(ticker: str) -> QuoteData:
    now = time.time()
    return QuoteData(
        ticker=ticker, price=0.0, previous_close=0.0, change=0.0,
        change_percent=0.0, volume=0, avg_volume=0, high=0.0, low=0.0,
        open=0.0, timestamp=now, source="error", cache_age_seconds=0.0,
    )


# ---------------------------------------------------------------------------
# Single-ticker fetch (yfinance info dict)
# ---------------------------------------------------------------------------
def _fetch_one(ticker: str) -> QuoteData:
    """Fetch live quote for a single ticker via yfinance .info."""
    t = ticker.upper().strip()
    now = time.time()
    try:
        info = yf.Ticker(t).info or {}
        price = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        prev  = float(info.get("previousClose")  or info.get("regularMarketPreviousClose") or 0)
        chg   = round(price - prev, 4) if price and prev else 0.0
        chg_p = round((chg / prev) * 100, 4) if prev else 0.0
        return QuoteData(
            ticker=t,
            price=round(price, 4),
            previous_close=round(prev, 4),
            change=chg,
            change_percent=chg_p,
            volume=int(info.get("volume") or info.get("regularMarketVolume") or 0),
            avg_volume=int(info.get("averageVolume") or 0),
            high=round(float(info.get("dayHigh") or info.get("regularMarketDayHigh") or 0), 4),
            low=round(float(info.get("dayLow")  or info.get("regularMarketDayLow")  or 0), 4),
            open=round(float(info.get("open")   or info.get("regularMarketOpen")    or 0), 4),
            timestamp=now,
            source="yahoo_live",
            cache_age_seconds=0.0,
        )
    except Exception as exc:
        log.warning("quote_cache: fetch failed for %s: %s", t, exc)
        return _make_error_quote(t)


# ---------------------------------------------------------------------------
# Bulk fetch: use yfinance download() for efficiency when >1 ticker
# ---------------------------------------------------------------------------
def _fetch_bulk(tickers: List[str]) -> Dict[str, QuoteData]:
    """
    Fetch multiple tickers in one yfinance download() call.
    Falls back to individual .info fetches for metadata (prev_close, volume, etc.)
    because yf.download only returns OHLCV.
    """
    results: Dict[str, QuoteData] = {}
    if not tickers:
        return results

    if len(tickers) == 1:
        q = _fetch_one(tickers[0])
        results[q.ticker] = q
        return results

    # For multiple tickers, fetch .info individually — yf.download doesn't include
    # prev_close / volume / avg_volume which we need for the quote fields.
    # We do them concurrently to keep wall-clock time low.
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as ex:
        futures = {ex.submit(_fetch_one, t): t for t in tickers}
        for fut in concurrent.futures.as_completed(futures):
            q = fut.result()
            results[q.ticker] = q
    return results


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def get_quotes(
    tickers: List[str],
    force_refresh: bool = False,
) -> Tuple[Dict[str, QuoteData], dict]:
    """
    Return quotes for the requested tickers using the cache.

    Parameters
    ----------
    tickers       : list of ticker symbols (case-insensitive)
    force_refresh : if True, bypass cache and fetch fresh from Yahoo

    Returns
    -------
    (quotes_dict, cache_meta)
    quotes_dict : ticker -> QuoteData
    cache_meta  : {used_cache, cache_hits, cache_misses, force_refresh,
                   oldest_cache_age_seconds, source}
    """
    tickers = [t.upper().strip() for t in tickers if t and t.strip()]
    ttl = _current_ttl()
    now = time.time()

    hits: List[str]   = []
    misses: List[str] = []

    with _lock:
        for t in tickers:
            entry = _store.get(t)
            if not force_refresh and entry and not _is_stale(entry[0], ttl):
                hits.append(t)
            else:
                misses.append(t)

    # Fetch only the misses (outside the lock — network I/O)
    if misses:
        fetched = _fetch_bulk(misses)
        with _lock:
            for t, q in fetched.items():
                _store[t] = (now, q)

    # Build result from cache (all tickers should now be cached)
    result: Dict[str, QuoteData] = {}
    oldest_age = 0.0
    with _lock:
        for t in tickers:
            entry = _store.get(t)
            if entry:
                stored_at, q = entry
                age = round(now - stored_at, 1)
                q.cache_age_seconds = age
                oldest_age = max(oldest_age, age)
                result[t] = q
            else:
                result[t] = _make_error_quote(t)

    cache_meta = {
        "used_cache":               len(hits) > 0,
        "cache_hits":               len(hits),
        "cache_misses":             len(misses),
        "force_refresh":            force_refresh,
        "oldest_cache_age_seconds": round(oldest_age, 1),
        "source":                   "yahoo_live" if misses else "yahoo_cache",
        "ttl_seconds":              ttl,
    }
    return result, cache_meta


def get_quote(ticker: str, force_refresh: bool = False) -> QuoteData:
    """Convenience wrapper for a single ticker."""
    quotes, _ = get_quotes([ticker], force_refresh=force_refresh)
    return quotes.get(ticker.upper().strip()) or _make_error_quote(ticker)


def invalidate(ticker: str) -> None:
    """Remove a ticker from cache (e.g., after a position change)."""
    t = ticker.upper().strip()
    with _lock:
        _store.pop(t, None)


def invalidate_all() -> None:
    """Wipe the entire quote cache (e.g., end-of-day reset)."""
    with _lock:
        _store.clear()
