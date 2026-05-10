# Engine Architecture & Strategy Audit Report

**Date**: 2026-05-10
**Scope**: `day_trade.py`, `swing_trade.py`, `engine.py`, `trade_aggregator.py`, `decision_resolver/`, `analysis.py`, `trader_decision.py`
**Tests**: 75/75 passing

---

## 1. ENGINE ARCHITECTURE REVIEW

### Day Trade Engine (`day_trade.py`) — 707 lines

**Pipeline**: Yahoo 1m bars → VWAP + Opening Range + volume spike + momentum → bull/bear point scoring → verdict (STRONG GO/GO/WATCH/WAIT/NO-GO) → trader_decision.py state layer → _resolve_day_trade() final decision

**Strengths**:
- Clean, single-purpose: intraday directional bias only
- Market-context aware: RS vs QQQ, SPY/QQQ session changes, VIX
- Counter-trend vetoes protect against trading against strong market moves
- Volume spike detection uses sensible mid-session baseline

**Weaknesses**:
- No option strategy awareness — by design (intraday), but limits cross-engine synergy
- VIX penalty clamps both bull AND bear — can kill both sides in close-score scenarios
- Opening range breakout awards 3.0 points regardless of follow-through (wick-through = same score as sustained breakout)
- Verdict requires `abs(diff) >= MARGIN_GO` (2.75) — can miss mixed-signal setups where one side dominates but diff is narrow

### Swing Trade Engine (`swing_trade.py`) — 1404 lines

**Pipeline**: Daily 6mo bars → MA20/MA50/RSI/MACD/volume/SPY+QQQ → bull/bear scoring → verdict → Decision Quality Layer (`build_swing_trade_decision`) → playbook hint

**Strengths**:
- Two-layer approach (verdict + decision quality) allows both pure signal strength AND risk-aware filtering
- Market context via SPY+QQQ bias is cached (5-min TTL)
- Extension checks (5D move, MA20 distance, RSI) prevent chasing
- Earnings awareness, IV rank awareness, gap awareness
- Decision messages are specific and include actionable metrics

**Weaknesses**:
- **Dual verdict system**: Raw verdict can be "STRONG GO" while decision layer says "AVOID_CHASE". UI shows contradictory signals between engine card and decision card
- **option_liquidity_score always None** (line 1361) — entire LOW_OPTION_LIQUIDITY branch is dead code
- Market context penalty asymmetry: bullish gets -2.0 for MARKET_WEAK, bearish gets -1.0 for MARKET_SUPPORTIVE. Bull penalty is 2x bear penalty
- Suggested strategy mapping uses IV rank but never consults actual option chain data

### Regular Trade Engine (`engine.py`) — 1690 lines

**Pipeline**: Options chain + MarketSignals → strategy builders → liquidity/credit filtering → EV/Kelly → scoring → ranked TradeCandidate list

**Strengths**:
- Full Black-Scholes EV for long strategies (uncapped payoff)
- Distributional EV for credit spreads (full payoff range, not binary)
- 5 strategy modes: all, long_only, credit_only, short_or_covered, straddle_only
- Dedup prevents redundant risk (Bull Put Spread displaces Short Put/Covered Call)
- 4-dimensional scoring (signal 0-40, structure 0-30, liquidity 0-20, IV fit 0-10)
- Kelly sizing with half-Kelly cap at 20%

**Weaknesses**:
- **get_chain(expiry) ignores expiry** (line 1481-1482): always returns same chain; expiry parameter silently dropped
- **max_profit = cost * 10 for long options** (lines 771, 825, 1134): arbitrary 10x upside regardless of DTE/volatility/strike
- **Debit spreads use binary EV** (line 878), not distributional EV — only credit spreads get full payoff distribution
- Covered Call/Covered Put/Short Put all suppressed by single flag (_suppress_bull_naked)
- Drift asymmetry: bullish +0.15 vs bearish -0.10 — 50% stronger weighting for bullish setups

---

## 2. STRATEGY SUPPORT MATRIX

