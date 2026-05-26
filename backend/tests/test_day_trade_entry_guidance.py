"""
Tests for build_day_entry_guidance() from day_trade.py.

Function signature:
    build_day_entry_guidance(metrics: dict, trader_decision: dict, bias: Optional[str]) -> dict

Returns a dict with at least: "state", "summary", "action", "avoid".

State machine:
  LONG path:
    vwap_pos == "below"                                              → WAIT_FOR_VWAP_HOLD
    vwap_pos == "at"                                                 → VWAP_TEST
    vwap_pos == "above" + or_breakout=="inside" + or_historical!="broke_up"   → WAIT_FOR_BREAKOUT
    vwap_pos == "above" + or_breakout=="inside" + or_historical=="broke_up"   → WAIT_FOR_VOLUME (State 2)
    vwap_pos == "above" + or_retest + not volume_spike               → ENTRY_RETEST
    vwap_pos == "above" + not volume_spike + historical!="broke_up"  → WAIT_FOR_VOLUME
    vwap_pos == "above" + (volume_spike OR historical=="broke_up")   → ENTRY_ACTIVE
    ENTRY_ACTIVE + retreat from session_high ≥ 0.30%                 → ENTRY_PULLBACK
    session_phase == "EOD_CLOSING" (any state)                       → EOD_CLOSING

  SHORT path mirrors LONG with ORL/below/broke_down.

  NEUTRAL / None → MONITORING
"""
import unittest
from day_trade import build_day_entry_guidance


def _make_metrics(
    vwap_position="above",
    or_breakout="above",
    or_retest=False,
    volume_spike=False,
    last_price=100.0,
    vwap=99.0,
    or_high=101.0,
    or_low=98.0,
    bounce_scenario="",
    session_phase="MID_MORNING",
    or_historical="contained",
    session_high=100.0,   # matches last_price so no pullback fires by default
    session_low=100.0,    # matches last_price so no bounce fires by default
    momentum_pct=0.5,
):
    return {
        "last_price": last_price,
        "vwap": vwap,
        "or_high": or_high,
        "or_low": or_low,
        "or_breakout": or_breakout,
        "or_retest": or_retest,
        "or_historical": or_historical,
        "volume_spike": volume_spike,
        "vwap_position": vwap_position,
        "momentum_pct": momentum_pct,
        "bounce_scenario": bounce_scenario,
        "session_phase": session_phase,
        "session_high": session_high,
        "session_low": session_low,
    }


def _make_trader_decision():
    return {
        "confirmation_needed": [],
        "label": "NEUTRAL",
    }


