"""
Backup market data source — api.massive.com (Polygon-compatible API).

Used as a fallback when Yahoo Finance (yfinance / bar_cache) returns empty
or stale data, particularly for the 6:30–7:00 AM PT early-session window
where Yahoo lags.

Configuration (via environment variables):
  MASSIVE_API_KEY   — API key for api.massive.com  (required for auth)
  POLYGON_API_KEY   — accepted alias for Polygon-compatible deployments

API base: https://api.massive.com
Endpoints used (Polygon-compatible paths):
  Aggregates (OHLCV bars):
    /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
  Ticker snapshot (pre-market price, prev-day OHLC):
    /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}
  Ticker reference (health-check / info):
    /v3/reference/tickers/{ticker}
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime
from datetime import timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

MASSIVE_BASE    = os.getenv("MASSIVE_BASE_URL", "https://api.massive.com")
MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY") or os.getenv("POLYGON_API_KEY", "")

ET = ZoneInfo("America/New_York")
PT = ZoneInfo("America/Los_Angeles")

_TIMEOUT = 8  # seconds


def _params(**kw: Any) -> dict[str, Any]:
    """Merge caller kwargs with optional apiKey."""
    p = {k: v for k, v in kw.items() if v is not None}
    if MASSIVE_API_KEY:
        p["apiKey"] = MASSIVE_API_KEY
    return p


def _headers() -> dict[str, str]:
    if MASSIVE_API_KEY:
        return {"Authorization": f"Bearer {MASSIVE_API_KEY}"}
    return {}


# ---------------------------------------------------------------------------
# 1-minute OHLCV bars
# ---------------------------------------------------------------------------

def get_1min_bars(
    ticker: str,
    from_date: date,
    to_date: date,
    limit: int = 500,
) -> Optional[list[dict[str, Any]]]:
    """
    Fetch 1-minute OHLCV bars from api.massive.com.

    Returns a list of Polygon-format result dicts:
      { "t": <unix_ms>, "o": open, "h": high, "l": low, "c": close, "v": volume }
    Returns None if the request fails or returns no results.
    """
    t = ticker.upper().strip()
    url = (
        f"{MASSIVE_BASE}/v2/aggs/ticker/{t}"
        f"/range/1/minute/{from_date.isoformat()}/{to_date.isoformat()}"
    )
    try:
        resp = httpx.get(
            url,
            params=_params(adjusted="true", sort="asc", limit=limit),
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
        return results or None
    except Exception as exc:
        log.warning("backup_data.get_1min_bars(%s): %s", t, exc)
        return None


def get_daily_bars(
    ticker: str,
    from_date: date,
    to_date: date,
    limit: int = 5000,
) -> Optional[list[dict[str, Any]]]:
    """
    Fetch daily OHLCV bars from api.massive.com.

    Returns Polygon-format aggregate bars:
      { "t": <unix_ms>, "o": open, "h": high, "l": low, "c": close, "v": volume }
    """
    if not MASSIVE_API_KEY:
        return None
    t = ticker.upper().strip()
    url = (
        f"{MASSIVE_BASE}/v2/aggs/ticker/{t}"
        f"/range/1/day/{from_date.isoformat()}/{to_date.isoformat()}"
    )
    try:
        resp = httpx.get(
            url,
            params=_params(adjusted="true", sort="asc", limit=limit),
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
        return results or None
    except Exception as exc:
        log.warning("backup_data.get_daily_bars(%s): %s", t, exc)
        return None


def period_to_dates(period: str, today: Optional[date] = None) -> tuple[date, date]:
    """Convert common yfinance period strings into a conservative date range."""
    end = today or datetime.now(ET).date()
    p = (period or "1y").strip().lower()
    try:
        amount = int(p[:-1])
        unit = p[-1]
    except Exception:
        amount, unit = 1, "y"
    if unit == "d":
        delta = timedelta(days=max(amount * 2, amount + 7))
    elif unit == "mo":
        delta = timedelta(days=amount * 31 + 10)
    elif unit == "y":
        delta = timedelta(days=amount * 366 + 10)
    else:
        delta = timedelta(days=376)
    return end - delta, end


def bars_to_dataframe(results: list[dict[str, Any]]):
    """
    Convert Polygon-format bar results to a pandas DataFrame that matches
    the shape returned by bar_cache.get_history() / yfinance:
      columns: Open, High, Low, Close, Volume
      index:   DatetimeIndex (timezone-aware, America/New_York)
    """
    import pandas as pd

    if not results:
        return None

    rows = [
        {
            "Open":   float(r.get("o") or 0),
            "High":   float(r.get("h") or 0),
            "Low":    float(r.get("l") or 0),
            "Close":  float(r.get("c") or 0),
            "Volume": int(r.get("v") or 0),
        }
        for r in results
    ]
    ts_ms = [r.get("t", 0) for r in results]
    idx   = pd.to_datetime(ts_ms, unit="ms", utc=True).tz_convert(ET)
    df    = pd.DataFrame(rows, index=idx)
    df.index.name = "Datetime"
    return df


# ---------------------------------------------------------------------------
# Snapshot / pre-market prices
# ---------------------------------------------------------------------------

def get_snapshot(ticker: str) -> Optional[dict[str, Any]]:
    """
    Fetch the full ticker snapshot from api.massive.com.
    Returns the inner ``ticker`` dict, or None on failure.

    Snapshot includes: prevDay (OHLCV), day (today OHLCV), lastTrade, lastQuote,
    min (most recent 1-min bar), todaysChangePerc, etc.
    """
    t = ticker.upper().strip()
    url = f"{MASSIVE_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{t}"
    try:
        resp = httpx.get(
            url,
            params=_params(),
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("ticker") or None
    except Exception as exc:
        log.warning("backup_data.get_snapshot(%s): %s", t, exc)
        return None


def get_premarket_pct(ticker: str) -> Optional[float]:
    """
    Compute pre-market % change for ticker from the massive.com snapshot.

    Uses: (today's opening price OR last trade) vs previous close.
    Returns the percentage as a float (e.g. 0.35 = +0.35%), or None.
    """
    snap = get_snapshot(ticker)
    if not snap:
        return None

    prev_close = (snap.get("prevDay") or {}).get("c")
    # Best pre-market price proxy: today's open, then last trade, then ask
    day_open   = (snap.get("day") or {}).get("o")
    last_price = (snap.get("lastTrade") or {}).get("p")
    ask        = (snap.get("lastQuote") or {}).get("P")

    pre_price = day_open or last_price or ask
    if not pre_price or not prev_close or float(prev_close) <= 0:
        return None

    return round((float(pre_price) / float(prev_close) - 1.0) * 100.0, 3)


def get_prev_close_range_position(ticker: str) -> Optional[float]:
    """
    Return position of yesterday's close within the day's H-L range (0.0–1.0).
    Uses the ``prevDay`` field from the snapshot.
    """
    snap = get_snapshot(ticker)
    if not snap:
        return None
    prev = snap.get("prevDay") or {}
    hi   = float(prev.get("h") or 0)
    lo   = float(prev.get("l") or 0)
    cl   = float(prev.get("c") or 0)
    rng  = hi - lo
    if rng <= 0 or cl <= 0:
        return None
    return round((cl - lo) / rng, 4)
