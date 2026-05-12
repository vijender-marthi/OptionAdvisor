# Day Trade Engine Evaluation — vs. Swing Trade & Regular Trade
**Date**: 2026-05-12  
**Files reviewed**: `day_trade.py`, `swing_trade.py`, `engine.py`, `trader_decision.py`, `analysis.py`

---

## 1. Architecture Snapshot

All three engines share the same **verdict vocabulary** (`STRONG GO / GO / WATCH / WAIT / NO-GO`) and route through bar_cache for data, but they operate on fundamentally different timeframes and use separate indicator stacks.

| Dimension | Day Trade | Swing Trade | Regular Trade |
|---|---|---|---|
| **Timeframe** | 1-minute intraday | Daily candles (6 months) | Daily candles + options chain |
| **Primary file** | `day_trade.py` | `swing_trade.py` | `engine.py` |
| **Signal inputs** | VWAP, OR breakout, vol spike, momentum, RS/QQQ, SPY/QQQ session, VIX | MA20/MA50, RSI, MACD, vol pattern, SPY+QQQ daily bias, VIX | MarketSignals (from `analysis.py`) + live options chain |
| **Scoring model** | Bull/Bear accumulation (float points) | Bull/Bear accumulation + two-layer Decision Quality | 4-dimensional scoring: signal (0–40), structure (0–30), liquidity (0–20), IV fit (0–10) |
| **Output** | `DayTradeScan` + `trader_decision` dict | `SwingTradeScan` + `swing_trade_decision` dict | `TradeCandidate` list ranked by composite score |
| **Options awareness** | None (by design) | Partial (IV rank, earnings, strategy hints) | Full (strike selection, EV, Kelly, exit plan) |
| **VIX gate** | NO-GO at 40 | NO-GO at 35 | Penalizes via `MarketSignals.iv_environment` |
| **Cache TTL** | 90s market / 600s off-hours | 90s market / 600s off-hours (+ 5-min mkt context) | No cache (runs on-demand) |

---

## 2. Day Trade Engine — Deep Evaluation

### 2a. Scoring Logic

The day-trade engine builds `bull` and `bear` float scores from five independent signals:

```
VWAP position          →  +2.0 to winning side
OR breakout/breakdown  →  +3.0 to winning side
Short-horizon momentum →  +1.5 if |mom| > 0.08%
Volume spike           →  +1.5 to dominant side
RS vs QQQ              →  +1.0 to winning side
SPY day change         →  +0.5 to winning side
VIX caution penalty    →  -0.5 both sides (clamp ≥ 0)
```

**Verdict thresholds**:
- `GO_THRESHOLD = 4.5` — dominant side must reach this
- `MARGIN_GO = 2.75` — diff between bull and bear must exceed this
- `STRONG_BULL = 7.0` and `STRONG_DIFF = 4.0` for STRONG GO

Maximum achievable bull score (all signals firing): 2 + 3 + 1.5 + 1.5 + 1.0 + 0.5 = **9.5**.

### 2b. Strengths

1. **Counter-trend vetoes are well-designed** — SPY/QQQ ≥ ±1.2% creates a hard NO-GO against the bias direction, preventing painful fade setups.
2. **Volume baseline is correct** — using mid-session (post-OR, excluding last bar) avoids the open-auction inflation that would make the first-15-min mean too high to ever spike against.
3. **Market context is bidirectional** — RS vs QQQ scores long and short setups equally, not just bullish.
4. **`trader_decision` layer separates tape state from score arithmetic** — the `STRONG_RELATIVE_STRENGTH / WEAK_BREAKDOWN_WATCH` states give the UI a clean categorical signal independent of the raw float scores.
5. **Confidence block** (`_confidence_block`) provides structured metadata (trend strength, breakout quality, volume confirmation, market alignment, risk) without polluting the core scoring logic.

### 2c. Weaknesses & Issues

#### ISSUE-D1 (Medium): Opening-range breakout scores wick-through and sustained breakout identically
A single 1-minute candle that pokes above OR-high by $0.01 before reversing earns the same **+3.0** as a stock that has been cleanly above OR-high for 45 minutes. This is the single largest scoring block — 3 out of a maximum ~9.5.

