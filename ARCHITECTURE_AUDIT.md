# Architecture Verification Report
**Date:** 2026-05-08  
**Scope:** Engine separation · Decision resolver · Alert normalizer · Watchlist consistency · Command center data flow · Mock/stub status  

---

## Summary

| Check | Area | Status | Severity |
|-------|------|--------|----------|
| 1 | Engine separation (Day / Swing / Regular) | ✅ Clean | — |
| 2 | Decision resolver wiring | ✅ Correct in per-ticker paths | — |
| 3 | Resolver fallback (no recommendations) | ⚠️ Calls resolver with empty data | Low |
| 4 | Alert normalizer | ✅ Fully wired | — |
| 5 | Alert Center seeding | ✅ One-time seed only | — |
| 6 | **Trade Command Center data** | ❌ 100% stub — engines never called | **High** |
| 7 | Frontend decision logic | ✅ None — pure display | — |
| 8 | Unified Watchlist | ✅ Reads backend final_decision | — |
| 9 | Mock flag | ✅ Dormant (VITE_USE_MOCK not set) | — |

One patch applied (Check 3). Check 6 is a design gap documented below.

---

## CHECK 1 — Engine Separation ✅

**`day_trade.py` (654 lines)**
- Signals: VWAP position, session momentum %, RS vs QQQ, VIX filter.
- Output: `verdict` (GO / STRONG GO / WATCH / WAIT / NO-GO), `bias` (long/short), `confidence_block`.
- Zero spread/delta/BS/IV pricing logic found. Clean.

