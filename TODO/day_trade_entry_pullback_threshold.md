# Day Trade: Raise ENTRY_PULLBACK Threshold from 0.30% to 0.50%

## Problem

The `ENTRY_PULLBACK` state fires when price retreats `>= 0.30%` from the session
high (long) or bounces `>= 0.30%` from the session low (short):

```python
# backend/day_trade.py ~line 673
_PULLBACK_FROM_EXTREME_PCT = 0.30   # % retreat that flags an active pullback
```

At 0.30%, the threshold is below normal intraday noise for most liquid stocks:

| Stock | Price | 0.30% = | Notes |
|-------|-------|---------|-------|
| SPY   | $580  | $1.74   | Easily crossed on a single tick |
| NVDA  | $130  | $0.39   | Within typical bid-ask spread |
| DELL  | $243  | $0.73   | Less than 1 point of movement |
| META  | $605  | $1.82   | Normal 1-min candle range |

In practice: once a session high is established, the very next bar is almost
always 0.30%+ below it. The state becomes permanently `ENTRY_PULLBACK` for the
rest of the session, showing "⚠ No New Entries" even during healthy continuation
moves with strong volume.

The standard convention for a meaningful intraday retracement is **0.50%** — enough
to distinguish a real pullback from bid-ask noise and normal consolidation ticks.

## What to implement

### 1. Change the threshold constant

In `backend/day_trade.py`, update the constant and its comment:

```python
# Before:
_PULLBACK_FROM_EXTREME_PCT = 0.30   # % retreat that flags an active pullback

# After:
_PULLBACK_FROM_EXTREME_PCT = 0.50   # % retreat from session extreme that flags a real pullback
                                    # 0.50% filters bid-ask noise and 1-bar consolidation ticks;
                                    # anything less triggers false positives on liquid stocks.
```

### 2. Update the affected unit tests

The existing tests in `backend/tests/test_day_trade_entry_guidance.py` use
specific price/session_high pairs calibrated to the 0.30% threshold. Update
them to remain meaningful at 0.50%:

**`test_long_entry_active_no_pullback_stays_entry_active`**
```python
# Before: session_high=102, last_price=101.8 → retreat = 0.196% < 0.30%
# After:  session_high=102, last_price=101.8 → retreat = 0.196% < 0.50%  (still valid)
# No change needed — 0.196% is below both thresholds.
```

**`test_long_entry_active_pullback_at_threshold_returns_entry_pullback`**
```python
# Before: session_high=102, last_price=101.60 → retreat = 0.39% > 0.30% → ENTRY_PULLBACK
# After:  0.39% < 0.50% → would stay ENTRY_ACTIVE. Update to cross the new threshold:

# New values: session_high=102, last_price=101.48 → retreat = 0.51% > 0.50%
metrics = _make_metrics(
    vwap_position="above", or_breakout="above",
    volume_spike=True, or_historical="broke_up",
    last_price=101.48, session_high=102.0,   # retreat = 0.51%
)
result = build_day_entry_guidance(metrics, self.td, "long")
self.assertEqual(result["state"], "ENTRY_PULLBACK")
```

**`test_long_pullback_should_now_is_hold`** — update `last_price` to `101.48` to match.

**`test_short_entry_active_no_pullback_stays_entry_active`**
```python
# Before: session_low=97, last_price=97.19 → bounce = 0.196% < 0.30%
# No change needed — still below 0.50%.
```

**`test_short_entry_active_pullback_at_threshold_returns_entry_pullback`**
```python
# Update last_price to produce > 0.50% bounce from session_low.
# session_low=97.0, last_price=97.52 → bounce = 0.536% > 0.50%
```

Add a boundary test that explicitly documents the new threshold:
```python
def test_long_pullback_just_below_threshold_stays_entry_active(self):
    """0.49% retreat from session high is NOT a pullback — stays ENTRY_ACTIVE."""
    # session_high=102.0, last_price=101.50 → retreat = 0.49%
    metrics = _make_metrics(
        vwap_position="above", or_breakout="above",
        volume_spike=True, or_historical="broke_up",
        last_price=101.50, session_high=102.0,
    )
    result = build_day_entry_guidance(metrics, self.td, "long")
    self.assertEqual(result["state"], "ENTRY_ACTIVE",
        "0.49% retreat is noise — must not trigger ENTRY_PULLBACK")


def test_long_pullback_just_above_threshold_returns_entry_pullback(self):
    """0.51% retreat from session high IS a real pullback — returns ENTRY_PULLBACK."""
    # session_high=102.0, last_price=101.48 → retreat = 0.51%
    metrics = _make_metrics(
        vwap_position="above", or_breakout="above",
        volume_spike=True, or_historical="broke_up",
        last_price=101.48, session_high=102.0,
    )
    result = build_day_entry_guidance(metrics, self.td, "long")
    self.assertEqual(result["state"], "ENTRY_PULLBACK",
        "0.51% retreat should trigger ENTRY_PULLBACK")
```

### 3. No frontend changes needed

The `ENTRY_PULLBACK` card content in `DayTradeEnginePanel.tsx` is driven entirely
by `eg.state`, `eg.summary`, and `eg.action` — the threshold change is transparent
to the UI.

## Files to change

- `backend/day_trade.py` — change `_PULLBACK_FROM_EXTREME_PCT` from `0.30` to `0.50`
- `backend/tests/test_day_trade_entry_guidance.py` — update existing threshold tests,
  add two new boundary tests

## Verification

```bash
python -m pytest backend/tests/test_day_trade_entry_guidance.py -v
```

Run the full engine regression after:
```bash
python backend/tests/run_engine_regression.py
```

All 18 scenarios must pass. Manually verify on a live ticker during market hours
that ENTRY_PULLBACK no longer fires immediately after a session high is set on a
normal continuation bar.