**Suggested fix**: Replace the binary `or_state` check with a *sustained* check. Count the number of the last N bars that are above OR-high (or below OR-low) and scale the award:
```python
# Fraction of last OR_MINUTES bars above OR-high
sustained_bars = (session.iloc[n_or:]["Close"] > or_high).sum()
total_post_or  = max(len(session) - n_or, 1)
sustained_frac = sustained_bars / total_post_or

if or_state == "above":
    bull += 1.5 + (1.5 * sustained_frac)   # 1.5 min … 3.0 max
elif or_state == "below":
    bear += 1.5 + (1.5 * sustained_frac)
```

#### ISSUE-D2 (Low): VIX penalty kills both sides and can orphan close-score setups
When VIX ≥ 30, both `bull` and `bear` are decremented by 0.5. In a scenario where `bull = 5.0` and `bear = 2.5`, the post-penalty state is `4.5 / 2.0`. The diff is still 2.5 — just below `MARGIN_GO = 2.75`. The result is WAIT, despite a clear bull signal. The VIX penalty is already signalled in the `confidence_block` risk field, so punishing the scores directly is double-counting.

**Suggested fix**: Remove the score penalty. Keep only the VIX NO-GO gate (≥ 40) and the `confidence_block.risk = "HIGH"` flag. VIX caution messaging already flows through `_confidence_block` at VIX ≥ 22.

#### ISSUE-D3 (Low): MARGIN_GO threshold is asymmetric with realistic score ranges
With max bull ≈ 9.5, a diff of 2.75 is easy to achieve whenever one side hits 4.5+. But with VIX penalties active, a tight setup (say bull = 4.7, bear = 2.1, diff = 2.6) is silently declined with a generic "scores too close" reason. The user has no visibility into how close to the threshold the scan was.

**Suggested fix**: Add a `score_gap` field to `DayTradeScan.metrics` that exposes `abs(diff)` and the remaining distance to `MARGIN_GO`. The UI can use this to show "Edge: 2.6 / need 2.75 — very close."

#### ISSUE-D4 (Low): `trader_decision` precedence ordering has a gap
In `build_trader_decision`, the condition `sp <= -4.0` (VERY_WEAK_EXTENDED) is evaluated before `sp > 0 and qqq_s < 0` (RELATIVE_STRENGTH), which is fine. But the case `sp < 0 and not below_vwap` (i.e., slightly negative session return but price still above VWAP) falls through to `NEUTRAL_WEAK` or `NO_TRADE_WAIT` even when `bull_score` is strong. A stock down −0.5% session but above VWAP with bull = 7.0 gets a NO_TRADE label.

**Suggested fix**: Add a `bull_score >= 5.0 and above_vwap` short-circuit before the `NEUTRAL_WEAK` branch that returns `LONG_CONFIRMATION_WATCH` regardless of session %.

---

## 3. Swing Trade Engine — Comparison

### 3a. What swing does better than day trade

- **Two-layer output**: the raw verdict (STRONG GO → NO-GO) is clearly separated from the `build_swing_trade_decision` decision quality layer, which adds entry quality, risk flags, extension checks, and a suggested strategy. The day trade engine collapses everything into `verdict` + `trader_decision` but they can still contradict each other (a GO verdict can coexist with a AVOID_CALLS trader_state).
- **Earnings and IV-rank awareness**: swing explicitly penalises scores when earnings are within 2–5 days and when IV rank is ≥ 70. The day trade engine is entirely unaware of upcoming catalysts.
- **Extension detection is quantified**: swing checks `mom_5d_pct`, `dist_ma20_pct`, and RSI against named thresholds and demotes entries to WAIT_PULLBACK or AVOID_CHASE. Day trade has no extension detection (a stock up +8% on the session that just broke OR-high still scores a STRONG GO).
- **Market context is daily and persistent**: `_get_market_bias_raw("SPY")` / `_get_market_bias_raw("QQQ")` use a 5-minute TTL cache and classify the broad market using the same MA/RSI/MACD stack used for individual tickers — providing a structurally consistent benchmark.

### 3b. Weaknesses in swing (for reference)

**ISSUE-S1 (Medium)**: `option_liquidity_score` is always passed as `None` at the call site (line 1361 of `swing_trade.py`). The entire `LOW_OPTION_LIQUIDITY` branch in `build_swing_trade_decision` is dead code. Illiquid tickers can receive a GO or STRONG GO verdict and a LONG_CALL suggestion when no liquid options actually exist.

**ISSUE-S2 (Low)**: Market context penalty is asymmetric: `MARKET_WEAK` penalises bulls by −2.0 but only penalises bears by −1.0 when the market is `MARKET_SUPPORTIVE`. This creates a systematic bearish bias in mixed-market conditions.