**`swing_trade.py` (1364 lines)**
- Signals: RSI, MACD, SMA trend, volume trend, IV rank (awareness only — penalizes score, doesn't price spreads).
- Output: `final_action`, `entry_quality`, `trade_quality_score` (0–10).
- Zero VWAP/scalp/intraday logic. The `iv_rank` import from `analysis.py` is read-only scoring, not spread construction. Clean.

**`engine.py` (1690 lines)**
- Signals: delta selection, Black-Scholes EV, credit/debit spread construction, Kelly sizing, liquidity filtering.
- Output: `signals`, `recommendations` with full leg details.
- Zero VWAP/intraday momentum signals. Clean.

**Verdict: separation is airtight across all three engines.**

---

## CHECK 2 — Decision Resolver Wiring ✅

`resolver.py` has three dispatch functions (`_resolve_day_trade`, `_resolve_swing_trade`, `_resolve_regular_trade`) correctly differentiated by `engine_type`.

Correct call sites in `main.py` (passing real engine output):
- Line 1736: day resolver called with `run_day_trade_scan()` result including `verdict`, `bias`, `confidence`
- Line 1755: swing resolver called with `build_swing_trade_decision()` result including `final_action`, `entry_quality`, `trade_quality_score`
- Line 1726: regular resolver called with `run_engine()` result including `signals`, `recommendations`

All three paths produce a fully populated `ResolvedTradeDecision` with real market data.

---

## CHECK 3 — Resolver Fallback ⚠️ (patched)

**Location:** `command_center_router.py` line 377

**Problem:** When an engine has no matching recommendation in the aggregation loop, the fallback is:
```python
resolved = resolve_trade_decision({"engine_type": engine_key})
```
This passes an empty analysis dict. The resolver receives no `verdict`, `final_action`, or `signals` — so it silently returns default WAIT with the reason string `"No signals passed the current filters."` This is technically accurate but misleading: it implies the engine ran and found nothing, when in fact it was never called.

**Fix applied:** Replace the resolver call with explicit "no data" defaults (see patch below). The engine card will show `signal: NO_EDGE`, `reason: "No live data — engine has not been run for this watchlist."`. This is honest and avoids pretending the resolver evaluated real data.

---

## CHECK 4 — Alert Normalizer ✅

`alert_normalizer.py` has handlers for all five engine types: DAY, SWING, REGULAR, PORTFOLIO, MARKET.

`alert_service.py` → `build_alert_center_payload()` correctly sections alerts by engine type and computes summary counts.

Alert CRUD endpoints (acknowledge, resolve, note) are live in `command_center_router.py`.

---

## CHECK 5 — Alert Center Seeding ✅

`storage.py` → `ensure_demo_alert_center_rows()` calls `demo_alerts()` **only when the user's alert table is empty** (COUNT = 0 guard). After first real alerts are written, demo data is never inserted again. This is correct seed behavior, not a production data contamination.

---

## CHECK 6 — Trade Command Center: Stub Still Active ❌

**This is the most significant architectural gap found.**

The `/trade-command-center` endpoint in `command_center_router.py` calls `_trade_command_center_stub()` which returns **fully hardcoded data**:
- Engines: static NVDA (day GO), TSLA (swing GO), MSFT (regular TRADE)
- Recommendations: 6 hardcoded rows with fabricated entry zones, targets, stops, and expiry dates
- Conflicts: 2 hardcoded conflict scenarios
- Charts: hardcoded signal distribution

The real engines (`run_day_trade_scan`, `build_swing_trade_decision`, `run_engine`) are **never called** from this router. The market_summary section was fixed to use live Yahoo Finance data (previous session), but all trade recommendations remain fabricated.

The comment at the top of the file acknowledges this: `"Aggregate stub until live engines are wired"`.

**What's working vs. what's stub:**

| Section | Status |
|---------|--------|
| Market summary (SPY/QQQ/VIX) | ✅ Live yfinance |
| Market Position widget (200-MA) | ✅ Live yfinance |
| Engine cards (signals) | ❌ Hardcoded |
| Recommendations | ❌ Hardcoded (NVDA/TSLA/MSFT/AVGO) |
| Conflicts | ❌ Hardcoded |
| Charts (signal distribution) | ❌ Derived from hardcoded recs |

**To make this live**, the endpoint needs to iterate the user's watchlist, run each engine per ticker (reusing the existing `main.py` engine-call patterns), and aggregate results. This is a feature build, not a bug fix. The stub is intentional scaffolding — document it here and plan it separately.

---

## CHECK 7 — Frontend Decision Logic ✅

Searched all pages for client-side decision computation patterns (`RSI >`, `VWAP`, `if signal ===` with computation, `bullScore`, `bearScore` used to derive new signals).

**Only display helpers found** — no computation:
- `engineSignalFromCache()`: reads `entry.data.final_decision` from backend cache — pure read.
- `isActionable()`, `isAvoid()`: classify existing backend signals for UI coloring — pure display.
- `buildFallbackConflicts()`: client-side fallback only if backend returns no `conflicts` array — reads signal strings, no new computation.
- `enginePillClass()` / `enginePillLabel()`: CSS mapping functions.

Architecture rule "all calculations live in the backend" is respected across all pages.

---

## CHECK 8 — Unified Watchlist ✅

`UnifiedWatchlistPage.tsx`:
- Reads `final_decision` from backend ticker cache (`entry.data.final_decision`).
- Day/Swing/Options tabs are access-controlled separately.
- No engine-type signal mixing in the UI layer.

`fetchWatchlistX()` in `commandCenter.ts` calls `/watchlistx` which is served from `command_center_router.py`. The WatchlistX endpoint does correctly iterate the real watchlist and calls `_build_watchlist_row()` per ticker — this path is live, not stubbed.

---

## CHECK 9 — Mock Flag Status ✅

`frontend/.env`:
```
VITE_USE_MOCK=   (not set)
```

`VITE_USE_MOCK !== 'true'` → `USE_MOCK = false` in `commandCenter.ts`. All `if (USE_MOCK)` branches in the API client are dormant. Mock files exist but are never imported in production.

---

## Patch Applied

**File:** `backend/command_center_router.py`  
**Location:** Line 377 — resolver fallback in the engine aggregation loop

**Before:**
```python
else:
    resolved = resolve_trade_decision({"engine_type": engine_key})
    engine_row["market_bias"] = resolved.market_bias
    ...
    engine_row["reason"] = resolved.reason
```

**After:**
```python
else:
    # No live recommendation for this engine — mark explicitly as no-data.
    # Do NOT call the resolver with an empty dict; that silently returns WAIT
    # defaults which imply the engine ran and found nothing.
    engine_row["market_bias"] = "NEUTRAL"
    engine_row["setup_quality"] = "WEAK"
    engine_row["execution_readiness"] = "WAIT"
    engine_row["final_decision"] = "NO_EDGE"
    engine_row["confidence"] = 0
    engine_row["reason"] = "No live data — engine has not been run for this watchlist."
    engine_row["supporting_factors"] = []
    engine_row["missing_confirmations"] = []
    engine_row["risk_state"] = engine_row.get("risk_level", "MEDIUM").upper()
```

---

## Recommended Next Step

**Wire the Trade Command Center to real engine outputs (Check 6).**

Pattern to follow: iterate `get_watchlist(email)`, call `run_day_trade_scan(ticker)` / `build_swing_trade_decision(ticker)` / `run_engine(signals, ...)` per ticker, feed each result through `resolve_trade_decision()`, aggregate into the existing payload shape. Reuse the `_fetch_live_market_summary()` already in place for the market_summary section.