| Strategy | Day | Swing | Regular | Status |
|---|---|---|---|---|
| Long Call | ❌ | ✅ (recommended) | ✅ | **Supported** |
| Long Put | ❌ | ✅ (recommended) | ✅ | **Supported** |
| Short Call (Naked) | ❌ | ❌ | ✅ | **Supported** (margin warning) |
| Short Put (Naked) | ❌ | ❌ | ✅ | **Supported** (margin warning) |
| Covered Call | ❌ | ❌ | ✅ | **Supported** (can be suppressed) |
| Covered Put / CSP | ❌ | ❌ | ✅ | **Supported** (can be suppressed) |
| Bull Call Spread | ❌ | ❌ | ✅ | **Supported** |
| Bear Put Spread | ❌ | ❌ | ✅ | **Supported** |
| Bull Put Spread | ❌ | ❌ | ✅ | **Supported** |
| Bear Call Spread | ❌ | ❌ | ✅ | **Supported** |
| Iron Condor | ❌ | ❌ | ✅ | **Supported** |
| Long Straddle | ❌ | ❌ | ✅ | **Supported** |
| Directional (long/short) | ✅ | ✅ | ❌ | **Supported** (equity level) |
| Neutral Income | ❌ | ❌ | ✅ | **Supported** (IC, Short Put, CC) |

### Missing (reasonable omissions)
- Calendar / Diagonal spreads
- Butterfly / Condor (non-iron)
- Jade Lizard
- Ratio spreads
- Double Diagonal

---

## 3. BROKEN / INCONSISTENT LOGIC

### BUG-1: get_chain() ignores expiry (engine.py:1481-1482)
`expiry` parameter silently dropped. If multi-expiry strategies are added, wrong chain will be used.
**Severity**: Low | **Fix**: Pass expiry-aware chain explicitly

### BUG-2: Swing option_liquidity_score never populated (swing_trade.py:1361)
LOW_OPTION_LIQUIDITY dead code — illiquid tickers may get swing GO signals when options can't be traded.
**Severity**: Medium | **Fix**: Wire up actual liquidity check from live chain data

### BUG-3: Arbitrary 10x max_profit for long options (engine.py:771, 825, 1134)
0DTE OTM call and 6-month LEAPS both get cost * 10. Distorts R:R and EV/edge.
**Severity**: Medium | **Fix**: Compute from IV × sqrt(DTE/365) × 3 as expected move

### BUG-4: Debit spreads use binary EV (engine.py:878)
Credit spreads get full distributional EV; debit spreads get simplified binary.
**Severity**: Medium | **Fix**: Implement compute_bs_ev_debit_spread

### BUG-5: Drift asymmetry favors calls (engine.py:413, 419)
Bullish drift +0.15 vs bearish -0.10. Creates systematic bullish bias in EV.
**Severity**: Low | **Fix**: Make symmetric (±0.15) or document rationale

### INCONSISTENCY-1: Covered Call suppression too broad
Single Bull Put Spread suppresses Covered Call, Covered Put, AND Short Put. Stock owners lose Covered Call visibility.
**Fix**: Only suppress Short Put; Covered Call (stock ownership) needs independent flag

### INCONSISTENCY-2: Market context penalty asymmetry (swing_trade.py:558-564)
Bullish + MARKET_WEAK = -2.0 vs Bearish + MARKET_SUPPORTIVE = -1.0. Bull penalty is 2x.
**Fix**: Symmetric penalization (±1.5 or ±2.0)

### INCONSISTENCY-3: Different credit filter thresholds per strategy
Covered Call: 0.80%, Covered Put: 0.60%, Short Put/Call: 0.50%, spreads: 25% of width. No rationale documented.
**Fix**: Standardize or document per-strategy rationale

---

## 4. REGRESSION FINDINGS

**No regressions found** from recent UI/WatchlistX/PositionsCenter/TradeCommandCenter refactors.

- engine.py unchanged — pure logic, no UI entanglement
- trade_aggregator.py correctly isolates engine calls from main.py routing
- decision_resolver/resolver.py is new but only normalizes; doesn't change engine behavior
- All 75 tests pass
- _analyze_regular() faithfully replicates _analyze_ticker() from main.py

---

## 5. AI SCORE WEAKNESSES