**ISSUE-S3 (Low)**: The raw verdict (`STRONG GO`) and the decision layer output (`AVOID_CHASE`) can contradict each other. A user viewing the card could see STRONG GO in the badge while the decision message says "Avoid chasing entries." These should be reconciled — if the decision layer overrides to AVOID_CHASE, the verdict displayed should be demoted to WATCH or NO-GO.

---

## 4. Regular Trade Engine — Comparison

### 4a. What regular does better than both

- **Full Black-Scholes EV for long options**: uses `expected_option_payoff` with the lognormal integral — not a binary win/loss estimate. This is the only engine that produces a theoretically grounded expected value.
- **Credit spread distributional EV**: `compute_bs_ev_credit_spread` models the full payoff curve, not just breakeven probability × max-profit. Debit spreads are the exception (see issue below).
- **4-dimensional composite score**: signal fit (0–40), structure quality (0–30), liquidity (0–20), and IV environment fit (0–10) allows a balanced 100-point trade score that captures aspects the other engines ignore.
- **Kelly sizing**: `compute_kelly_metrics` with a half-Kelly cap at 20% is the only position-sizing guidance in the system.
- **Data quality detection**: `validate_option_quote` catches STALE (bid=ask=0) and UNRELIABLE (mid below intrinsic) quotes and rejects those legs from scoring.

### 4b. Issues in regular trade engine

**ISSUE-R1 (Medium)**: `_build_long_call` (line 771) and `_build_long_put` (line 825) still use `cost * 10` as a fallback for `realistic_max_profit` when the 3σ move estimate (`expected_stock_move`) is lower. This means a $2.00 long call always shows max profit ≥ $20.00. The `expected_stock_move` function already computes `price × (IV × √(DTE/365) × 3.0)` — the 10× fallback should be removed entirely. **Already flagged in existing audit as P0.**

**ISSUE-R2 (Medium)**: Debit spreads (`_build_vertical_spread`) use `compute_ev(max_profit, max_loss, rop)` — the plain binary EV function. Credit spreads use `compute_bs_ev_credit_spread`, which properly models the intermediate payoff region. This means the two directionally symmetric strategies (Bull Call Spread vs. Bull Put Spread) are scored with fundamentally different EV models, creating a systematic preference for credit spreads even when debit spreads are structurally superior.

**ISSUE-R3 (Low)**: The annualised drift for bullish setups is +0.15 and for bearish setups is −0.10. This 50% asymmetry inflates call EVs and deflates put EVs by different magnitudes. There is no documented rationale for the asymmetry. Making it ±0.15 (or ±0.12) would be neutral.

**ISSUE-R4 (Low)**: The single boolean `_suppress_bull_naked` flag suppresses Covered Call, Covered Put, AND Short Put together when a Bull Put Spread is built. A user who owns 100 shares of a stock and is looking for a Covered Call will not see one if a Bull Put Spread was constructed. These should be separated: Short Put should be suppressed by Bull Put Spread, but Covered Call requires an independent `has_stock_position` flag.

---

## 5. Cross-Engine Consistency Gaps

### 5a. VIX thresholds diverge
- Day trade: NO-GO at VIX ≥ **40**, caution at ≥ 30
- Swing trade: NO-GO at VIX ≥ **35**, caution at ≥ 25
- Regular trade: No explicit VIX gate — IV rank proxy only

A user running all three engines simultaneously during a VIX = 37 environment will see Day Trade → allowed (below 40), Swing Trade → NO-GO, Regular Trade → elevated cost warning. This inconsistency is confusing.

**Suggested fix**: Align day-trade NO-GO to **35** (matching swing), or at minimum expose the gap in the UI with a note like "Swing: NO-GO | Day: CAUTION (VIX 37)."

### 5b. Scoring thresholds are not comparable
- Day trade: GO at bull ≥ 4.5, max possible ~9.5
- Swing trade: GO at bull ≥ 5.5, max possible ~12–13
- Regular trade: composite 0–100 score

These are internally consistent but the same badge ("STRONG GO") can mean very different things depending on which engine produced it. The metrics dict already includes `bull_score` and `bear_score` for both day and swing, which partially addresses this, but the verdict labels imply comparability they don't have.