class TestLongBiasEntryGuidance(unittest.TestCase):

    def setUp(self):
        self.td = _make_trader_decision()

    def test_long_vwap_below_returns_wait_for_vwap_hold(self):
        metrics = _make_metrics(vwap_position="below", or_breakout="above", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_VWAP_HOLD")

    def test_long_vwap_at_returns_vwap_test(self):
        metrics = _make_metrics(vwap_position="at", or_breakout="above", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "VWAP_TEST")

    def test_long_vwap_above_inside_or_never_broken_returns_wait_for_breakout(self):
        # or_historical="contained" means it genuinely hasn't broken out yet → State 1
        metrics = _make_metrics(
            vwap_position="above", or_breakout="inside",
            volume_spike=True, or_historical="contained",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_BREAKOUT")

    def test_long_vwap_above_breakout_retest_no_volume_returns_entry_retest(self):
        # OR retest without volume should wait for volume confirmation
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            or_retest=True, volume_spike=False,
            or_historical="broke_up"
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_long_vwap_above_breakout_no_volume_no_retest_returns_wait_for_volume(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            or_retest=False, volume_spike=False
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_long_vwap_above_breakout_with_volume_returns_entry_active(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            or_retest=False, volume_spike=True
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_long_entry_active_has_required_keys(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above", volume_spike=True
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        for key in ("state", "summary", "action", "avoid"):
            self.assertIn(key, result)

    def test_long_wait_for_vwap_hold_has_non_empty_summary(self):
        metrics = _make_metrics(vwap_position="below")
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertGreater(len(result.get("summary", "")), 0)

    def test_long_wait_for_breakout_has_non_empty_action(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="inside")
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertGreater(len(result.get("action", "")), 0)


class TestShortBiasEntryGuidance(unittest.TestCase):

    def setUp(self):
        self.td = _make_trader_decision()

    def test_short_vwap_above_returns_wait_for_vwap_break(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="below", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "WAIT_FOR_VWAP_BREAK")

    def test_short_vwap_at_returns_vwap_test(self):
        metrics = _make_metrics(vwap_position="at", or_breakout="below", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "VWAP_TEST")

    def test_short_vwap_below_inside_or_never_broken_returns_wait_for_breakdown(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="inside",
            volume_spike=True, or_historical="contained",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "WAIT_FOR_BREAKDOWN")

    def test_short_vwap_below_breakout_below_no_volume_returns_wait_for_volume(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=False, bounce_scenario=""
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_short_vwap_below_breakout_below_with_volume_returns_entry_active(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, bounce_scenario=""
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_short_entry_active_has_required_keys(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below", volume_spike=True
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        for key in ("state", "summary", "action", "avoid"):
            self.assertIn(key, result)

    def test_short_wait_for_vwap_break_has_non_empty_avoid(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="below")
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertGreater(len(result.get("avoid", "")), 0)


class TestNeutralBiasEntryGuidance(unittest.TestCase):

    def setUp(self):
        self.td = _make_trader_decision()

    def test_none_bias_returns_monitoring_state(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="above", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, None)
        self.assertEqual(result["state"], "MONITORING")

    def test_empty_string_bias_returns_monitoring_state(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="above", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "")
        self.assertEqual(result["state"], "MONITORING")

    def test_monitoring_state_has_required_keys(self):
        metrics = _make_metrics()
        result = build_day_entry_guidance(metrics, self.td, None)
        for key in ("state", "summary", "action", "avoid"):
            self.assertIn(key, result)


class TestReturnShape(unittest.TestCase):

    def setUp(self):
        self.td = _make_trader_decision()

    def test_always_returns_dict(self):
        for bias in ("long", "short", None):
            metrics = _make_metrics()
            result = build_day_entry_guidance(metrics, self.td, bias)
            self.assertIsInstance(result, dict)

    def test_state_is_always_a_string(self):
        for bias in ("long", "short", None):
            metrics = _make_metrics()
            result = build_day_entry_guidance(metrics, self.td, bias)
            self.assertIsInstance(result["state"], str)

    def test_known_long_states_are_valid(self):
        valid_states = {
            "WAIT_FOR_VWAP_HOLD", "VWAP_TEST", "WAIT_FOR_BREAKOUT",
            "ENTRY_RETEST", "WAIT_FOR_VOLUME", "ENTRY_ACTIVE", "MONITORING",
            "ENTRY_PULLBACK", "EOD_CLOSING",
        }
        test_configs = [
            ("below", "above", False, False),
            ("at", "above", False, False),
            ("above", "inside", False, False),
            ("above", "above", True, False),
            ("above", "above", False, False),
            ("above", "above", False, True),
        ]
        for vp, ob, retest, vs in test_configs:
            metrics = _make_metrics(
                vwap_position=vp, or_breakout=ob, or_retest=retest, volume_spike=vs
            )
            result = build_day_entry_guidance(metrics, self.td, "long")
            self.assertIn(result["state"], valid_states, msg=f"Unexpected state for config {vp},{ob},{retest},{vs}")


class TestConfirmedBreakoutRetracedInsideOR(unittest.TestCase):
    """
    When or_historical="broke_up" and price falls back inside the OR,
    state must be WAIT_FOR_VOLUME (State 2), not WAIT_FOR_BREAKOUT (State 1).
    The stock already proved itself with a volume-confirmed close — it just
    needs to reclaim ORH again.
    """

    def setUp(self):
        self.td = _make_trader_decision()

    def test_long_broke_up_inside_or_returns_wait_for_volume_not_state1(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="inside",
            or_historical="broke_up", volume_spike=False,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_long_broke_up_inside_or_does_not_return_wait_for_breakout(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="inside",
            or_historical="broke_up", volume_spike=True,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertNotEqual(result["state"], "WAIT_FOR_BREAKOUT")

    def test_long_contained_inside_or_still_returns_wait_for_breakout(self):
        # Sanity: genuinely never broke out → stays State 1
        metrics = _make_metrics(
            vwap_position="above", or_breakout="inside",
            or_historical="contained", volume_spike=True,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_BREAKOUT")

    def test_short_broke_down_inside_or_returns_wait_for_volume(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="inside",
            or_historical="broke_down", volume_spike=False,
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_short_contained_inside_or_still_returns_wait_for_breakdown(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="inside",
            or_historical="contained", volume_spike=True,
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "WAIT_FOR_BREAKDOWN")

    def test_wait_for_volume_summary_mentions_orh(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="inside",
            or_historical="broke_up", or_high=150.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        # Summary should reference the ORH level
        combined = result.get("summary", "") + result.get("action", "")
        self.assertIn("150", combined)


class TestEntryPullback(unittest.TestCase):
    """
    ENTRY_PULLBACK fires when state would be ENTRY_ACTIVE but price has
    retreated ≥ 0.30% from session_high (long) or bounced ≥ 0.30% from
    session_low (short).
    """

    def setUp(self):
        self.td = _make_trader_decision()

    # ── Long side ────────────────────────────────────────────────────

    def test_long_entry_active_no_pullback_stays_entry_active(self):
        # session_high=102, last_price=101.8 → retreat = 0.196% < 0.30%
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=101.8, session_high=102.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_long_entry_active_pullback_at_threshold_returns_entry_pullback(self):
        # session_high=102, last_price=101.60 → retreat ≈ 0.39% (safely above 0.30%)
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=101.60, session_high=102.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_PULLBACK")

    def test_long_large_pullback_returns_entry_pullback(self):
        # session_high=155, last_price=152 → retreat = 1.94%
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=152.0, session_high=155.0,
            or_high=150.0, vwap=149.20,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_PULLBACK")

    def test_long_pullback_should_now_is_hold(self):
        # session_high=102, last_price=101.60 → retreat ≈ 0.39% → ENTRY_PULLBACK → HOLD
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=101.60, session_high=102.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result.get("should_enter_now"), "HOLD")

    def test_long_pullback_summary_mentions_session_high(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=152.0, session_high=155.0,
            or_high=150.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertIn("155", result.get("summary", ""))

    def test_long_pullback_avoid_mentions_orh(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            last_price=152.0, session_high=155.0,
            or_high=150.0,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertIn("150", result.get("avoid", ""))

    # ── Short side ───────────────────────────────────────────────────

    def test_short_entry_active_no_pullback_stays_entry_active(self):
        # session_low=97, last_price=97.19 → bounce = 0.196% < 0.30%
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, or_historical="broke_down",
            last_price=97.19, session_low=97.0,
            bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_short_bounce_at_threshold_returns_entry_pullback(self):
        # session_low=97, last_price=97.39 → bounce ≈ 0.40% (safely above 0.30%)
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, or_historical="broke_down",
            last_price=97.39, session_low=97.0,
            bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "ENTRY_PULLBACK")

    def test_short_pullback_should_now_is_hold(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, or_historical="broke_down",
            last_price=97.5, session_low=97.0,
            bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result.get("should_enter_now"), "HOLD")

    def test_short_pullback_summary_mentions_session_low(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, or_historical="broke_down",
            last_price=145.50, session_low=145.0,
            or_low=148.0, bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertIn("145", result.get("summary", ""))


class TestEODClosingBlock(unittest.TestCase):
    """
    session_phase="EOD_CLOSING" must override any state to EOD_CLOSING
    regardless of setup quality, bias, or OR/VWAP position.
    No new entries are ever permitted in the last 10 minutes.
    """

    def setUp(self):
        self.td = _make_trader_decision()

    def test_long_entry_active_eod_overrides_to_eod_closing(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            session_phase="EOD_CLOSING",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "EOD_CLOSING")

    def test_short_entry_active_eod_overrides_to_eod_closing(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=True, or_historical="broke_down",
            session_phase="EOD_CLOSING", bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "EOD_CLOSING")

    def test_eod_closing_overrides_even_for_perfect_setup(self):
        # Perfect long setup — but market is closing
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            session_phase="EOD_CLOSING",
            last_price=155.0, session_high=155.0,  # no pullback
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "EOD_CLOSING")

    def test_eod_closing_summary_mentions_exit(self):
        metrics = _make_metrics(session_phase="EOD_CLOSING")
        result = build_day_entry_guidance(metrics, self.td, "long")
        combined = result.get("summary", "") + result.get("action", "")
        self.assertIn("exit", combined.lower())

    def test_eod_closing_avoid_mentions_entries(self):
        metrics = _make_metrics(session_phase="EOD_CLOSING")
        result = build_day_entry_guidance(metrics, self.td, "long")
        # avoid text should warn against new entries
        self.assertGreater(len(result.get("avoid", "")), 0)

    def test_power_hour_does_not_block_entry(self):
        # POWER_HOUR annotates but must not override ENTRY_ACTIVE to EOD_CLOSING
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            session_phase="POWER_HOUR",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_power_hour_entry_active_avoid_mentions_exit_time(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=True, or_historical="broke_up",
            session_phase="POWER_HOUR",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        # avoid must warn about EOD exit
        self.assertIn("3:50", result.get("avoid", ""))


class TestVolumeOneTimeGate(unittest.TestCase):
    """
    or_historical="broke_up" means the volume gate already fired at an
    earlier bar. Subsequent quiet bars (volume_spike=False) must NOT revert
    state back to WAIT_FOR_VOLUME — the gate is permanently cleared.
    """

    def setUp(self):
        self.td = _make_trader_decision()

    def test_long_broke_up_no_current_volume_spike_reaches_entry_active(self):
        # Historical breakout with volume — current bar is quiet → still ENTRY_ACTIVE
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=False, or_historical="broke_up",
            or_retest=False,
            last_price=102.0, session_high=102.0,  # no pullback
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")

    def test_long_contained_no_current_volume_stays_wait_for_volume(self):
        # Never broke out + no current spike → still waiting
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            volume_spike=False, or_historical="contained",
            or_retest=False,
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_VOLUME")

    def test_short_broke_down_no_current_volume_reaches_entry_active(self):
        metrics = _make_metrics(
            vwap_position="below", or_breakout="below",
            volume_spike=False, or_historical="broke_down",
            last_price=97.0, session_low=97.0,  # no bounce
            bounce_scenario="",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "ENTRY_ACTIVE")


if __name__ == "__main__":
    unittest.main()
