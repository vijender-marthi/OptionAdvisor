# Swing Trade: Add Test for STRONG_GO + IV Rank 70–74 Debit Spread

## Problem

The swing trade strategy selector has an intentional asymmetry at IV rank 70–74:

- **Non-STRONG_GO** setup at IV 70–74 → `PUT_CREDIT_SPREAD` (sells premium via `_iv_very_high >= 70`)
- **STRONG_GO** setup (score ≥ 7.0) at IV 70–74 → `CALL_DEBIT_SPREAD` (inline threshold is `>= 75`)

The design rationale is correct: high directional conviction (STRONG_GO) justifies paying
for delta even when IV is elevated — you'd rather own the full move. But there is no test
that locks this in. If a developer unifies the thresholds (e.g. changes STRONG_GO to also
use `_iv_very_high >= 70`), the test suite passes silently and the strategy changes without
any alert.

Current code in `backend/swing_trade.py` around line 769:

```python
_iv_very_high = iv_rank is not None and iv_rank >= 70   # sell-premium territory

elif trade_quality_score >= 7.0 and final_action == "STRONG_GO":
    if iv_rank is not None and iv_rank >= 75:            # ← stricter than _iv_very_high
        suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
    elif _iv_high:                                       # 60–74 for STRONG_GO → debit
        suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    else:
        suggested_strategy = "LONG_CALL" if is_bullish else "LONG_PUT"

elif _iv_very_high:                                      # >= 70 for non-STRONG_GO → credit
    suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
```

## What to implement

### 1. Add clarifying comment at the STRONG_GO branch

In `backend/swing_trade.py`, add an inline comment explaining the intentional threshold gap:

```python
elif trade_quality_score >= 7.0 and final_action == "STRONG_GO":
    # STRONG_GO: directional conviction is high — prefer owning the full move.
    # The credit-spread threshold is stricter here (>= 75) than for weaker setups
    # (>= 70) because at IV 70–74 the expected directional gain outweighs the
    # premium cost. Do NOT unify with _iv_very_high without updating tests.
    if iv_rank is not None and iv_rank >= 75:
        suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
    elif _iv_high:
        suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    else:
        suggested_strategy = "LONG_CALL" if is_bullish else "LONG_PUT"
```

### 2. Add the missing test

In `backend/tests/test_swing_trade_decision.py`, add after the existing
`test_strong_go_high_iv_suggests_credit_spread` test:

```python
def test_strong_go_iv_rank_70_74_uses_debit_not_credit():
    """
    STRONG_GO + IV rank 70–74 → CALL_DEBIT_SPREAD (not credit spread).
    Directional conviction at STRONG_GO justifies paying for delta even at
    elevated IV. Credit spreads kick in for STRONG_GO only at >= 75.
    """
    d = build_swing_trade_decision(
        "NVDA", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=58.0, dist_ma20_pct=1.2, mom_5d_pct=2.0,
        vol_ratio=1.9, vol_label="bull_expanding",
        iv_rank=72.0,
    )
    assert d["suggested_strategy"] == "CALL_DEBIT_SPREAD", (
        f"STRONG_GO + iv_rank=72 should use CALL_DEBIT_SPREAD (not credit spread), "
        f"got {d['suggested_strategy']}"
    )


def test_strong_go_iv_rank_70_74_bearish_uses_debit_not_credit():
    """
    STRONG_GO + IV rank 70–74 bearish → PUT_DEBIT_SPREAD (not CALL_CREDIT_SPREAD).
    """
    d = build_swing_trade_decision(
        "NVDA", bull_score=1.0, bear_score=9.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=42.0, dist_ma20_pct=-1.5, mom_5d_pct=-2.0,
        vol_ratio=1.8, vol_label="bear_expanding",
        iv_rank=73.0,
    )
    assert d["suggested_strategy"] == "PUT_DEBIT_SPREAD", (
        f"STRONG_GO bearish + iv_rank=73 should use PUT_DEBIT_SPREAD (not credit spread), "
        f"got {d['suggested_strategy']}"
    )
```

## Files to change

- `backend/swing_trade.py` — add inline comment at STRONG_GO branch (~line 769)
- `backend/tests/test_swing_trade_decision.py` — add two new test cases

## Verification

Run after the change:

```bash
python -m pytest backend/tests/test_swing_trade_decision.py -v
```

All existing tests must still pass. The two new tests must pass and should fail
if the STRONG_GO threshold is changed from `>= 75` to `>= 70`.
