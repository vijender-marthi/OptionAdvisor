# Yahoo Finance Throttle Protection

## Problem

`bar_cache.py` has no rate-limit handling. If Yahoo returns HTTP 429 or an empty
response due to throttling, the cache silently returns an empty DataFrame. The scan
then runs on missing data with no warning shown to the user.

Current error handling in `bar_cache.py` (lines ~166, 182, 207, 232, 269, 298):
```python
except Exception as exc:
    log.warning(...)
    return pd.DataFrame()   # ← silent empty return, no user-facing signal
```

## When this becomes a risk

- Scanning 4+ tickers simultaneously at 60s refresh (~2,400 req/hr, near Yahoo's ~2,000 limit)
- Multiple users on the same server IP sharing the quota
- Yahoo tightening their limits (has happened before with no warning)

## What to implement

### 1. Detect throttle responses
Yahoo returns HTTP 429 or an empty DataFrame with no error when throttled.
yfinance does not always raise — sometimes it just silently returns empty.

Detection heuristic: if a ticker that had valid bars on the previous cache entry
now returns an empty DataFrame, treat it as a throttle hit, not real data.

```python
# In get_history(), after the yf fetch:
if df.empty and cached_value_exists:
    log.warning("bar_cache: empty response for %s — possible Yahoo throttle, serving stale", t)
    return stale_cached_value   # return last known good data instead of empty
```

### 2. Stale-on-error fallback
Instead of returning `pd.DataFrame()` on any exception, return the last cached
value (even if expired) with a staleness flag attached or logged.

```python
def _get_stale(key: str) -> Optional[object]:
    """Return cached value regardless of TTL — for use as throttle fallback."""
    with _lock:
        entry = _store.get(key)
        return entry[1] if entry else None
```

Use in `get_history()` and `get_info()` except blocks:
```python
except Exception as exc:
    log.warning("bar_cache: fetch failed %s: %s — trying stale fallback", t, exc)
    stale = _get_stale(key)
    if stale is not None:
        return stale
    return pd.DataFrame()
```

### 3. Exponential backoff on repeated failures
Track consecutive failures per ticker. After 3 consecutive empty/error responses,
back off for 5 minutes before retrying Yahoo (serve stale data during backoff).

```python
_fail_counts: Dict[str, int] = {}
_backoff_until: Dict[str, float] = {}

BACKOFF_AFTER_N_FAILS = 3
BACKOFF_SECONDS = 300
```

### 4. Surface staleness to the UI
Add a `data_stale` or `throttle_warning` flag to the scan result so the frontend
can show a banner like: "Data may be delayed — Yahoo Finance rate limit reached."

The `_bar_data_stale` flag pattern already exists in `day_trade.py` (around line 997)
for the "last bar > 5 min old" case — extend the same pattern for throttle staleness.

## Files to change

- `backend/bar_cache.py` — stale fallback, backoff tracking, throttle detection
- `backend/day_trade.py` — propagate throttle flag into scan result metrics
- `frontend/src/components/DayTradeEnginePanel.tsx` — show staleness banner when flag is set

## Related context

- Rate limit discussion happened while reducing cache TTLs (bar cache 60→30s, info 120→60s,
  scan cache 90→60s, frontend auto-refresh 300→60s)
- Single ticker at 60s refresh = ~600 req/hr — safe. Risk starts at 4+ tickers or multi-user.
- Yahoo's limit is approximately 2,000 req/hr per IP (undocumented, subject to change)
