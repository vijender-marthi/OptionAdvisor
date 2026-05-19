"""
Tests for _compute_exit_rules() from swing_trade.py.

Function signature:
    _compute_exit_rules(
        exec_levels: dict,
        ma20: float,
        bias: Optional[str],
        entry_quality: str,
        risk_level: str,
    ) -> list[dict]

Each rule has keys: "trigger", "price", "action", "note".
Rules ordering (long): T1 partial exit → T2 full exit → MA20 → [stall] → stop
Rules ordering (short): T1 cover half → T2 full cover → MA20 → [stall] → stop

Stall rule fires when risk_level in ("HIGH", "VERY_HIGH").
"""
import unittest
from swing_trade import _compute_exit_rules


def _make_exec_levels_long():
    return {
        "breakout": 100.0,
        "target1": 110.0,
        "target2": 120.0,
        "stop": 95.0,
    }


def _make_exec_levels_short():
    return {
        "breakout": 100.0,
        "target1": 90.0,
        "target2": 80.0,
        "stop": 105.0,
    }


class TestEmptyAndInvalidInputs(unittest.TestCase):

    def test_empty_exec_levels_returns_empty_list(self):
        result = _compute_exit_rules({}, 100.0, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_none_exec_levels_returns_empty_list(self):
        result = _compute_exit_rules(None, 100.0, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_bias_none_returns_empty_list(self):
        result = _compute_exit_rules(_make_exec_levels_long(), 100.0, None, "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_bias_neutral_returns_empty_list(self):
        result = _compute_exit_rules(_make_exec_levels_long(), 100.0, "neutral", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_missing_stop_returns_empty_list(self):
        levels = {"breakout": 100.0, "target1": 110.0, "target2": 120.0}
        result = _compute_exit_rules(levels, 100.0, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_missing_target1_returns_empty_list(self):
        levels = {"breakout": 100.0, "target2": 120.0, "stop": 95.0}
        result = _compute_exit_rules(levels, 100.0, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])

    def test_missing_breakout_returns_empty_list(self):
        levels = {"target1": 110.0, "target2": 120.0, "stop": 95.0}
        result = _compute_exit_rules(levels, 100.0, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(result, [])


class TestLongBiasRules(unittest.TestCase):

    def setUp(self):
        self.levels = _make_exec_levels_long()
        self.ma20 = 98.0

    def test_long_good_entry_low_risk_returns_four_rules(self):
        # T1 + T2 + MA20 + Stop = 4 base rules (no stall rule)
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        self.assertEqual(len(rules), 4)

    def test_long_good_entry_high_risk_returns_five_rules(self):
        # T1 + T2 + MA20 + stall + Stop = 5 rules
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "HIGH")
        self.assertEqual(len(rules), 5)

    def test_long_good_entry_very_high_risk_returns_five_rules(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "VERY_HIGH")
        self.assertEqual(len(rules), 5)

    def test_long_t1_price_less_than_t2_price(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        t2_rule = next(r for r in rules if "Target 2" in r["trigger"])
        self.assertLess(t1_rule["price"], t2_rule["price"])

    def test_long_stop_price_less_than_t1_price(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        stop_rule = next(r for r in rules if "Stop loss" in r["trigger"])
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        self.assertLess(stop_rule["price"], t1_rule["price"])

    def test_long_ma20_rule_always_present(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        ma20_rule = next((r for r in rules if "MA20" in r["trigger"]), None)
        self.assertIsNotNone(ma20_rule)

    def test_long_ma20_rule_price_equals_ma20(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        ma20_rule = next(r for r in rules if "MA20" in r["trigger"])
        self.assertAlmostEqual(ma20_rule["price"], round(self.ma20, 2), places=2)

    def test_long_stop_rule_price_equals_stop_level(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        stop_rule = next(r for r in rules if "Stop loss" in r["trigger"])
        self.assertAlmostEqual(stop_rule["price"], self.levels["stop"], places=2)

    def test_long_t1_rule_price_equals_target1(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        self.assertAlmostEqual(t1_rule["price"], self.levels["target1"], places=2)

    def test_long_low_risk_no_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "LOW")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertEqual(len(stall_rules), 0)

    def test_long_high_risk_has_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "HIGH")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertGreater(len(stall_rules), 0)

    def test_long_very_high_risk_has_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "VERY_HIGH")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertGreater(len(stall_rules), 0)

    def test_all_rules_have_required_keys(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "HIGH")
        for rule in rules:
            self.assertIn("trigger", rule)
            self.assertIn("price", rule)
            self.assertIn("action", rule)
            self.assertIn("note", rule)

    def test_all_rule_prices_are_floats(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "GOOD_ENTRY", "HIGH")
        for rule in rules:
            self.assertIsInstance(rule["price"], (int, float))

    def test_long_caution_entry_also_returns_rules(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "long", "CAUTION_ENTRY", "LOW")
        self.assertGreater(len(rules), 0)


class TestShortBiasRules(unittest.TestCase):

    def setUp(self):
        self.levels = _make_exec_levels_short()
        self.ma20 = 102.0

    def test_short_good_entry_low_risk_returns_four_rules(self):
        # T1 + T2 + MA20 + Stop = 4 base rules (no stall rule)
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        self.assertEqual(len(rules), 4)

    def test_short_good_entry_high_risk_returns_five_rules(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "HIGH")
        self.assertEqual(len(rules), 5)

    def test_short_good_entry_very_high_risk_returns_five_rules(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "VERY_HIGH")
        self.assertEqual(len(rules), 5)

    def test_short_t1_price_greater_than_t2_price(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        t2_rule = next(r for r in rules if "Target 2" in r["trigger"])
        self.assertGreater(t1_rule["price"], t2_rule["price"])

    def test_short_stop_price_greater_than_t1_price(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        stop_rule = next(r for r in rules if "Stop loss" in r["trigger"])
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        self.assertGreater(stop_rule["price"], t1_rule["price"])

    def test_short_ma20_rule_always_present(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        ma20_rule = next((r for r in rules if "MA20" in r["trigger"]), None)
        self.assertIsNotNone(ma20_rule)

    def test_short_low_risk_no_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertEqual(len(stall_rules), 0)

    def test_short_high_risk_has_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "HIGH")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertGreater(len(stall_rules), 0)

    def test_short_very_high_risk_has_stall_rule(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "VERY_HIGH")
        stall_rules = [r for r in rules if "stalls" in r["trigger"].lower()]
        self.assertGreater(len(stall_rules), 0)

    def test_all_short_rules_have_required_keys(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "HIGH")
        for rule in rules:
            self.assertIn("trigger", rule)
            self.assertIn("price", rule)
            self.assertIn("action", rule)
            self.assertIn("note", rule)

    def test_short_stop_price_equals_stop_level(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        stop_rule = next(r for r in rules if "Stop loss" in r["trigger"])
        self.assertAlmostEqual(stop_rule["price"], self.levels["stop"], places=2)

    def test_short_t1_rule_price_equals_target1(self):
        rules = _compute_exit_rules(self.levels, self.ma20, "short", "GOOD_ENTRY", "LOW")
        t1_rule = next(r for r in rules if "Target 1" in r["trigger"] and "stalls" not in r["trigger"].lower())
        self.assertAlmostEqual(t1_rule["price"], self.levels["target1"], places=2)


class TestRulesAreReturnedAsList(unittest.TestCase):

    def test_returns_list_type(self):
        result = _compute_exit_rules(_make_exec_levels_long(), 98.0, "long", "GOOD_ENTRY", "LOW")
        self.assertIsInstance(result, list)

    def test_each_rule_is_dict(self):
        rules = _compute_exit_rules(_make_exec_levels_long(), 98.0, "long", "GOOD_ENTRY", "LOW")
        for rule in rules:
            self.assertIsInstance(rule, dict)


if __name__ == "__main__":
    unittest.main()
