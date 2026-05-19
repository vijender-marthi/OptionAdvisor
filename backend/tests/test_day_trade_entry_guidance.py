"""
Tests for build_day_entry_guidance() from day_trade.py.

Function signature:
    build_day_entry_guidance(metrics: dict, trader_decision: dict, bias: Optional[str]) -> dict

Returns a dict with at least: "state", "summary", "action", "avoid".

State machine (day_trade.py lines 463-602):
  LONG path:
    vwap_pos == "below"                                   → WAIT_FOR_VWAP_HOLD
    vwap_pos == "at"                                      → VWAP_TEST
    vwap_pos == "above" + or_breakout == "inside"         → WAIT_FOR_BREAKOUT
    vwap_pos == "above" + or_retest + not volume_spike    → ENTRY_RETEST
    vwap_pos == "above" + not volume_spike                → WAIT_FOR_VOLUME
    vwap_pos == "above" + volume_spike                    → ENTRY_ACTIVE

  SHORT path:
    vwap_pos == "above"                                   → WAIT_FOR_VWAP_BREAK
    vwap_pos == "at"                                      → VWAP_TEST
    vwap_pos == "below" + or_breakout == "inside"         → WAIT_FOR_BREAKDOWN
    vwap_pos == "below" + no volume_spike                 → WAIT_FOR_VOLUME
    vwap_pos == "below" + volume_spike                    → ENTRY_ACTIVE

  NEUTRAL / None:
    default state                                         → MONITORING
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
    session_phase="NORMAL",
):
    return {
        "last_price": last_price,
        "vwap": vwap,
        "or_high": or_high,
        "or_low": or_low,
        "or_breakout": or_breakout,
        "or_retest": or_retest,
        "volume_spike": volume_spike,
        "vwap_position": vwap_position,
        "momentum_pct": 0.5,
        "bounce_scenario": bounce_scenario,
        "session_phase": session_phase,
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

    def test_long_vwap_above_inside_or_returns_wait_for_breakout(self):
        metrics = _make_metrics(vwap_position="above", or_breakout="inside", volume_spike=True)
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "WAIT_FOR_BREAKOUT")

    def test_long_vwap_above_breakout_retest_no_volume_returns_entry_retest(self):
        metrics = _make_metrics(
            vwap_position="above", or_breakout="above",
            or_retest=True, volume_spike=False
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "ENTRY_RETEST")

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

    def test_short_vwap_below_inside_or_returns_wait_for_breakdown(self):
        metrics = _make_metrics(vwap_position="below", or_breakout="inside", volume_spike=True)
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


if __name__ == "__main__":
    unittest.main()
