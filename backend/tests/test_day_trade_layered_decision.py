import unittest

from day_trade import build_layered_day_trade_decision


def _base_metrics(**overrides):
    metrics = {
        "opening_type": "TREND_DAY",
        "opening_playbook": "TREND",
        "or_breakout": "below",
        "or_historical": "broke_down",
        "vwap_position": "BELOW",
        "price_structure": "LL_LH",
        "momentum_pct": -0.35,
        "vwap_slope_pct": -0.12,
        "vwap_macro_slope_pct": -0.18,
        "rvol": 1.6,
        "entry_rr_ratio": 1.6,
        "daily_range_phase": "MID",
        "trigger_requirement": "Break current lower low with volume.",
    }
    metrics.update(overrides)
    return metrics


def _tf(exec_status="WAIT_ENTRY", conf_status="PENDING"):
    return {
        "confirmation_5m": {
            "status": conf_status,
            "next_action": "Wait for 5m confirmation.",
        },
        "execution_1m": {
            "status": exec_status,
            "reason": "Waiting for lower-low break.",
            "next_action": "Break current lower low.",
        },
    }


class LayeredDayTradeDecisionTests(unittest.TestCase):
    def test_bear_trend_without_execution_is_watch_not_no_edge(self):
        result = build_layered_day_trade_decision(
            ticker="MRVL",
            bias="short",
            metrics=_base_metrics(),
            timeframe_state=_tf(),
            entry_guidance={"should_enter_now": "NO"},
            market_state_engine={"state": "WAIT_PULLBACK", "next_action": "Wait first pullback."},
            trigger_setup="ORL_BREAKDOWN",
            trigger_fired=False,
            volume_spike=True,
            is_chasing=False,
            edge_state="MID",
            chase_reason="",
        )

        self.assertEqual(result["market_state"]["label"], "Bear Trend")
        self.assertEqual(result["market_structure"]["sequence"], ["LH", "LL", "LH", "LL"])
        self.assertEqual(result["final_decision"]["action"], "WATCH")
        self.assertGreaterEqual(result["final_decision"]["confidence"], 60)

    def test_ready_execution_can_go(self):
        result = build_layered_day_trade_decision(
            ticker="MRVL",
            bias="short",
            metrics=_base_metrics(),
            timeframe_state=_tf(exec_status="READY", conf_status="CONFIRMED"),
            entry_guidance={"should_enter_now": "YES"},
            market_state_engine={"state": "EXECUTE", "next_action": "Execute with stop."},
            trigger_setup="ORL_BREAKDOWN",
            trigger_fired=True,
            volume_spike=True,
            is_chasing=False,
            edge_state="MID",
            chase_reason="",
        )

        self.assertEqual(result["final_decision"]["action"], "GO")
        self.assertGreaterEqual(result["score_breakdown"]["execution"], 90)

    def test_chasing_overrides_to_do_not_chase(self):
        result = build_layered_day_trade_decision(
            ticker="MRVL",
            bias="short",
            metrics=_base_metrics(daily_range_phase="EXHAUSTED"),
            timeframe_state=_tf(exec_status="DO_NOT_CHASE", conf_status="CONFIRMED"),
            entry_guidance={"should_enter_now": "NO"},
            market_state_engine={"state": "DO_NOT_CHASE", "next_action": "Wait reset."},
            trigger_setup="ORL_BREAKDOWN",
            trigger_fired=True,
            volume_spike=True,
            is_chasing=True,
            edge_state="EXHAUSTED",
            chase_reason="Price is extended.",
        )

        self.assertEqual(result["final_decision"]["action"], "DO_NOT_CHASE")
        self.assertIn("pullback", result["final_decision"]["next_condition"].lower())


if __name__ == "__main__":
    unittest.main()
