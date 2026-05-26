# OptionAdvisor Engine Rebuild Plan
_Complete overhaul — anchored to 3 core trading questions_

---

## The 3 Questions Every Trade Must Answer

```
1. ENTRY  — Should I enter right now?  → All 3 gates met = YES / else NO + what's missing
2. LEVELS — Where is my target & stop? → Exact prices from chart structure only
3. EXIT   — Should I exit right now?   → Stop/target hit = YES / thesis intact = HOLD
```

---

## Confirmed Bugs (from full code audit)

### CRITICAL — Active right now, costing money

| # | File | Line | Bug | Fix |
|---|------|------|-----|-----|
| C1 | `storage.py` | 784–801 | `enter_now_alerted` in SELECT but missing from return dict → ENTER NOW fires every scan | Add to return dict |
| C2 | `main.py` | 448–455 | Market hours check: Pacific Time → alerts fire 30min early, 3hrs late | Use Eastern Time |
| C3 | `swing_trade.py` | 1874–1929 | ALL swing levels use `price*multiplier` (brk=last×1.015, t1=brk×(1+mom×0.5), stop=ma20×0.96) | Structural anchoring |
| C4 | `resolver.py` | 482 | Swing ENTER NOW fires from `_execution_timing_from_decision()` — ignores missing_confirmations | Mirror day-trade pattern |
| C5 | `resolver.py` | 288–291 | Scalp target display: `last_price * 1.01` (1% flat, arbitrary) | Remove or use engine target |
| C6 | `day_trade.py` | 619–622 | ENTRY_RETEST fires without checking `or_historical == "broke_up"` | Add gate |

### HIGH — Causing wrong signals

| # | File | Line | Bug | Fix |
|---|------|------|-----|-----|
| H1 | `active_trade_decision.py` | 519–526 | Duplicate VWAP stop appended in SHORT inside-range path | Remove duplicate |
| H2 | `active_trade_decision.py` | 125–128 | Trend band 0.12% vs day_trade.py VWAP_BAND_PCT 0.15% | Use 0.15% consistently |
| H3 | `main.py` | 1073 | `prev_state_num` defaults to 0 when no prior row; condition checks ==1 → never true → 1→2 alert never fires on first scan | Default to 1 |
| H4 | `day_trade.py` | 810, 829 | Last-resort fallback targets still use `last_price * 1.01/0.99` | Use VWAP-anchored fallback |

---

## Implementation — 3 Phases

---

## PHASE 1: Alert Infrastructure (30 min)
_Fix the plumbing — no more repeated/wrong-time alerts_

### 1a. Fix `enter_now_alerted` SELECT bug — `storage.py` lines 784–801

**Before:**
```python
SELECT state_num, action, session_date, updated_at,
       target_hit, inplay_since_ms, weak_breakout_alerted
FROM ticker_state_last
...
return {
    "state_num": ...,
    "weak_breakout_alerted": ...,
    # enter_now_alerted MISSING
}
```

**After:**
```python
SELECT state_num, action, session_date, updated_at,
       target_hit, inplay_since_ms, weak_breakout_alerted, enter_now_alerted
FROM ticker_state_last
...
return {
    ...
    "weak_breakout_alerted": int(row["weak_breakout_alerted"] or 0),
    "enter_now_alerted":     int(row["enter_now_alerted"]     or 0),  # ADD THIS
}
```

### 1b. Fix market hours timezone — `main.py` lines 448–455

**Before:**
```python
now = datetime.now(ZoneInfo("America/Los_Angeles"))
return 6 * 60 <= minutes < 16 * 60   # 6AM-4PM PT = wrong
```

**After:**
```python
now = datetime.now(ZoneInfo("America/New_York"))
# 9:30 AM ET open, 4:00 PM ET close
return (now.hour > 9 or (now.hour == 9 and now.minute >= 30)) and now.hour < 16
```

### 1c. Fix prev_state_num default — `main.py` line 1073

**Before:**
```python
prev_state_num = int((prev_state_row or {}).get("state_num") or 1) if prev_state_row else 0
```

**After:**
```python
prev_state_num = int((prev_state_row or {}).get("state_num") or 1)  # default 1 always
```

### 1d. Remove resolver scalp target display — `resolver.py` lines 288–291

**Before:**
```python
if last_price is not None and vwap is not None:
    dist_to_target = float(last_price) * 1.01 if bias == "long" else float(last_price) * 0.99
    execution_fields.append({"label": "Scalp Target", "value": f"${dist_to_target:.2f}"})
```

**After:** Delete entirely. The correct targets come from `entry_guidance.scalp_target` (day_trade.py), already displayed in the panel.

