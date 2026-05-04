# OptionAdvisor — Backend Architecture Reference

> Read this file at the start of any Claude session working on the backend.
> Companion graph: `backend_dependencies.dot` (render with Graphviz or paste into [https://dreampuf.github.io/GraphvizOnline/](https://dreampuf.github.io/GraphvizOnline/))

---

## Module Map (5 files)

```
analysis.py  ──────────────────────────────────────────────── leaf (no local deps)
models.py    ──────────────────────────────────────────────── leaf (pydantic only)
storage.py   ──────────────────────────────────────────────── leaf (sqlite3 only)
engine.py    ── imports from ──► analysis.py
main.py      ── imports from ──► analysis.py, engine.py, models.py, storage.py
                ── calls ext  ──► yfinance, FastAPI, smtplib
```

---

## Module Details

### `analysis.py` — 455 lines  (pure computation, no side-effects)

**Owns the core market dataclasses:**


| Class            | Key fields                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MarketSignals`  | current_price, prev_close, trend, ma20/50/200, rsi, macd, current_iv, hv_20/60, iv_rank, iv_percentile, iv_vs_hv, iv_environment, put_call_ratio, iv_skew, directional_bias, bias_confidence, volatility_regime, ext_market_price/change/change_pct/type                                          |
| `OptionLeg`      | action (BUY/SELL), option_type (CALL/PUT), strike, expiry, delta, mid_price, bid, ask, iv, oi, volume, bid_ask_spread_pct, data_quality, data_quality_reason                                                                                                                                      |
| `TradeCandidate` | strategy, bias, legs: list[OptionLeg], expiry, dte, net_credit, spread_width, max_profit, max_loss, risk_reward_ratio, breakeven_lower/upper, short_leg_delta, prob_of_profit, prob_of_max_loss, expected_value, passes_rr/liquidity/credit_filter, scores (dict), rationale, exit_plan, warnings |


**Main entry point:**

```python
generate_signals(hist: pd.DataFrame, calls: pd.DataFrame, puts: pd.DataFrame) -> MarketSignals
```

Runs: RSI, MACD, HV-20/60, IV rank/percentile, IV skew, PCR, trend (MA20/50/200 + slopes), directional bias, volatility regime.

---

### `models.py` — 200 lines  (Pydantic API I/O shapes)

All Pydantic `BaseModel` — no logic.


| Model               | Direction | Purpose                                                                                                                                                                              |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AnalyzeRequest`    | → in      | ticker, weeks_out, spread_width, strategy_mode                                                                                                                                       |
| `AnalyzeResponse`   | ← out     | ticker, company_name, sector, market_cap, signals: SignalsOut, recommendations: list[RecommendationOut], calls_chain/puts_chain: list[OptionRowOut], price_history: list[PricePoint] |
| `SignalsOut`        | ← out     | Mirror of MarketSignals + ext_market_* fields                                                                                                                                        |
| `RecommendationOut` | ← out     | Mirror of TradeCandidate + rank field                                                                                                                                                |
| `OptionLegOut`      | ← out     | Mirror of OptionLeg (data_quality included)                                                                                                                                          |
| `OptionRowOut`      | ← out     | strike, bid, ask, volume, open_interest, implied_volatility, delta, data_quality                                                                                                     |
| `ScoreBreakdown`    | ← out     | signal/structure/liquidity/iv_fit/total scores                                                                                                                                       |
| `UserDataRequest`   | → in      | watchlist: list[dict], portfolio: list[dict]                                                                                                                                         |
| `UserDataResponse`  | ← out     | email, watchlist, portfolio                                                                                                                                                          |
| `AlertItem`         | ← out     | ticker, strategy, expiry, score, max_profit, max_loss, net_credit, pop, ev, time_window, email_sent, dismissed                                                                       |


---

### `engine.py` — 1379 lines  (strategy builder + scorer)

**Imports from analysis:** `MarketSignals`, `OptionLeg`, `TradeCandidate`

**Main entry point:**

```python
run_engine(
    signals: MarketSignals,
    calls: pd.DataFrame,
    puts: pd.DataFrame,
    option_dates: list[str],
    spread_width_override: Optional[int] = None,
    weeks_out: int = 4,
    strategy_mode: str = 'all',        # 'all' | 'long_only' | 'credit_only' | 'short_or_covered'
) -> list[TradeCandidate]
```

**Strategy gates (derived from `strategy_mode`):**

```python
BUILD_LONG           = strategy_mode in ('all', 'long_only')
BUILD_SPREADS        = strategy_mode in ('all', 'credit_only')
BUILD_SHORT_COVERED  = strategy_mode in ('all', 'short_or_covered')
```

**Strategy builders (private):**

- `_build_long_call()` / `_build_long_put()`
- `_build_vertical_spread()` — Bull Call Spread, Bear Put Spread
- `_build_credit_spread()` — Bull Put Spread, Bear Call Spread
- `_build_iron_condor()`
- `_build_long_straddle()`
- `_build_short_put()` / `_build_short_call()`
- `_build_covered_call()` / `_build_covered_put()`

**Deduplication logic (in 'all' mode):**

```python
bull_spread_built = False   # set True after Bull Put Spread is added
bear_spread_built = False   # set True after Bear Call Spread is added
_suppress_bull_naked = bull_spread_built and strategy_mode == 'all'
_suppress_bear_naked = bear_spread_built and strategy_mode == 'all'
# Short Put / Covered Call/Put suppressed when bull_spread already in results
```

**Scoring functions:**

- `score_signal_alignment(signals, strategy, bias)` → 0–100
- `score_structure(candidate)` → 0–100
- `score_liquidity(legs)` → 0–100
- `score_iv_fit(signals, strategy)` → 0–100
- Total = weighted average of the four

**Key tuning constants:**

```python
TARGET_SHORT_DELTA_CREDIT = 0.30   # short leg delta target for credit spreads
TARGET_LONG_DELTA_DEBIT   = 0.40   # long leg delta target for debit spreads
TARGET_SHORT_DELTA_CONDOR = 0.15   # iron condor short legs
MIN_CREDIT_PCT_OF_WIDTH   = 0.20   # credit must be ≥20% of spread width
MIN_RISK_REWARD_RATIO     = 0.25
MAX_BID_ASK_SPREAD_PCT    = 0.15
MIN_OPEN_INTEREST         = 50
MIN_VOLUME                = 5
MIN_MID_PRICE             = 0.05
DTE_CREDIT_MIN            = 14
DTE_CREDIT_MAX            = 60
CLOSE_AT_DTE              = 21     # standard 21-DTE management trigger
```

**Helper utilities:**

- `validate_option_quote(row)` → `data_quality: str` ("OK" | "MODEL" | "STALE" | "UNRELIABLE")
- `pick_expiry_by_dte(option_dates, weeks_out)` → closest expiry to target DTE
- `find_strike_by_delta(chain_df, target_delta, option_type)` → strike
- `build_option_leg(...)` → `OptionLeg`
- `compute_ev(max_profit, max_loss, pop)` → expected value per share

---

### `storage.py` — 193 lines  (SQLite persistence)

**Database:** `users.db` (path from `DB_PATH` env var or `./users.db`)

**Tables:** `user_state` (watchlist + portfolio JSON), `user_alerts`

**Public API:**

```python
init_db()                                              # create tables if not exist
get_user_state(email)    → dict | None
save_user_state(email, watchlist, portfolio)
add_user_alert(email, alert_dict, email_sent, email_message)
update_user_alert_email(email, alert_id, email_sent, email_message)
get_user_alerts(email, retention_ms, now_ms)           → list[dict]
dismiss_user_alert(email, alert_id)
clear_user_alerts(email)
```

---

### `main.py` — 978 lines  (FastAPI orchestrator)

**Startup:** `init_db()` + starts `_alert_scan_loop` background thread.

**POST /api/analyze — core flow:**

```
AnalyzeRequest (ticker, weeks_out, spread_width, strategy_mode)
    │
    ▼
yfinance: stock.history() → hist_df (price + volume, 1y)
          stock.info      → current_price, pre/post-market, company_name, sector, market_cap
          stock.option_chain(expiry) → calls_df, puts_df
          pick_expiry_by_dte(option_dates, weeks_out) → target expiry
    │
    ▼
analysis.generate_signals(hist_df, calls_df, puts_df) → MarketSignals
    │
    ▼
engine.run_engine(MarketSignals, calls_df, puts_df, option_dates,
                  spread_width, weeks_out, strategy_mode)
    → list[TradeCandidate]  (sorted by total_score desc, top 5)
    │
    ▼
chain_to_output(calls_df/puts_df) → list[OptionRowOut]
    │
    ▼
Build AnalyzeResponse → return JSON
```

**Cache:**

- `ANALYZE_CACHE_TTL_MARKET_HOURS` = 5 min  (env, default 300 s)
- `ANALYZE_CACHE_TTL_OFF_HOURS`    = 30 min (env, default 1800 s)
- Keyed by `(ticker, weeks_out, spread_width, strategy_mode)`

**Alert scanner (`_alert_scan_loop`):**

- Runs every `ALERT_SCAN_INTERVAL_SECONDS` (default 900 s / 15 min)
- Market hours only by default (`ALERT_SCAN_MARKET_HOURS_ONLY=true`)
- For each user with a watchlist: re-analyzes each ticker, checks `_backend_verdict_is_go()`, fires email via `send_alert()` if new GO signal found
- Sends HTML email via SMTP (configured via `.env`: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, FROM_NAME)

**API routes summary:**

```
GET  /                           Health check → {"status": "ok"}
POST /api/analyze                Main analysis (cached)
GET  /api/user-data/{email}      Load watchlist + portfolio from SQLite
PUT  /api/user-data/{email}      Save watchlist + portfolio to SQLite
GET  /api/alerts/{email}         List alerts for user (last 24h)
POST /api/alerts/dismiss         Mark alert dismissed
POST /api/alerts/clear           Delete all alerts for user
POST /api/alerts/scan/{email}    Force immediate watchlist scan for one user
POST /api/send-alert             Send alert email batch (called by scanner)
POST /api/test-email             Send a test email to verify SMTP config
GET  /api/email-status           Returns SMTP config status (masked)
```

---

## Dependency Graph (text)

```
                      ┌─────────────┐
                      │  Frontend   │
                      │ (React/TS)  │
                      └──────┬──────┘
                             │ HTTP POST /api/analyze etc.
                             ▼
                      ┌─────────────┐   ◄── yfinance (market data)
                      │   main.py   │   ◄── FastAPI + CORS
                      │  978 lines  │   ◄── smtplib (alert emails)
                      └──┬──┬──┬───┘
          ┌──────────────┘  │  └───────────────┐
          ▼                 ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  analysis.py │  │   engine.py  │  │  storage.py  │
  │   455 lines  │◄─┤  1379 lines  │  │  193 lines   │
  │              │  │              │  │              │
  │ MarketSignals│  │  run_engine()│  │  SQLite CRUD │
  │ OptionLeg    │  │  12 strategy │  │  user_state  │
  │ TradeCandidate  │  builders    │  │  user_alerts │
  └──────────────┘  └──────────────┘  └──────────────┘
          ▲                                    │
          │                                    ▼
  ┌──────────────┐                     ┌──────────────┐
  │   models.py  │                     │   users.db   │
  │   200 lines  │                     │   (SQLite)   │
  │  Pydantic IO │                     └──────────────┘
  └──────────────┘
```

---

## Quick-Reference: Where to make changes


| Task                          | File(s) to edit                                                              |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Add a new option strategy     | `engine.py` — add `_build_*()` function, call inside `run_engine()`          |
| Change scoring weights        | `engine.py` — `score_signal_alignment/structure/liquidity/iv_fit`            |
| Add a new signal / indicator  | `analysis.py` — add to `MarketSignals` dataclass + `generate_signals()`      |
| Expose new signal to frontend | `analysis.py` + `models.py` (`SignalsOut`) + `main.py` (map field)           |
| Add a new API endpoint        | `main.py`                                                                    |
| Change request/response shape | `models.py` (Pydantic) + `main.py` (wire up) + `frontend/src/types/index.ts` |
| Change alert logic            | `main.py` — `_backend_verdict_is_go()`, `_scan_user_watchlist_for_alerts()`  |
| Change data persistence       | `storage.py`                                                                 |
| Tune filter thresholds        | `engine.py` — constants at top of file                                       |
| Add pre/post-market data      | `main.py` — yfinance `stock.info` block + `models.py` `SignalsOut`           |


---

*Last updated: 2026-05-02 — reflects backend as of session covering data quality, strategy deduplication, extended hours price, and alert scanner.*