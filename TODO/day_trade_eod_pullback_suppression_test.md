# Day Trade: Add Test for ENTRY_PULLBACK Suppression During EOD_CLOSING

## Problem

`build_day_entry_guidance` in `backend/day_trade.py` correctly suppresses `ENTRY_PULLBACK`
when `session_phase == "EOD_CLOSING"` via a guard on line ~674:

```python
if state == "ENTRY_ACTIVE" and session_phase != "EOD_CLOSING":
    # ... pullback detection that may set state = "ENTRY_PULLBACK"
```

This ensures the state returns `EOD_CLOSING` (exit only) even when all the pullback
conditions are satisfied (price has retreated >= 0.30% from session high, structure
intact above ORH, etc.).

The existing EOD test (`test_eod_closing_overrides_even_for_perfect_setup`) passes
`last_price=155.0, session_high=155.0` — zero retreat — so it never exercises the
pullback code path. If the `and session_phase != "EOD_CLOSING"` guard is accidentally
removed, every test still passes.

## What to implement

Add a test that specifically combines pullback conditions with `EOD_CLOSING` in
`backend/tests/test_day_trade_entry_guidance.py`, inside the existing
`TestEodClosingPhase` class:

```python
def test_eod_closing_suppresses_entry_pullback_long(self):
    """
    Price has retreated 0.39% from session_high (enough to trigger ENTRY_PULLBACK),
    but session_phase is EOD_CLOSING — must return EOD_CLOSING, not ENTRY_PULLBACK.
    Guards the 'and session_phase != "EOD_CLOSING"' condition at day_trade.py ~674.
    """
    metrics = _make_metrics(
        vwap_position="above", or_breakout="above",
        volume_spike=True, or_historical="broke_up",
        session_phase="EOD_CLOSING",
        last_price=151.60, session_high=152.0,   # retreat = 0.26% — below 0.30% threshold
        or_high=150.0, vwap=149.5,
    )
    # Use a retreat that clearly exceeds 0.30%: last_price=101.60, session_high=102.0
    metrics["last_price"]    = 101.60
    metrics["session_high"]  = 102.0    # retreat = (102 - 101.60) / 102 * 100 = 0.39%
    metrics["or_high"]       = 100.0
    result = build_day_entry_guidance(metrics, self.td, "long")
    self.assertEqual(
        result["state"], "EOD_CLOSING",
        "EOD_CLOSING must suppress ENTRY_PULLBACK — exit-only window overrides all entry states"
    )


def test_eod_closing_suppresses_entry_pullback_short(self):
    """
    Price has bounced 0.39% from session_low (enough to trigger ENTRY_PULLBACK),
    but session_phase is EOD_CLOSING — must return EOD_CLOSING, not ENTRY_PULLBACK.
    """
    metrics = _make_metrics(
        vwap_position="below", or_breakout="below",
        volume_spike=True, or_historical="broke_down",
        session_phase="EOD_CLOSING", bounce_scenario="",
    )
    metrics["last_price"]   = 98.40
    metrics["session_low"]  = 98.0     # bounce = (98.40 - 98.0) / 98.0 * 100 = 0.41%
    metrics["or_low"]       = 99.0
    result = build_day_entry_guidance(metrics, self.td, "short")
    self.assertEqual(
        result["state"], "EOD_CLOSING",
        "EOD_CLOSING must suppress ENTRY_PULLBACK on short side too"
    )
```

## Correctness check before adding the test

Verify the guard is still in place in `backend/day_trade.py`:

```python
# Should read exactly:
if state == "ENTRY_ACTIVE" and session_phase != "EOD_CLOSING":
    _s_high = float(metrics.get("session_high") or 0)
    ...
```

If that condition is present and correct, the new tests will pass immediately.
If the guard was accidentally removed, the tests will fail and expose the regression.

## Files to change

- `backend/tests/test_day_trade_entry_guidance.py` — add two tests to `TestEodClosingPhase`

## Verification

```bash
python -m pytest backend/tests/test_day_trade_entry_guidance.py::TestEodClosingPhase -v
```

All existing EOD tests must pass. The two new tests must pass and must fail
if the `and session_phase != "EOD_CLOSING"` guard is removed from `day_trade.py`.
