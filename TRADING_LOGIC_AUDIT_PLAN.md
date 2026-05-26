# Trading Logic Audit & Rewrite Plan
_Generated 2026-05-22 — complete overhaul, not a patch_

---

## Root Cause Summary

Every bug traces back to one decision: **targets, stops, and entries were computed from `price * multiplier` instead of chart structure (OR levels, VWAP, swing highs/lows, measured moves)**. This infected everything downstream — bad targets led to wrong exits, wrong exits led to holding losers and cutting winners.

---

## Bug Registry (Severity-Rated)

### CRITICAL — Fix First

| # | File | Line(s) | Bug | Impact |
|---|------|---------|-----|--------|
| C1 | `main.py` | 448–455 | Market hours check uses Pacific Time, not Eastern | Alerts fire 30 min early, run 3 hours late |
| C2 | `storage.py` | 784–785 | `enter_now_alerted` missing from SELECT query | ENTER NOW alerts repeat every scan cycle |
| C3 | `main.py` | 1162–1164 | Loop variables (eg_state, t, etc.) used outside loop | Data overwrite, crashes on empty ticker list |
| C4 | `day_trade.py` | 798,811,818,830 | Fallback targets use `last_price * 1.01/0.99` | Wrong target shown when OR range unavailable |
| C5 | `day_trade.py` | 634, 698 | ENTRY_ACTIVE set without checking `above_vwap == True` | Entry signals fire when VWAP alignment missing |
| C6 | `swing_trade.py` | 1883–1884, 1907–1908 | Swing targets = `breakout * (1 ± momentum)` | Arbitrary targets unrelated to chart structure |
| C7 | `swing_trade.py` | 1887, 1911 | Swing stop = `ma20 * 0.96/1.04` | Stop ignores swing low/high entirely |
| C8 | `resolver.py` | 436–438, 482 | Swing ENTER NOW fires without checking missing_confirmations | Premature entry signals on incomplete setups |

### HIGH — Fix Second

| # | File | Line(s) | Bug | Impact |
|---|------|---------|-----|--------|
| H1 | `day_trade.py` | 619–623 | OR retest entry allowed without volume spike | Low-quality retests treated as valid entries |
| H2 | `day_trade.py` | 741–760 | ENTRY_PULLBACK transition ignores volume | Pullback on declining volume = bear flag, not entry |
| H3 | `active_trade_decision.py` | 223, 338 | OR breach exit ignores VWAP alignment | Exits prematurely when VWAP still supports thesis |
| H4 | `resolver.py` | 288–291 | Day scalp target shown as `last_price ± 1%` in resolver display | Contradicts OR-based targets from day_trade.py |
| H5 | `main.py` | 1073–1075 | Impossible condition: prev_state=0 checked against ==1 | 1→2 alerts never fire on first scan of new ticker |

### MEDIUM — Fix Third

| # | File | Line(s) | Bug | Impact |
|---|------|---------|-----|--------|
| M1 | `active_trade_decision.py` | 262 | Soft-failure gate: requires below_vwap AND mom<-0.1 AND rs<-0.35 simultaneously | RS=None silently kills valid exit signals |
| M2 | `active_trade_decision.py` | 125–128 | Trend threshold 0.12% vs VWAP_BAND_PCT 0.15% | Inconsistent "up/down/flat" labels |
| M3 | `main.py` | 3107–3117 | Backward transition constants (3→2, 2→1, 4→1) exist in dict | Code risk — wrong alerts if filter logic relaxed |

---

## Implementation Plan — 3 Phases

---

### PHASE 1: Alert System & Infrastructure (Do First — stops bleeding)

**Goal:** No more duplicate alerts, correct market hours, no crashes.

#### 1a. Fix market hours timezone (`main.py` ~line 448)
```python
# BEFORE
now = datetime.now(ZoneInfo("America/Los_Angeles"))
return 6 * 60 <= minutes < 16 * 60

# AFTER
now = datetime.now(ZoneInfo("America/New_York"))
return (now.hour > 9 or (now.hour == 9 and now.minute >= 30)) and now.hour < 16
```