---

## PHASE 2: Day Trade Engine — Entry Gate & Fallbacks (45 min)
_Every level references chart structure_

### 2a. Fix OR retest gate — `day_trade.py` line 619

**Before:**
```python
elif or_retest and not volume_spike:
    state = "ENTRY_RETEST"
```

**After:**
```python
elif or_retest and or_historical == "broke_up" and not volume_spike:
    state = "ENTRY_RETEST"    # Price pulled back to ORH — valid continuation setup
elif or_retest and or_historical != "broke_up":
    state = "WAIT_FOR_BREAKOUT"  # At ORH but never broke above — not a retest
```

### 2b. Fix last-resort target fallbacks — `day_trade.py` lines 810, 829

**Before:**
```python
else:
    scalp_target = round(last_price * 1.01, 2)   # FORBIDDEN multiplier
# (short)
else:
    scalp_target = round(last_price * 0.99, 2)   # FORBIDDEN multiplier
```

**After:**
```python
else:
    # No OR available — anchor to VWAP if possible, else None
    scalp_target   = round(vwap * 1.005, 2) if vwap else None
    scalp_target_2 = round(vwap * 1.010, 2) if vwap else None
# (short)
else:
    scalp_target   = round(vwap * 0.995, 2) if vwap else None
    scalp_target_2 = round(vwap * 0.990, 2) if vwap else None
```

### 2c. Fix active_trade duplicate VWAP stop — `active_trade_decision.py` lines 519–526

Remove the unconditional second VWAP stop append in the SHORT inside-range path. The stop is already appended at lines 512–518.

### 2d. Fix active_trade VWAP band inconsistency — `active_trade_decision.py` lines 125–128

**Before:**
```python
if dist > 0.12:
    trend_direction = "up"
elif dist < -0.12:
    trend_direction = "down"
```

**After:**
```python
_VWAP_BAND = 0.15  # Match day_trade.py VWAP_BAND_PCT
if dist > _VWAP_BAND:
    trend_direction = "up"
elif dist < -_VWAP_BAND:
    trend_direction = "down"
```

---

## PHASE 3: Swing Trade Engine — Complete Rewrite of Levels (60 min)
_The biggest fix — targets anchored to MA20 structural distance_

### 3a. Rewrite `_compute_exec_levels` — `swing_trade.py` lines 1874–1929

**Core principle:** The "measured move" for a swing trade is the distance from MA20 (structural support/resistance) to current price. That distance, replicated above (long) or below (short), gives T1 and T2.

**Before (BROKEN):**
```python
# Long
brk = last * 1.015                      # arbitrary +1.5%
t1  = brk * (1.0 + mom * 0.5)           # momentum multiplier
t2  = brk * (1.0 + mom)                 # momentum multiplier
stop = ma20 * 0.96                       # -4% from MA20, too wide

# Short
brk = last * 0.985                      # arbitrary -1.5%
t1  = brk * (1.0 - mom * 0.5)
t2  = brk * (1.0 - mom)
stop = ma20 * 1.04                       # +4% from MA20, too wide
```

