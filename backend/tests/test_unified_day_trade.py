"""
Tests for serialize_day_trade() in unified_analysis.py.

Business rules covered
======================

VERDICT (unified → display)
-----------------------------
scan verdict   trader_decision.suggested_action   → unified verdict
-----------    --------------------------------    -----------------
STRONG GO      (none in map)                       enter
GO             (none in map)                       enter
WATCH          (none in map)                       watch
NO-GO          (none in map)                       avoid
WAIT           (none in map)                       wait
*any*          WATCH_LONG_ONLY                     watch   ← TD wins
*any*          WATCH_PUT_BREAKDOWN                 watch   ← TD wins
*any*          WAIT_FOR_CONFIRMATION               wait    ← TD wins
*any*          NO_TRADE                            wait    ← TD wins
*any*          AVOID_CALLS                         avoid   ← TD wins
*any*          AVOID_CHASING_PUTS                  avoid   ← TD wins

DIRECTION (CALL vs PUT)
------------------------
suggested_action in {WATCH_LONG_ONLY, AVOID_CALLS, WAIT_FOR_CONFIRMATION}
    → CALL direction (stop must be below entry)
suggested_action in {WATCH_PUT_BREAKDOWN, AVOID_CHASING_PUTS}
    → PUT direction (stop must be above entry)
fallback (no explicit SA)
    → stop > entry → PUT; else → CALL

STOP PRICE VALIDATION
----------------------
If direction=CALL but raw stop > entry  → try or_low; if still wrong → null
If direction=PUT  but raw stop < entry  → try or_high; if still wrong → null

TARGET (T1 / T2) DIRECTION GUARD
----------------------------------
CALL: T1 must be > entry  (bullish target above entry)
PUT:  T1 must be < entry  (bearish target below entry)
T1 on wrong side → dropped; exit_rows has no t1/t2 row.

R/R RATIO
----------
Computed from |T1 - entry| / |stop - entry| using actual exit levels.
None when no T1 is present (wrong-side drop, wait/avoid verdict, etc.)

ENTRY PLAN CLEARED
-------------------
verdict in {wait, avoid} → entry_price=None, stop_price=None,
                            structure='', exit_rows=[]

STRUCTURE LABEL
----------------
Comes from orc.structure_hint > orc.recommended_structure > f'{direction} · 1-2 DTE'
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import pytest
except ImportError:
    # Dummy pytest module when not installed (for CI environments)
    class DummyMark:
        @staticmethod
        def parametrize(*args, **kwargs):
            def decorator(func):
                return func
            return decorator

    class DummyPytest:
        mark = DummyMark()

    pytest = DummyPytest()

from unified_analysis import serialize_day_trade


# ── helpers ──────────────────────────────────────────────────────────────────

class _Scan:
    """Minimal DayTradeScan-compatible stub."""
    def __init__(
        self,
        verdict="GO",
        bias="long",
        reasons=None,
        metrics=None,
        trader_decision=None,
        entry_guidance=None,
        option_risk_context=None,
        ticker="TEST",
        company_name="Test Corp",
    ):
        self.ticker          = ticker
        self.company_name    = company_name
        self.verdict         = verdict
        self.bias            = bias
        self.bull_score      = 6.0
        self.bear_score      = 2.0
        self.reasons         = reasons or []
        self.metrics         = metrics or {}
        self.trader_decision = trader_decision or {}
        self.entry_guidance  = entry_guidance or {}
        self.option_risk_context = option_risk_context or {}


def _base_metrics(
    last_price=200.0,
    or_high=202.0,
    or_low=198.0,
    vwap=201.0,
    rvol=1.8,
    volume_spike=True,
    entry_rr_ratio=None,  # we now recompute this
):
    return {
        "last_price":       last_price,
        "or_high":          or_high,
        "or_low":           or_low,
        "vwap":             vwap,
        "rvol":             rvol,
        "volume_spike":     volume_spike,
        "entry_rr_ratio":   entry_rr_ratio,
        "confidence":       {"momentum": "HIGH", "volume": "GOOD", "risk": "LOW"},
        "spy_change_pct":   0.3,
        "qqq_change_pct":   0.2,
        "vix":              17.0,
        "session_change_pct": 0.5,
    }


def _long_eg(last=200.0, or_high=202.0, or_low=198.0):
    """Long (CALL) entry guidance: scalp_target above entry, risk_below = or_low."""
    return {
        "current_price": last,
        "scalp_target":  or_high + 1.0,   # 203.0 — above entry
        "target_2":      or_high + 2.0,   # 204.0
        "risk_below":    or_low,           # 198.0 — below entry
    }


def _short_eg(last=200.0, or_high=202.0, or_low=198.0):
    """Short (PUT) entry guidance: scalp_target below entry, risk_below = or_high (stop above)."""
    return {
        "current_price": last,
        "scalp_target":  or_low - 1.0,    # 197.0 — below entry
        "target_2":      or_low - 2.0,    # 196.0
        "risk_below":    or_high,          # 202.0 — above entry (stop for PUT)
    }


def _td(suggested_action, message="Test message."):
    return {
        "suggested_action": suggested_action,
        "decision_message": message,
        "market_guidance":  "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. VERDICT MAPPING (unified verdict system)
# ─────────────────────────────────────────────────────────────────────────────

class TestVerdictMapping:
    """scan.verdict → unified verdict via Verdict.from_raw()."""

    def test_strong_go_gives_strong_go(self):
        scan = _Scan(verdict="STRONG GO", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "STRONG_GO"

    def test_go_gives_go(self):
        scan = _Scan(verdict="GO", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "GO"

    def test_watch_gives_watch(self):
        scan = _Scan(verdict="WATCH", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "WATCH"

    def test_no_go_gives_avoid(self):
        scan = _Scan(verdict="NO-GO", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "AVOID"

    def test_wait_gives_wait(self):
        scan = _Scan(verdict="WAIT", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "WAIT"

    def test_avoid_gives_avoid(self):
        scan = _Scan(verdict="AVOID", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["verdict"] == "AVOID"


# ─────────────────────────────────────────────────────────────────────────────
# 2. DIRECTION — CALL vs PUT
# ─────────────────────────────────────────────────────────────────────────────

class TestDirection:

    def test_watch_long_only_gives_call_structure(self):
        scan = _Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        )
        r = serialize_day_trade(scan)
        assert r["structure"] == "CALL · 1-2 DTE"

    def test_watch_put_breakdown_gives_put_structure(self):
        scan = _Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=_short_eg(),
            metrics=_base_metrics(),
        )
        r = serialize_day_trade(scan)
        assert r["structure"] == "PUT · 1-2 DTE"

    def test_avoid_calls_gives_call_structure(self):
        """AVOID_CALLS is a CALL-direction context (you avoid it, not trade put)."""
        scan = _Scan(
            verdict="GO",
            trader_decision=_td("AVOID_CALLS"),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        )
        r = serialize_day_trade(scan)
        # verdict=avoid → entry cleared, but structure should be CALL when set
        # (cleared because verdict=avoid)
        assert r["verdict"] == "AVOID"
        assert r["structure"] == ""   # cleared with entry plan

    def test_fallback_stop_above_entry_infers_put(self):
        """No suggested_action → stop above entry → PUT inferred."""
        m = _base_metrics()
        eg = {
            "current_price": 200.0,
            "scalp_target":  197.0,   # below entry → PUT target
            "risk_below":    203.0,   # above entry → PUT stop
        }
        scan = _Scan(verdict="GO", bias="short", trader_decision=_td(""), entry_guidance=eg, metrics=m)
        r = serialize_day_trade(scan)
        assert r["structure"] == "PUT · 1-2 DTE"

    def test_orc_structure_hint_takes_priority(self):
        """orc.structure_hint beats the direction fallback."""
        scan = _Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
            option_risk_context={"structure_hint": "Bull Call Spread · 2 DTE"},
        )
        r = serialize_day_trade(scan)
        assert r["structure"] == "Bull Call Spread · 2 DTE"


# ─────────────────────────────────────────────────────────────────────────────
# 3. STOP PRICE VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

class TestStopPrice:

    def test_call_stop_is_below_entry(self):
        """CALL trade: stop (or_low=198) must be below entry (200)."""
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(last=200.0, or_low=198.0),
            metrics=_base_metrics(last_price=200.0, or_low=198.0),
        ))
        assert r["stop_price"] is not None
        assert r["stop_price"] < r["entry_price"]

    def test_put_stop_is_above_entry(self):
        """PUT trade: stop (or_high=202) must be above entry (200)."""
        r = serialize_day_trade(_Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=_short_eg(last=200.0, or_high=202.0),
            metrics=_base_metrics(last_price=200.0, or_high=202.0),
        ))
        assert r["stop_price"] is not None
        assert r["stop_price"] > r["entry_price"]

    def test_call_direction_wrong_side_stop_corrected_to_or_low(self):
        """
        AAPL-style bug: WATCH_LONG_ONLY (CALL) but entry_guidance.risk_below
        is the or_high (above entry).  Serializer must correct to or_low.
        """
        m = _base_metrics(last_price=308.82, or_high=308.95, or_low=305.85)
        eg = {
            "current_price": 308.82,
            "risk_below":    308.95,   # wrong side — this is the PUT stop
            "scalp_target":  310.0,
        }
        scan = _Scan(
            verdict="WATCH",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["structure"] == "CALL · 1-2 DTE"
        assert r["stop_price"] == 305.85             # corrected to or_low
        assert r["stop_price"] < r["entry_price"]    # below entry

    def test_put_direction_wrong_side_stop_corrected_to_or_high(self):
        """PUT direction but stop below entry → correct to or_high."""
        m = _base_metrics(last_price=200.0, or_high=202.0, or_low=198.0)
        eg = {
            "current_price": 200.0,
            "risk_below":    198.0,   # below entry — wrong side for PUT
            "scalp_target":  197.0,
        }
        scan = _Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["stop_price"] == 202.0
        assert r["stop_price"] > r["entry_price"]

    def test_stop_nulled_when_correction_also_wrong_side(self):
        """
        If both risk_below and or_low are above entry (pathological data),
        stop is nulled — better to show '—' than garbage.
        """
        m = _base_metrics(last_price=200.0, or_high=205.0, or_low=201.0)  # or_low > entry
        eg = {
            "current_price": 200.0,
            "risk_below":    203.0,   # also above entry
            "scalp_target":  210.0,
        }
        scan = _Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["stop_price"] is None

    def test_stop_action_text_call(self):
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        ))
        stop_rows = [row for row in r["exit_rows"] if row["type"] == "stop"]
        assert stop_rows, "Expected a stop exit row"
        assert "OR Low" in stop_rows[0]["action"]

    def test_stop_action_text_put(self):
        r = serialize_day_trade(_Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=_short_eg(),
            metrics=_base_metrics(),
        ))
        stop_rows = [row for row in r["exit_rows"] if row["type"] == "stop"]
        assert stop_rows, "Expected a stop exit row"
        assert "OR High" in stop_rows[0]["action"]


# ─────────────────────────────────────────────────────────────────────────────
# 4. TARGET DIRECTION GUARD (T1 / T2)
# ─────────────────────────────────────────────────────────────────────────────

class TestTargetGuard:

    def test_call_t1_above_entry_included(self):
        """CALL: T1 (203) above entry (200) — must appear in exit_rows."""
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(last=200.0, or_high=202.0),  # scalp = 203
            metrics=_base_metrics(),
        ))
        t1_rows = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert t1_rows, "Expected T1 in exit_rows for valid CALL target"
        # Verify price string shows a value above entry
        assert "203" in t1_rows[0]["price"] or "204" in t1_rows[0]["price"]

    def test_put_t1_below_entry_included(self):
        """PUT: T1 (197) below entry (200) — must appear in exit_rows."""
        r = serialize_day_trade(_Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=_short_eg(last=200.0, or_low=198.0),  # scalp = 197
            metrics=_base_metrics(),
        ))
        t1_rows = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert t1_rows, "Expected T1 in exit_rows for valid PUT target"

    def test_call_t1_below_entry_dropped(self):
        """
        AAPL-style bug: scan has short bias so scalp_target (197) is below
        entry (200), but direction resolved to CALL — T1 must be dropped.
        """
        m = _base_metrics(last_price=200.0, or_high=202.0, or_low=197.0)
        eg = {
            "current_price": 200.0,
            "scalp_target":  197.0,   # PUT target — below entry, wrong for CALL
            "risk_below":    197.0,   # also below entry — correct stop for CALL
        }
        scan = _Scan(
            verdict="WATCH",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        t1_rows = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert not t1_rows, "T1 below entry for CALL must be dropped"

    def test_put_t1_above_entry_dropped(self):
        """PUT direction but scalp_target above entry — must be dropped."""
        m = _base_metrics(last_price=200.0, or_high=202.0, or_low=198.0)
        eg = {
            "current_price": 200.0,
            "scalp_target":  203.0,   # CALL target — above entry, wrong for PUT
            "risk_below":    202.0,   # above entry — correct stop for PUT
        }
        scan = _Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        t1_rows = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert not t1_rows, "T1 above entry for PUT must be dropped"

    def test_t2_also_direction_guarded(self):
        """T2 on wrong side is also dropped (same guard as T1)."""
        m = _base_metrics()
        eg = {
            "current_price": 200.0,
            "scalp_target":  197.0,  # wrong for CALL
            "target_2":      195.0,  # also wrong for CALL
            "risk_below":    198.0,
        }
        scan = _Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert not any(row["type"] in ("t1", "t2") for row in r["exit_rows"])

    def test_time_stop_always_present_for_active_trade(self):
        """EOD time stop must always appear for enter/watch verdicts."""
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        ))
        time_rows = [row for row in r["exit_rows"] if row["type"] == "time"]
        assert time_rows
        assert "EOD" in time_rows[0]["price"]
        assert "3:55" in time_rows[0]["action"]


# ─────────────────────────────────────────────────────────────────────────────
# 5. R/R RATIO
# ─────────────────────────────────────────────────────────────────────────────

class TestRRRatio:

    def test_rr_computed_from_actual_levels(self):
        """R/R = (T1 - entry) / (entry - stop) for CALL."""
        # entry=200, T1=203, stop=198 → R/R = 3/2 = 1.5:1
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance={
                "current_price": 200.0,
                "scalp_target":  203.0,
                "risk_below":    198.0,
            },
            metrics=_base_metrics(last_price=200.0, or_high=202.0, or_low=198.0),
        ))
        assert r["rr_ratio"] == "1.5:1"

    def test_rr_none_when_no_t1(self):
        """No valid T1 → R/R must be null, not stale engine value."""
        m = _base_metrics(entry_rr_ratio=22.9)  # stale engine value
        eg = {
            "current_price": 308.82,
            "scalp_target":  305.85,   # below entry → dropped for CALL
            "risk_below":    305.85,
        }
        scan = _Scan(
            verdict="WATCH",
            trader_decision=_td("WATCH_LONG_ONLY"),
            entry_guidance=eg,
            metrics={**m, "last_price": 308.82, "or_high": 308.95, "or_low": 305.85},
        )
        r = serialize_day_trade(scan)
        assert r["rr_ratio"] is None

    def test_rr_put_computed_correctly(self):
        """R/R for PUT = (entry - T1) / (stop - entry). entry=200, T1=197, stop=202 → 3/2 = 1.5:1"""
        r = serialize_day_trade(_Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN"),
            entry_guidance={
                "current_price": 200.0,
                "scalp_target":  197.0,
                "risk_below":    202.0,
            },
            metrics=_base_metrics(last_price=200.0, or_high=202.0, or_low=198.0),
        ))
        assert r["rr_ratio"] == "1.5:1"


# ─────────────────────────────────────────────────────────────────────────────
# 6. ENTRY PLAN CLEARED FOR WAIT / AVOID
# ─────────────────────────────────────────────────────────────────────────────

class TestEntryClearedForWaitAvoid:

    @pytest.mark.parametrize("verdict", [
        "WAIT", "NO-GO", "AVOID", "NO_EDGE",
    ])
    def test_entry_plan_null_for_non_actionable(self, verdict):
        scan = _Scan(
            verdict=verdict,
            trader_decision=_td(""),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        )
        r = serialize_day_trade(scan)
        assert r["entry_price"] is None
        assert r["stop_price"]  is None
        assert r["structure"]   == ""
        assert r["exit_rows"]   == []
        assert r["rr_ratio"]    is None

    def test_wait_verdict_no_entry(self):
        scan = _Scan(verdict="WAIT", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["entry_price"] is None
        assert r["exit_rows"]   == []

    def test_no_go_no_entry(self):
        scan = _Scan(verdict="NO-GO", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["entry_price"] is None

    def test_go_verdict_has_entry(self):
        """Sanity: GO verdict should populate entry_price."""
        scan = _Scan(verdict="GO", trader_decision=_td(""), entry_guidance=_long_eg(), metrics=_base_metrics())
        r = serialize_day_trade(scan)
        assert r["entry_price"] is not None
        assert r["verdict"] == "GO"


# ─────────────────────────────────────────────────────────────────────────────
# 7. REAL-WORLD SCENARIOS
# ─────────────────────────────────────────────────────────────────────────────

class TestRealWorldScenarios:

    def test_aapl_relative_strength_watch_long(self):
        """
        AAPL: stock green, QQQ red → RELATIVE_STRENGTH_LONG_WATCH
        suggested_action=WATCH_LONG_ONLY
        scan bias='short' (tape was bearish), scan gave wrong guidance
        → direction must resolve to CALL, stop must be or_low (below entry)
        """
        m = {**_base_metrics(last_price=308.82, or_high=308.95, or_low=305.85)}
        eg = {
            "current_price": 308.82,
            "scalp_target":  305.85,   # short-bias scalp target (wrong for CALL)
            "risk_below":    308.95,   # short-bias stop: or_high (above entry)
        }
        scan = _Scan(
            verdict="WATCH", bias="short",
            trader_decision=_td("WATCH_LONG_ONLY",
                "AAPL is green while QQQ session is red — relative strength. "
                "Watch long only if above VWAP and breaking resistance."),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["verdict"]    == "WATCH"
        assert r["structure"]  == "CALL · 1-2 DTE"
        assert r["stop_price"] == 305.85           # corrected to or_low
        assert r["stop_price"] <  r["entry_price"]
        assert r["rr_ratio"]   is None             # T1 was dropped (wrong side)
        # No T1 above entry from the short-bias scalp_target
        assert not any(row["type"] == "t1" for row in r["exit_rows"])

    def test_amzn_neutral_weak_wait(self):
        """
        AMZN: stock -0.5% → NEUTRAL_WEAK → NO_TRADE
        scan verdict=STRONG GO
        Entry plan is present for actionable verdicts.
        """
        m = _base_metrics(last_price=266.3, or_high=269.785, or_low=261.0)
        eg = {
            "current_price": 266.3,
            "scalp_target":  267.20,   # above entry
            "risk_below":    269.785,  # above entry — PUT stop
        }
        scan = _Scan(
            verdict="STRONG GO", bias="short",
            trader_decision=_td("NO_TRADE",
                "Mild weakness. Not a strong long or put candidate — wait for a cleaner setup."),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["verdict"]     == "WAIT"
        assert r["entry_price"] is None   # entry cleared for WAIT
        assert r["structure"]   == ""

    def test_nvda_weak_put_watch(self):
        """
        NVDA: stock -2.5%, below VWAP → WEAK_BREAKDOWN_WATCH
        suggested_action=WATCH_PUT_BREAKDOWN
        stop (or_high) must be above entry, T1 must be below entry.
        """
        last, or_high, or_low = 215.25, 221.01, 210.0
        m = _base_metrics(last_price=last, or_high=or_high, or_low=or_low)
        eg = {
            "current_price": last,
            "scalp_target":  or_low - 1.0,   # 209.0 — below entry ✓
            "risk_below":    or_high,          # 221.01 — above entry ✓
        }
        scan = _Scan(
            verdict="GO", bias="short",
            trader_decision=_td("WATCH_PUT_BREAKDOWN",
                "NVDA is weak and below VWAP. Put candidate only on fresh breakdown, "
                "failed bounce, or lower-low confirmation — not on hope."),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["verdict"]   == "WATCH"
        assert r["structure"] == "PUT · 1-2 DTE"
        assert r["stop_price"] > r["entry_price"]   # stop above entry for PUT
        stop_rows = [row for row in r["exit_rows"] if row["type"] == "stop"]
        assert "OR High" in stop_rows[0]["action"]
        t1_rows   = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert t1_rows
        assert float(t1_rows[0]["price"].replace("$", "").replace(",", "")) < r["entry_price"]

    def test_strong_go_long_full_plan(self):
        """
        Strong setup: STRONG GO, no TD override, CALL direction.
        All fields populated: entry, stop below entry, T1 above entry,
        time stop EOD, positive R/R.
        """
        last, or_high, or_low = 200.0, 202.0, 197.0
        # Breakout above ORH: T1 = ORH + 50% OR range = 202 + 2.5 = 204.5
        m = _base_metrics(last_price=last, or_high=or_high, or_low=or_low)
        eg = {
            "current_price": last,
            "scalp_target":  204.5,   # above entry ✓
            "target_2":      207.0,   # above entry ✓
            "risk_below":    or_low,  # 197 — below entry ✓
        }
        scan = _Scan(
            verdict="STRONG GO", bias="long",
            trader_decision=_td(""),
            entry_guidance=eg,
            metrics=m,
        )
        r = serialize_day_trade(scan)
        assert r["verdict"]    == "STRONG_GO"
        assert r["structure"]  == "CALL · 1-2 DTE"
        assert r["entry_price"] == last
        assert r["stop_price"]  == or_low
        assert r["stop_price"]  < r["entry_price"]
        t1_rows = [row for row in r["exit_rows"] if row["type"] == "t1"]
        assert t1_rows
        t1_price = float(t1_rows[0]["price"].replace("$", "").replace(",", ""))
        assert t1_price > r["entry_price"]
        assert r["rr_ratio"] is not None
        time_rows = [row for row in r["exit_rows"] if row["type"] == "time"]
        assert time_rows


# ─────────────────────────────────────────────────────────────────────────────
# 8. FIELDS THAT MUST NEVER SHOW BAD DATA
# ─────────────────────────────────────────────────────────────────────────────

class TestNeverBadData:

    def test_no_undefined_fields_on_go(self):
        """All required fields present and not None for GO verdict."""
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td(""),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        ))
        required = ["ticker", "verdict", "confidence", "reason", "structure",
                    "entry_price", "stop_price", "conditions", "exit_rows",
                    "risk_level", "coach", "trade_type"]
        for field in required:
            assert field in r, f"Missing field: {field}"
        # entry-specific
        assert r["entry_price"] > 0
        assert r["stop_price"] is not None

    def test_no_nan_in_prices(self):
        """stop_price and entry_price are never NaN."""
        import math
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td(""),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        ))
        if r["entry_price"] is not None:
            assert not math.isnan(r["entry_price"])
        if r["stop_price"] is not None:
            assert not math.isnan(r["stop_price"])

    def test_exit_rows_price_format(self):
        """exit_rows price strings start with '$' or are 'EOD'."""
        r = serialize_day_trade(_Scan(
            verdict="GO",
            trader_decision=_td(""),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
        ))
        for row in r["exit_rows"]:
            assert row["price"].startswith("$") or row["price"] == "EOD", \
                f"Bad price format in exit row: {row}"

    def test_conditions_have_valid_type(self):
        """All condition chips have type in {pass, warn, fail}."""
        scan = _Scan(
            verdict="GO",
            trader_decision=_td(""),
            entry_guidance=_long_eg(),
            metrics=_base_metrics(),
            reasons=["Strong VWAP hold", "Volume expanding", "Below opening range low — avoid"],
        )
        r = serialize_day_trade(scan)
        valid_types = {"pass", "warn", "fail"}
        for c in r["conditions"]:
            assert c["type"] in valid_types, f"Invalid condition type: {c}"

    def test_error_response_on_exception(self):
        """If scan raises an attribute error, returns error response without crashing."""
        class _BadScan:
            ticker = "ERR"
            @property
            def metrics(self): raise AttributeError("no metrics")

        r = serialize_day_trade(_BadScan())
        assert r["verdict"] == "wait"
        assert r["ticker"]  == "ERR"
        assert "error" in r["reason"].lower() or "analysis" in r["reason"].lower()
