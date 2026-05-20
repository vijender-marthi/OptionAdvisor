# OptionAdvisor — Session Prompt (v1.35, May 2026)

Use this prompt at the start of a new Claude Code session to restore full context.

---

## Project

**OptionAdvisor** — full-stack options day trading platform.

```
/Users/vijender/Development/OptionAdvisor/
├── backend/          Python (FastAPI) — trading engines, AI coach, storage
│   ├── main.py       API routes, background scanners
│   ├── day_trade.py  Intraday scoring engine (1-min bars)
│   ├── swing_trade.py Multi-day swing engine (daily bars)
│   ├── ai_coach.py   Confluence Zone AI Coach (Anthropic → OpenAI → deterministic)
│   └── storage.py    SQLite persistence layer
└── frontend/         React + TypeScript (Vite)
    └── src/
        ├── api/client.ts              Type definitions + API client
        ├── components/
        │   ├── DayTradeEnginePanel.tsx  Main day trade UI
        │   ├── SwingTradeEnginePanel.tsx
        │   └── Sidebar.tsx
        └── pages/
            ├── DayTradePage.tsx
            ├── SwingTradePage.tsx
            ├── ActiveTradesPage.tsx     Track Intraday (/active-trades)
            ├── AlertCenter.tsx
            └── HelpPage.tsx
```

**Stack:** Python 3.12 · FastAPI · SQLite · React 18 · TypeScript · Tailwind CSS · Recharts · lucide-react

**Commit style:** `v1.XX.Y: short description` — always commit with pre-commit hook (runs engine regression + TS typecheck + Vite build + backend syntax check).

---

## Current state — master branch at v1.35.2

### Day Trade Engine (`backend/day_trade.py`)

**Scoring signals (bull/bear):**
- VWAP position ±2.0, VWAP slope ±0.5
- OR breakout: confirmed +3.0, unconfirmed +1.0
- Momentum (adaptive window) ±1.5
- Volume spike (≥1.55× median baseline) ±1.5
- RS vs QQQ ±1.0
- SPY session ±0.5
- VIX caution (≥30) −0.5, VIX NO-GO (≥40) → NO-GO veto
- OR width (narrow coiling +0.5, wide −0.25)
- RVOL tiers (≥2.5× +1.0, ≥1.5× +0.5)
- Dual VWAP slope (micro 15-bar + macro 60-bar)
- Secondary breakout (2nd OR crossing +1.0)
- HH/HL price structure ±0.75
- Pre-market gap ±0.5 with gap-fill reversal

**Verdict thresholds:** GO_THRESHOLD=4.5, MARGIN_GO=2.75, STRONG_BULL=7.0, STRONG_DIFF=4.0

**NO-GO vetoes (compound conditions):**
1. VIX ≥ 40
2. Bull bias + SPY ≤ −1.2% OR QQQ ≤ −1.2%
3. Bear bias + SPY ≥ +1.2% OR QQQ ≥ +1.2%
4. **False-positive veto (v1.34.5):** diff > 0 + or_historical="contained" + RVOL < 0.75 + SPY & QQQ both ≤ −0.25% → NO-GO (CALL trigger never fired)
5. Mirror for bear side: diff < 0 + contained + RVOL < 0.75 + market bullish → NO-GO

**Bounce-rejection tiers (v1.34.9) — `bounce_scenario` metric:**

After ORL breakdown (`or_historical="broke_down"`, `or_state="below"`):

| `bounce_scenario` | Condition | Bear score | Entry | Stop | Target |
|---|---|---|---|---|---|
| `vwap_rejection` | Within ±0.45% of VWAP + >0.55% below ORL + vol_spike | +1.2 | near VWAP | VWAP × 1.002 | ORL |
| `orl_rejection_retest` | Within 0.55% of ORL + >0.3% below VWAP | +0.8 | near ORL | ORL × 1.002 | below day low |
| `no_mans_land` | >0.55% below ORL AND >0.45% below VWAP | none | WAIT_BOUNCE_LEVEL | — | — |
| `vwap_test` | Within ±0.45% of VWAP, no vol_spike | none | VWAP_TEST state | — | — |

**Key insight:** VWAP rejection scores higher (+1.2) than ORL retest (+0.8) because sellers stepping in before ORL = heavier selling pressure.

**`build_day_entry_guidance()`:** ENTRY_ACTIVE for shorts now produces bounce-scenario-specific summary/action/avoid/entry_decision. `risk_below` and `scalp_target` adjusted per tier.