#### 1b. Fix enter_now_alerted SELECT (`storage.py` ~line 784)
```python
# BEFORE
SELECT state_num, action, session_date, updated_at,
       target_hit, inplay_since_ms, weak_breakout_alerted

# AFTER
SELECT state_num, action, session_date, updated_at,
       target_hit, inplay_since_ms, weak_breakout_alerted, enter_now_alerted
```
Add to return dict: `"enter_now_alerted": int(row["enter_now_alerted"] or 0)`

#### 1c. Fix loop variable scope in watchlist scan (`main.py` ~line 1162)
The `carry_level_key`, `eg_state`, `upsert_day_trade_watchlist_last()` calls must be inside the for-loop body, not after it. Fix indentation.

#### 1d. Fix prev_state initial condition (`main.py` ~line 1073)
```python
# BEFORE: sets prev_state_num=0 when no prior row, then checks ==1 (impossible)
prev_state_num = ... if prev_state_row else 0

# AFTER: default to 1 (State 1 = SETUP is the logical starting state)
prev_state_num = int((prev_state_row or {}).get("state_num") or 1)
```

#### 1e. Remove backward transition constants (`main.py` ~line 3107)
Only keep forward transitions that should alert:
```python
_VALID_ALERT_TRANSITIONS = {(1, 2), (2, 3)}  # Only these two
```
Remove (3,2), (2,1), (4,1), (4,2), (1,3), (1,4) from the dict entirely.

---

### PHASE 2: Day Trade Engine — Targets, Stops, Entries (Fix the math)

**Goal:** Every price level references chart structure.

#### 2a. Eliminate all price-multiplier fallbacks (`day_trade.py` ~line 796–830)

Replace ALL `last_price * 1.01` / `last_price * 0.99` with structure-based fallbacks:

```python
# When OR range unavailable, use VWAP as anchor
if bidir == "long":
    scalp_target   = round(or_high, 2) if or_high else (round(vwap * 1.005, 2) if vwap else None)
    scalp_target_2 = round(or_high + _or_range, 2) if (or_high and _or_range) else None
elif bidir == "short":
    scalp_target   = round(or_low, 2) if or_low else (round(vwap * 0.995, 2) if vwap else None)
    scalp_target_2 = round(or_low - _or_range, 2) if (or_low and _or_range) else None
```

#### 2b. Gate ENTRY_ACTIVE on VWAP alignment (`day_trade.py` ~line 634, 698)

```python
# Long
if (or_breakout == "above" or or_retest) and above_vwap and volume_spike:
    state = "ENTRY_ACTIVE"
else:
    state = "WAIT_FOR_VOLUME"  # Needs more confirmation

# Short
if (or_breakout == "below" or or_retest) and below_vwap and volume_spike:
    state = "ENTRY_ACTIVE"
else:
    state = "WAIT_FOR_VOLUME"
```

#### 2c. Require volume on OR retest (`day_trade.py` ~line 619)

```python
# BEFORE: ENTRY_RETEST allowed without volume
elif or_retest and not volume_spike:
    state = "ENTRY_RETEST"

# AFTER: Split clearly
elif or_retest and volume_spike:
    state = "ENTRY_RETEST"   # Volume confirmed — high quality
elif or_retest and not volume_spike:
    state = "WAIT_FOR_VOLUME"  # Retest happening but needs volume
```

#### 2d. Pullback state requires volume support (`day_trade.py` ~line 741)

```python
if _retreat >= _PULLBACK_FROM_EXTREME_PCT:
    if volume_spike:
        state = "ENTRY_PULLBACK"   # Pullback with buyers = continuation
    else:
        state = "WEAKENING"        # Pullback on air = exit signal
```

#### 2e. Fix active_trade OR breach exit (add VWAP confirmation requirement)

```python
# CALL below OR low — only EXIT if VWAP also lost
if (or_state == "below" or last < or_low) and below_vwap:
    # ... existing EXIT_WEAKNESS logic
elif (or_state == "below" or last < or_low) and above_vwap:
    return finish("WEAKENING", "Monitor", "Below OR low but holding VWAP — thesis under pressure, not yet broken.", "orange", [...])
```

---

### PHASE 3: Swing Trade Engine — Targets, Stops, ENTER NOW (Fix structural logic)

**Goal:** Swing trades use multi-day structure, not intraday multipliers.