### 5c. No day-trade catalyst awareness
The day-trade engine has no awareness of scheduled events (earnings, FOMC, CPI). A ticker with earnings after the close will score the same as any other. The swing engine flags `EARNINGS_IMMINENT` and demotes the score — the same check could be wired into `run_day_trade_scan` using the existing Yahoo `info` dict which already contains `earningsDate` data.

---

## 6. Suggested Changes — Prioritised

### P0 — Fix immediately (bugs affecting output quality)

**[1] Replace `cost * 10` with IV-based max profit in long option builders** (`engine.py:771, 825`)

```python
# Replace:
realistic_max_profit = round(max(approx_intrinsic, cost * 2.0), 2)  # still uses 2x floor
# The 10x fallback (now removed) was the main issue:
#   realistic_max_profit = max(approx_intrinsic, cost * 10)  ← DELETE

# The current code (post-fix) already calls expected_stock_move and uses approx_intrinsic.
# Verify that cost * 2.0 floor is only a backstop for deep OTM cases, not the primary value.
# If approx_intrinsic is consistently 0 (strike too far OTM), the IV-based move should drive it.
```

**[2] Activate the dead `option_liquidity_score` path in swing trade** (`swing_trade.py:1361`)

Wire in a real liquidity check before calling `build_swing_trade_decision`. At minimum, pull the ATM option chain for the nearest monthly expiry and check OI + bid-ask spread of the ATM call and put. A score below 4 should invoke the existing `LOW_OPTION_LIQUIDITY` block that already exists but is never triggered.

### P1 — Fix soon (accuracy / consistency)

**[3] Replace binary EV in `_build_vertical_spread` with distributional EV** (`engine.py:908`)

Add a `compute_bs_ev_debit_spread` function (symmetric to the existing credit spread version) and call it instead of `compute_ev`:

```python
def compute_bs_ev_debit_spread(
    current_price, long_strike, short_strike,
    long_iv_pct, short_iv_pct, expiry,
    net_debit, option_type,
    directional_bias, bias_confidence,
) -> float:
    mu = directional_drift(directional_bias, bias_confidence)
    long_payoff  = expected_option_payoff(current_price, long_strike,  long_iv_pct,  expiry, option_type, mu)
    short_payoff = expected_option_payoff(current_price, short_strike, short_iv_pct, expiry, option_type, mu)
    # Debit spread profit = long payoff - short payoff - net_debit
    return round(long_payoff - short_payoff - net_debit, 4)
```

**[4] Align VIX NO-GO thresholds** (`day_trade.py:VIX_NO_GO = 40`)

Change `VIX_NO_GO` in `day_trade.py` from 40 to 35 to match swing trade. Update `VIX_CAUTION` from 30 to 25 to match. This eliminates the confusing divergence where day-trade allows new positions that swing already blocked.

**[5] Make drift symmetric** (`engine.py:435`)

```python
# Change:
if directional_bias in ("Bearish", "Mildly Bearish"):
    return -0.10 * confidence
# To:
if directional_bias in ("Bearish", "Mildly Bearish"):
    return -0.15 * confidence
```

**[6] Reconcile swing verdict vs. decision-layer contradiction** (`swing_trade.py`)

When `final_action` is `AVOID_CHASE` or `NO_TRADE`, demote the `verdict` field in `SwingTradeScan` to at most `WATCH` before returning. The raw verdict should never be STRONG GO when the decision layer says avoid:

```python
# In run_swing_trade_scan(), after build_swing_trade_decision() returns:
if decision["final_action"] in ("AVOID_CHASE", "NO_TRADE"):
    if verdict == "STRONG GO":
        verdict = "WATCH"
    elif verdict == "GO":
        verdict = "WATCH"
```

### P2 — Quality improvements (explanations and UX)

**[7] Add sustained-breakout scoring to opening range** (`day_trade.py`)

Replace the binary OR state (+3.0 flat) with a score that scales with how many post-OR bars have stayed above the high (see ISSUE-D1 above). Preserve the minimum floor (1.5) so marginal breakouts still count.

**[8] Add `score_gap` to day-trade metrics** (`day_trade.py`)

```python
metrics["score_gap_to_go"]    = round(abs(diff) - MARGIN_GO, 3)   # negative = below threshold
metrics["score_gap_to_strong"] = round(abs(diff) - STRONG_DIFF, 3)
```
Surfaces how close (or far) the scan is from verdict upgrade — useful for the UI and for debugging.