**`_confidence_block()` volume label (v1.35.2):** 4-tier using RVOL — `STRONG` (vol_spike or rvol ≥ 2.0), `ELEVATED` (rvol ≥ 1.25), `NORMAL` (rvol ≥ 0.75), `WEAK` (< 0.75). Previously was binary STRONG/WEAK based only on last-bar vol_spike (1.55× median), causing 1.1–1.4× RVOL to falsely show WEAK. Risk label also updated: MEDIUM only when volume_confirmation == "WEAK" (not just vol_spike absent).

**Metrics output includes:** `or_state`, `or_historical`, `bounce_scenario`, `rvol`, `vwap`, `or_high`, `or_low`, `session_phase`, `volume_spike`, `chart_bars`, `session_date`

---

### Key-Level Price Alerts (`backend/main.py`)

**`_detect_day_trade_level_alert(t, r, session_date)`** — fires for 3 level types:
- ORL retest from below: `or_historical="broke_down"` + `or_state="below"` + price within 0.4% of ORL
- ORH retest from above: `or_historical="broke_up"` + `or_state="above"` + price within 0.4% of ORH
- VWAP test: price within 0.2% of VWAP + RVOL ≥ 1.2×

**`_scan_user_day_trade_watchlist()`:**
- Fires `alert_center_create()` with `signal="LEVEL_RETEST"` when `new_level_key != prev_level_key`
- Deduplication: `level_alert_key` stored in `day_trade_watchlist_last` table — fires at most once per session per ticker
- After watchlist loop: also scans open active-trade tickers from `list_active_trades_open_opened_today_et()` (skips duplicates already in watchlist)

**`storage.py`:** `day_trade_watchlist_last` table has `level_alert_key TEXT DEFAULT ''`. `get_day_trade_watchlist_last()` returns it; `upsert_day_trade_watchlist_last()` accepts it as a kwarg.

---

### AI Coach (`backend/ai_coach.py`)

**Pipeline:** `build_coach_signal()` → cache check → Anthropic → OpenAI → `build_deterministic_coach()` → cache (15 min TTL)

**Strategy: Confluence Zone Trading (v1.35.0)**

Confluence zone = any 2+ key levels (VWAP, ORL, ORH) within **$0.10** of each other.

| Strength | Condition |
|---|---|
| EXTREME | 3+ levels within $0.10, OR specifically VWAP+ORL within $0.10 |
| STRONG | Any 2 levels within $0.10 |
| NONE | No levels converge |

Zone role: price below = RESISTANCE (PUT), above = SUPPORT (CALL), at = CHOP (no trade)

**Entry gate — all 3 required:**
1. Price within $0.50 of zone
2. Rejection candle (PUT) or Bounce candle (CALL)
3. RVOL > 1.2× (< 0.8× = no trade, 0.8–1.2× = watch, > 1.5× = high conviction)

**No-trade conditions (any blocks entry):**
- Daily range used > 60%
- RVOL < 0.8×
- Price in chop zone
- No confluence detected
- R/R < 1:2
- Price > $2 from zone

**Signal dict includes:** `rvol`, `price_vs_orl`, `price_vs_orh`, `session_phase`, `daily_range_used_pct`, `option_expiry_days`, `_bounce_scenario`, `_scalp_target`, `_risk_below`

**Output fields (new, additive):**
```json
{
  "confluence":      { "detected", "zone_price", "levels_converging", "strength", "zone_role" },
  "entry_gate":      { "valid", "trigger_price", "trigger_condition", "rvol_required", "candle_required" },
  "trade":           { "direction", "entry_price", "target", "stop", "risk_reward", "r_r_valid" },
  "no_trade_reason": "string | null",
  "confluence_note": "≤20 word description"
}
```

**Confidence adjustments:** +8 when confluence detected + entry gate valid; +10 SPY aligns; −15 SPY conflicts.

**Options tier:** confidence > 80 = naked ok; 60–80 = spread preferred; < 60 = watch only.

**Bounce scenario in coach (v1.34.9):** `_bounce_scenario` drives summary, entry_condition, invalidation, state labels, decision tree, and best_next_step for all 4 tiers.

**`_VALID_ACTIONS`:** `{"WATCH", "ENTER", "EXIT", "HOLD", "AVOID"}`

---

### Frontend — Key Components

**`DayTradeEnginePanel.tsx`:**
- Volume chart: bars scale to own max (avgRef excluded from max — v1.34.8 fix); cyan = above avg, gray = below avg
- AI Coach section displays: confluence amber card (EXTREME/STRONG badge, zone role/price, entry gate ✓/○), 4-col trade grid (Entry/Target/Stop/R:R), no_trade_reason warning strip
- `avgVolForTimeOfDay` = `lastBar.v / rvol` (derived from RVOL)