| Area | Quality | Issue |
|---|---|---|
| Day trade reasons | **Good** | Specific: "Price above VWAP (+0.32%)", "Volume spike confirms" |
| Day trade final reason | **Good** | trader_decision.decision_message is narrative and specific |
| Swing decision messages | **Good** | Include metrics (+9.5% in 5 days, RSI 78) |
| Swing playbook hints | **Good** | IV-aware strategy selection with disclosures |
| Regular engine rationales | **Mixed** | Contains numbers but formulaic structure |
| Regular resolver reason | **WEAK** | Generic: "Structure, edge, and trend are aligned" |

### Key weak spots:
1. **Resolver `reason` for regular trades**: "Bias exists, but pricing or structure still needs improvement" — tells nothing actionable
2. **Swing "NO_TRADE_WAIT" reasons**: "Signals are insufficient or conflicting" — not specific
3. **Day trade "WAIT" reasons**: "No clear intraday edge — scores too close or too low" — doesn't say WHY

---

## 6. PRIORITY FIXES

### P0 — Must fix (logic bugs)
| # | Bug | File | Effort |
|---|---|---|---|
| 1 | Swing option_liquidity_score always None | swing_trade.py:1361 | 2-3h |
| 2 | 10x max_profit distorts long option EV | engine.py:771,825,1134 | 2-4h |

### P1 — Should fix (accuracy/consistency)
| # | Issue | File | Effort |
|---|---|---|---|
| 3 | Debit spreads use binary EV (not distributional) | engine.py:878 | 3-5h |
| 4 | Drift asymmetry (+0.15 vs -0.10) | engine.py:413,419 | 30m |
| 5 | Covered Call suppression too broad | engine.py:1559-1561 | 1h |
| 6 | get_chain ignores expiry | engine.py:1481-1482 | 30m |

### P2 — Nice to fix (explanations)
| # | Issue | File | Effort |
|---|---|---|---|
| 7 | Regular resolver reason too generic | decision_resolver/resolver.py:346 | 2h |
| 8 | Swing trade reasons explain threshold gaps | swing_trade.py:389-404 | 1h |
| 9 | Market context penalty asymmetry | swing_trade.py:558-564 | 30m |
| 10 | Credit filter thresholds undocumented | engine.py:1314,1376 | 30m |

---

## 7. KEY VERIFICATION SUMMARY

| Test | Result |
|---|---|
| Bullish markets do NOT favor puts | ✅ All three engines correctly orient |
| Covered call logic works | ✅ _build_covered_call exists, correct delta, premium yield check |
| High IV premium selling works | ✅ CREDIT_IV_OK enables credit sellers at IV >= 50 |
| Long momentum trades work | ✅ Long Call builds when BULLISH + confidence >= 20 |
| Spreads classified correctly | ✅ Credit vs debit separation is clean |
| No accidental NO-GO inflation | ✅ Independent veto gates per engine |
| Covered strategies bias alignment | ✅ score_signal_alignment: not BEARISH for all neutral-bullish |

---

## 8. SAFE REFACTOR GUIDELINES

### Do NOT change:
- Day trade scoring thresholds (4.5/2.75/7.0/4.0)
- Swing trade verdict thresholds (5.5/3.0/8.0/4.0)
- Regular engine strategy dedup logic
- Kelly sizing model (half-Kelly, 20% cap)
- VIX gate thresholds (35 swing, 40 day)
- Strike delta targets (0.20-0.32/0.40-0.55/0.15-0.25)

### Do change (safely):
1. Fix option_liquidity_score → activate dead code
2. Make max_profit data-derived → replace cost*10 with IV-based expected move
3. Add compute_bs_ev_debit_spread → new function, existing code unchanged
4. Make drift symmetric → -0.10 to -0.15
5. Un-suppress Covered Call when spread built → separate flag for Short Put only

---

**Bottom Line**: Engines are fundamentally sound, no critical regressions. The 75-test suite validates core behavior. Priority fixes: (1) dead option_liquidity_score path, (2) arbitrary 10x max_profit, (3) debit spread EV asymmetry, (4) generic resolver explanations.