**[9] Add intraday session extension check to day trade** (`day_trade.py`)

Before returning the scan, check `session_change_pct` against thresholds similar to swing's `EXT_5D_WARN`. If the stock is already up +5% on the session and OR-high is far below current price, the breakout score overstates the edge. Add a `session_extended` flag to `metrics` and reduce OR breakout contribution by half when this is true.

**[10] Wire earnings-awareness into day trade** (`day_trade.py`)

The `info` dict is already fetched at the top of `run_day_trade_scan`. Add:

```python
# After info fetch:
earnings_ts = info.get("earningsDate") or info.get("earningsTimestamp")
earnings_today = False
if earnings_ts:
    try:
        earnings_dt = pd.Timestamp(earnings_ts, unit="s", tz="America/New_York")
        delta_days = abs((earnings_dt.date() - pd.Timestamp.now(tz=ET).date()).days)
        earnings_today = delta_days <= 1
    except Exception:
        pass

if earnings_today:
    body.append("Earnings today — IV crush / gap risk; day-trade size down significantly.")
    metrics["earnings_today"] = True
```

**[11] Fix Covered Call suppression** (`engine.py`)

Separate the Short Put suppression from the Covered Call suppression. Use two independent booleans: `_has_credit_spread` (suppresses Short Put to avoid double-counting defined vs. undefined risk) and `_has_stock_position` (currently not implemented; only enable Covered Call when this is True or when explicitly requested).

**[12] Document credit filter threshold rationale** (`engine.py`)

```python
# Current undocumented thresholds:
MIN_CREDIT_PCT_OF_WIDTH = 25.0    # Spreads collect ≥ 25% of width
# Covered Call yield check: 0.80% of stock price
# Covered Put yield check: 0.60% of stock price
# Short Put yield: 0.50% of stock price
#
# Add a comment block explaining the rationale for each:
# 25% is an industry standard for defined-risk spreads (keeps max-profit ≥ 3× net loss).
# The covered/short thresholds are monthly income targets (~0.5–0.8% per month = ~6–10% annualised).
```

---

## 7. Summary Table

| # | Engine | Type | Severity | Description | Effort |
|---|---|---|---|---|---|
| 1 | Regular | Bug | P0 | `cost * 10` max profit distorts long option EV | 1–2h |
| 2 | Swing | Bug | P0 | `option_liquidity_score` always None → dead code | 2–3h |
| 3 | Regular | Accuracy | P1 | Debit spreads use binary EV vs. distributional for credits | 2–4h |
| 4 | Day+Swing | Consistency | P1 | VIX NO-GO mismatch (40 vs. 35) | 30m |
| 5 | Regular | Accuracy | P1 | Drift asymmetry: bearish −0.10 vs. bullish +0.15 | 30m |
| 6 | Swing | Inconsistency | P1 | Verdict can be STRONG GO while decision says AVOID | 1h |
| 7 | Day | Accuracy | P2 | OR breakout wick-through = same score as sustained breakout | 2h |
| 8 | Day | UX | P2 | Add `score_gap` metrics for verdict transparency | 30m |
| 9 | Day | Accuracy | P2 | No session-extension check (stock +8% still scores STRONG GO) | 1h |
| 10 | Day | Coverage | P2 | No earnings-today awareness | 1h |
| 11 | Regular | Logic | P2 | Covered Call suppressed by Bull Put Spread (wrong flag) | 1h |
| 12 | Regular | Docs | P2 | Credit filter thresholds undocumented | 30m |

---

## 8. What NOT to Change

The following constants are calibrated and should not be altered without backtesting evidence:

- Day trade scoring thresholds: `GO_THRESHOLD=4.5`, `MARGIN_GO=2.75`, `STRONG_BULL=7.0`, `STRONG_DIFF=4.0`
- Swing trade thresholds: `GO_THRESHOLD=5.5`, `MARGIN_GO=3.0`, `STRONG_THRESHOLD=8.0`, `STRONG_DIFF=4.0`
- Kelly cap: `HALF_KELLY_CAP=0.20`
- Strike delta targets: `(0.20, 0.32)` short credit, `(0.40, 0.55)` long debit
- OR window: `OR_MINUTES=15`
- Swing minimum bars: `MIN_BARS=60` (MA50 requires ~3 months)
- Credit spread DTE window: 21–50 DTE
- Volume spike ratio: `VOL_SPIKE_RATIO=1.55`