**After (FIXED — full function):**
```python
def _compute_exec_levels(
    last: float,
    ma20: float,
    mom_5d_pct: float,
    bias: Optional[str],
) -> dict[str, Optional[float]]:
    """
    Swing trade execution levels — anchored to MA20 structural distance.

    Logic (LONG):
      - MA20 is the primary support level (structural floor).
      - The move from MA20 to current price = the 'measured move' (what already happened).
      - T1 = current price + 50% of that move (half measured move extension).
      - T2 = current price + 100% of that move (full measured move extension).
      - Stop = MA20 - 0.2% (just below structural support, tight).
      - Breakout = current price + 0.5% (minor buffer above current for confirmation).

    Example (LONG): last=$100, ma20=$95
      measured_move = $100 - $95 = $5
      T1 = $100 + $2.50 = $102.50
      T2 = $100 + $5.00 = $105.00
      Stop = $95 × 0.998 = $94.81
      Breakout = $100.50 (entry trigger above current)

    Logic (SHORT): Mirror of long using MA20 as resistance ceiling.
    """
    if ma20 <= 0 or last <= 0:
        return {}

    if bias == "long":
        measured_move = max(last - ma20, last * 0.01)   # floor at 1% to avoid zero
        brk  = round(last * 1.005, 2)                   # just above current = entry trigger
        t1   = round(last + measured_move * 0.5, 2)     # T1 = half measured move up
        t2   = round(last + measured_move * 1.0, 2)     # T2 = full measured move up
        stop = round(ma20 * 0.998, 2)                   # just below MA20 (structural support)
        pb_lo = round(ma20 * 0.995, 2)                  # pullback zone: near MA20
        pb_hi = round(ma20 * 1.005, 2)
        # Sanity checks
        if not (t1 > last and t2 > t1 and stop < ma20):
            log.warning("_compute_exec_levels long: sanity fail last=%s ma20=%s", last, ma20)
            return {}
        return {
            "breakout":        brk,
            "target1":         t1,
            "target2":         t2,
            "stop":            stop,
            "pullback_zone_lo": pb_lo,
            "pullback_zone_hi": pb_hi,
        }

    if bias == "short":
        measured_move = max(ma20 - last, last * 0.01)   # floor at 1%
        brk  = round(last * 0.995, 2)                   # just below current = entry trigger
        t1   = round(last - measured_move * 0.5, 2)     # T1 = half measured move down
        t2   = round(last - measured_move * 1.0, 2)     # T2 = full measured move down
        stop = round(ma20 * 1.002, 2)                   # just above MA20 (structural resistance)
        pb_lo = round(ma20 * 0.995, 2)
        pb_hi = round(ma20 * 1.005, 2)
        if not (t1 < last and t2 < t1 and stop > ma20):
            log.warning("_compute_exec_levels short: sanity fail last=%s ma20=%s", last, ma20)
            return {}
        return {
            "breakout":        brk,
            "target1":         t1,
            "target2":         t2,
            "stop":            stop,
            "pullback_zone_lo": pb_lo,
            "pullback_zone_hi": pb_hi,
        }

    return {}
```

### 3b. Fix swing ENTER NOW — `resolver.py` line 482

Add a `_swing_execution_timing` function and use it:

```python
def _swing_execution_timing(final_decision: str, missing: list[str]) -> str:
    """Swing ENTER NOW requires final_decision==READY AND no missing confirmations."""
    f = str(final_decision or "").upper()
    if f == "READY":
        if not missing:
            return "ENTER NOW"
        # Has missing confirmations — explain what's needed
        joined = " ".join(c.lower() for c in missing)
        if "pullback" in joined:
            return "WAIT FOR PULLBACK"
        if "volume" in joined:
            return "WAIT FOR VOLUME"
        return f"ENTRY CONDITIONAL — {missing[0]}"
    return _execution_timing_from_decision(final_decision)

# In _resolve_swing_trade(), replace line 482:
# BEFORE:
execution_timing=_execution_timing_from_decision(final_decision),
# AFTER:
execution_timing=_swing_execution_timing(final_decision, missing_confirmations),
```

---

## ENGINE.md — Documentation Content

Create `/Users/vijender/Development/OptionAdvisor/backend/ENGINE.md` with:

```markdown
# OptionAdvisor Trading Engine — Calculation Reference
_Every formula, every level, every alert condition — documented for review_

## The 3 Core Questions

### Q1: Should I enter this trade?

Gates (ALL must be true simultaneously):
| Gate | Day Trade | Swing Trade |
|------|-----------|-------------|
| Price level | Above OR High (long) / Below OR Low (short) | Above MA20 (long) / Below MA20 (short) |
| Volume | volume_spike == True (current bar ≥ 1.55× median) | Volume above 20-day average |
| VWAP | Price above VWAP (long) / below VWAP (short) | Price trend aligned with bias |

If ANY gate is missing → state = WAIT, show exactly which gate is missing.

### Q2: Where is my target and stop?

**Day Trade (Opening Range-based):**
| Level | Formula | Example (ORH=$427.40, ORL=$420.85, range=$6.55) |
|-------|---------|------|
| Target 1 | ORH + 50% × OR_range | $427.40 + $3.28 = $430.68 |
| Target 2 | ORH + 100% × OR_range | $427.40 + $6.55 = $433.95 |
| Stop (long) | OR Low | $420.85 |
| Stop (short) | OR High | $427.40 |

VWAP bounce variant:
| Level | Formula |
|-------|---------|
| Target 1 | OR High |
| Target 2 | ORH + 50% × OR_range |
| Stop | VWAP × 0.998 |

**Swing Trade (MA20 structural distance):**
| Level | Formula | Example (last=$100, MA20=$95, move=$5) |
|-------|---------|------|
| Measured move | last − MA20 | $5.00 |
| Target 1 | last + measured_move × 0.5 | $102.50 |
| Target 2 | last + measured_move × 1.0 | $105.00 |
| Stop | MA20 × 0.998 | $94.81 |

### Q3: Should I exit right now?

**Day Trade exit triggers:**
| Trigger | Action |
|---------|--------|
| Price hits Target 1 | Sell/cover ½, move stop to breakout level |
| Price hits Target 2 | Close entire position |
| Price closes below OR Low (long) / above OR High (short) | Exit full — thesis broken |
| Price loses VWAP (closes below for long) | Exit full — structure failed |
| 3:45 PM ET | Exit full — day trade, never overnight |

**Swing Trade exit triggers:**
| Trigger | Action |
|---------|--------|
| Price hits Target 1 | Sell/cover ½, move stop to breakeven |
| Price hits Target 2 | Close entire position |
| Daily close below MA20 × 0.998 (long) | Exit full — swing structure broken |
| Daily close above MA20 × 1.002 (short) | Exit full |
| DTE ≤ 2 | Exit full — theta destroying value |
| NEVER | Exit on single intraday bar (swing trade only) |

## Alert Conditions

Only 3 alerts fire:

### Alert 1: STATE_CHANGE (1→2 only)
- Trigger: prev_state_num == 1 AND now_state_num == 2
- Meaning: Setup forming, entry window opening — get ready
- Dedup: fires once per state cycle (resets on state change)
- Time gate: 9:30 AM – 4:00 PM ET only, weekdays only

### Alert 2: ENTER_NOW
- Trigger: now_state == 2 AND "ENTER" in execution_timing AND enter_now_alerted == 0
- Meaning: ALL 3 entry gates met simultaneously — pull the trigger
- Dedup: enter_now_alerted flag set to 1, reset to 0 on next state change
- Time gate: 9:30 AM – 4:00 PM ET only

### Alert 3: TARGET_HIT (in-play monitoring)
- Trigger: now_state == 3 AND price ≥ scalp_target AND target_hit == 0
- Meaning: Target 1 hit — sell half, move stop
- Dedup: target_hit flag set to 1

**What does NOT alert:**
- State 3→2, 2→1, any backward transition
- State 1→3 (skipped states)
- Any repeated alert within same state cycle
- Any alert before 9:30 AM ET or after 4:00 PM ET
- Weekends

## Volume Spike Definition
```
volume_spike = current_bar_volume ≥ 1.55 × median(post-OR session volume)
```
Baseline: median of bars since 9:45 AM ET (post-opening-range). If fewer than 5 bars, uses OR volume. Spike threshold: 1.55× (55% above normal).

## State Machine
```
State 1 (SETUP):     MONITORING | WAIT_FOR_VWAP_HOLD | WAIT_FOR_BREAKOUT | WAIT_FOR_BREAKDOWN
State 2 (ENTRY):     WAIT_FOR_VOLUME | VWAP_TEST | WAIT_BOUNCE_LEVEL | ENTRY_RETEST*
State 3 (IN-PLAY):   ENTRY_ACTIVE | ENTRY_PULLBACK
State 4 (EXIT):      EOD_CLOSING

* ENTRY_RETEST: only valid when or_historical=="broke_up" (price previously broke ORH)
```
```

---

## Files to Modify (in order)

1. `backend/storage.py` — add `enter_now_alerted` to return dict (~2 lines)
2. `backend/main.py` — timezone fix, prev_state_num default (~5 lines)
3. `backend/decision_resolver/resolver.py` — remove bad scalp target, add swing timing (~15 lines)
4. `backend/day_trade.py` — fix OR retest gate, fix fallback targets (~10 lines)
5. `backend/active_trade_decision.py` — remove duplicate VWAP stop, fix band (~5 lines)
6. `backend/swing_trade.py` — full rewrite of `_compute_exec_levels` (~60 lines)
7. Create `backend/ENGINE.md` — documentation (~150 lines)

---

## Verification Checklist

After all changes:

```bash
# 1. Syntax
.venv/bin/python -m py_compile backend/storage.py backend/main.py \
  backend/decision_resolver/resolver.py backend/day_trade.py \
  backend/active_trade_decision.py backend/swing_trade.py && echo OK

# 2. Engine regression (all 18 scenarios must pass)
cd backend && python scripts/run_engine_regression.py

# 3. Frontend build
cd frontend && npm run build
```

Manual spot-checks:
- [ ] TSLA today (ORH=$427.40, ORL=$420.85, range=$6.55): T1=$430.68, T2=$433.95, Stop=$420.85
- [ ] ENTER NOW fires ONCE per state cycle (not every scan)
- [ ] No alerts before 9:30 AM ET
- [ ] Swing long (last=$100, MA20=$95): T1=$102.50, T2=$105.00, Stop=$94.81
- [ ] Swing ENTER NOW only fires when missing_confirmations is empty