#### 3a. Swing targets must use breakout-level measured moves (`swing_trade.py` ~line 1883)

Current: `t1 = brk * (1.0 + mom * 0.5)` — momentum multiplier, forbidden.

Replacement strategy:
- **T1** = breakout level + (prior range / 2). "Prior range" = distance from last swing low to breakout level.
- **T2** = breakout level + prior range (full measured move).
- If prior range unavailable: T1 = next known resistance, T2 = T1 + (T1 - breakout).
- The engine needs `prior_swing_low` and `prior_swing_high` passed in from the data layer.

```python
# New target logic (swing long)
prior_range = brk - swing_low if swing_low else None
t1 = round(brk + prior_range * 0.5, 2) if prior_range else None
t2 = round(brk + prior_range, 2) if prior_range else None
```

#### 3b. Swing stop must use last swing low/high (`swing_trade.py` ~line 1887)

Current: `stop = ma20 * 0.96` — MA-based, ignores price structure.

```python
# New stop logic (swing long)
stop = round(swing_low * 0.998, 2) if swing_low else round(brk * 0.97, 2)

# New stop logic (swing short)
stop = round(swing_high * 1.002, 2) if swing_high else round(brk * 1.03, 2)
```

The swing engine must source `swing_low` / `swing_high` from the data layer (prior 5–10 day lows/highs).

#### 3c. Fix ENTER NOW for swing — must check missing_confirmations (`resolver.py` ~line 482)

```python
# BEFORE (swing): ignores missing confirmations entirely
execution_timing=_execution_timing_from_decision(final_decision)

# AFTER: mirror day-trade pattern
def _swing_execution_timing(final_decision: str, missing: list) -> str:
    if str(final_decision).upper() == "READY" and not missing:
        return "ENTER NOW"
    elif str(final_decision).upper() == "READY" and missing:
        return f"WAIT — {missing[0]}"
    return _execution_timing_from_decision(final_decision)

execution_timing=_swing_execution_timing(final_decision, missing_confirmations)
```

#### 3d. Remove resolver display target of `last_price ± 1%` (`resolver.py` ~line 288)

Delete the execution_fields entry that shows "Scalp Target = $price * 1.01". The correct targets come from `day_trade.py` / `swing_trade.py` and are already in `entry_guidance.scalp_target`.

---

## Verification Steps

After each phase, run:
```bash
cd /Users/vijender/Development/OptionAdvisor
.venv/bin/python -m pytest backend/tests/ -x -q        # if tests exist
.venv/bin/python -m py_compile backend/day_trade.py backend/swing_trade.py backend/active_trade_decision.py backend/decision_resolver/resolver.py backend/main.py backend/storage.py
cd frontend && npx tsc --noEmit && npm run build
```

Manual verification checklist:
- [ ] TSLA today: breakout above ORH $427.40, OR range $6.55 → T1 = $430.68, T2 = $433.95
- [ ] ENTER NOW alert fires once per state cycle (not every scan)
- [ ] No alerts before 9:30 AM ET or after 4:00 PM ET
- [ ] Swing ENTER NOW only fires when missing_confirmations is empty
- [ ] Day trade with DTE > 3 shows DTE warning in entry modal
- [ ] Active trade swing position shows "Hold — swing" not "WATCH — At N DTE roll"

---

## Files to Modify (in order)

1. `backend/storage.py` — enter_now_alerted SELECT fix
2. `backend/main.py` — timezone, loop scope, state transition logic, alert filter
3. `backend/day_trade.py` — targets, entry gates, pullback volume check
4. `backend/active_trade_decision.py` — OR breach + VWAP combined exit gate
5. `backend/swing_trade.py` — targets (measured move), stops (swing low/high)
6. `backend/decision_resolver/resolver.py` — swing ENTER NOW + remove bad scalp target display

---

## What NOT to Change
- The 4-state system (State 1/2/3/4) — correct conceptually
- The alert dedup mechanism (enter_now_alerted, weak_breakout_alerted flags) — correct, just the SELECT was missing the column
- The Day/Swing trade type selector (just added) — correct
- DTE-aware exit logic in active_trade_decision.py — correct
- The OR-based target calculations just fixed in day_trade.py for the main path — correct, only fallbacks need fixing