**`AlertCenter.tsx`:** All timestamps rendered in `America/New_York` timezone + " ET"

**`Sidebar.tsx`:**
- `active-trades` ("Track Intraday") nav item after day-trade
- `auto-trade` ("Alpaca Trade") nav item — admin only (in `ADMIN_ONLY` set filtered by `canAccessPage`)

**`SwingTradePage.tsx`:** "Save to Journal" button (replaced "Add to Watchlist") — calls `createTradeIdea()` with pre-filled fields from scan result

**`paths.ts`:** `/active-trades` route mapped to `active-trades` page key

**`client.ts`:** `AiCoachResult` includes optional `confluence`, `entry_gate`, `trade`, `no_trade_reason`, `confluence_note` fields; `AiCoachAction` includes `'AVOID'`

---

### Storage (`backend/storage.py`)

**`day_trade_watchlist_last` table:**
```sql
CREATE TABLE day_trade_watchlist_last (
  email TEXT, ticker TEXT, verdict TEXT, session_date TEXT,
  updated_at INTEGER, level_alert_key TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (email, ticker)
)
```
Migration: `_migrate_day_trade_watchlist_last()` runs at startup via `_init_db()`.

**Key functions:**
- `get_day_trade_watchlist_last(email, ticker)` → returns `{verdict, session_date, updated_at, level_alert_key}`
- `upsert_day_trade_watchlist_last(email, ticker, verdict, session_date, level_alert_key="")` → upserts all fields
- `alert_center_create(email, *, alert_group, severity, engine, signal, title, body, meta)` → creates in-app alert
- `list_active_trades_open_opened_today_et(email)` → open active trades opened today ET

---

### Help Page (`frontend/src/pages/HelpPage.tsx`)

Day Trade section contains (in order):
1. Overview & Verdict Scale
2. Step 1: Data Fetch
3. Step 2: Indicators (VWAP, VWAP Slope, OR, Momentum, Volume Spike)
4. Step 3: Scoring table
5. Step 4: Verdict Logic (thresholds + vetoes)
6. Step 5: Worked Example (NVDA)
7. 4-State Trading System
8. STATE 3 Walkthrough (AMD Long)
9. **Signal Improvements (13 additions)**
10. **Bounce-Rejection Entry Tiers** ← new v1.34.9
11. **Key-Level Price Alerts** ← new v1.34.7
12. **Volume Chart — avg vol for time of day** ← new v1.34.8
13. **Confluence Zone Trading — AI Coach Strategy** ← new v1.35.0
14. Best Exit Windows

---

## Pending / Known Issues

- **Rename "Alpaca Trade"** nav label: user was shown options (Auto Trade, Trade Bot, Live Execution, Active Trading) — awaiting decision
- **Engine bug backlog** (pre-existing, tracked in todo list):
  - `day_trade.py`: DT-7 bias UnboundLocalError, DT-3 _swing_structure scope, DT-2 MIDDAY phase, DT-5 gap-fill penalty, DT-9 exit rules conflict
  - `swing_trade.py`: ST-1 MA convergence inverted, ST-7 datetime TypeError, ST-2 false MACD, ST-4 extension flag, ST-5 WATCH+AVOID_CHASE, ST-6 VIX threshold, ST-10 assert crash
  - `engine.py`: EN-4 iron condor, EN-2 debit spread PoP, EN-1 debit RR filter, EN-6 chain all expiries
  - `score_normalizer.py`: SN-2 VIX cliff, SN-3 dead pullback, XE-1 risk band

---

## Conventions

- **Commit format:** `v1.XX.Y: description` — always `git add <specific files>` then commit (pre-commit hook validates)
- **No push unless asked** — user confirms push separately
- **Admin-only pages:** add to `ADMIN_ONLY` set in `Sidebar.tsx` + `canAccessPage` filter
- **Alert timestamps:** always `America/New_York` timezone + " ET"
- **Engine bias:** `"long"` / `"short"` in backend; normalized to `"bullish"` / `"bearish"` in AI Coach signal
- **Bounce scenario detection:** runs in scoring phase, stored in `metrics["bounce_scenario"]`, flows through entry_guidance and AI Coach automatically
- **Confluence detection:** `_detect_confluence_zone(price, vwap, orh, orl, band=0.10)` in `ai_coach.py`
