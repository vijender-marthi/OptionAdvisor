import unittest

from active_trade_decision import build_active_trade_decision


MC = {
    "spy_change_pct": 0.2,
    "qqq_change_pct": 0.1,
    "vix": 18.0,
}


def _base_intra(**kwargs):
    d = {
        "underlying_last": 100.0,
        "vwap": 99.0,
        "or_high": 101.0,
        "or_low": 98.5,
        "or_breakout": "inside",
        "momentum_pct": 0.1,
        "volume_spike": False,
        "rs_vs_qqq_pct": 0.2,
    }
    d.update(kwargs)
    return d


class TestActiveTradeDecision(unittest.TestCase):
    def test_call_hold_breakout(self) -> None:
        row = {"side": "CALL", "ticker": "X", "entry_price": 1.5, "opened_at_ms": 1}
        intra = _base_intra(or_breakout="above", underlying_last=102.0, vwap=100.0, or_high=101.0, or_low=98.0)
        out = build_active_trade_decision(row, MC, intra)
        self.assertEqual(out["state"], "HOLD_BREAKOUT")
        self.assertEqual(out["action"], "Hold")
        self.assertEqual(out["badge_tone"], "green")

    def test_call_exit_below_or(self) -> None:
        row = {"side": "CALL", "ticker": "X", "entry_price": 1.5, "opened_at_ms": 1}
        intra = _base_intra(or_breakout="below", underlying_last=97.0, vwap=99.0, or_low=98.5)
        out = build_active_trade_decision(row, MC, intra)
        self.assertEqual(out["state"], "EXIT_WEAKNESS")
        self.assertEqual(out["action"], "Consider exit / trim")

    def test_call_waiting(self) -> None:
        row = {"side": "CALL", "ticker": "X", "entry_price": 1.5, "opened_at_ms": 1}
        intra = _base_intra(
            or_breakout="inside",
            underlying_last=100.5,
            vwap=100.0,
            or_high=101.0,
            or_low=98.5,
            momentum_pct=-0.08,
        )
        out = build_active_trade_decision(row, MC, intra)
        self.assertEqual(out["state"], "WAITING_FOR_BREAKOUT")
        self.assertEqual(out["action"], "Wait")

    def test_put_hold_breakdown(self) -> None:
        row = {"side": "PUT", "ticker": "X", "entry_price": 1.5, "opened_at_ms": 1}
        intra = _base_intra(
            or_breakout="below",
            underlying_last=96.0,
            vwap=97.0,
            or_low=97.5,
            or_high=101.0,
            volume_spike=True,
        )
        out = build_active_trade_decision(row, MC, intra)
        self.assertEqual(out["state"], "HOLD_BREAKDOWN")
        self.assertEqual(out["badge_tone"], "green")

    def test_put_wait_breakdown_copy(self) -> None:
        row = {"side": "PUT", "ticker": "X", "entry_price": 1.5, "opened_at_ms": 1}
        intra = _base_intra(
            or_breakout="inside",
            underlying_last=100.0,
            vwap=99.0,
            or_low=97.0,
            or_high=101.0,
            momentum_pct=0.05,
        )
        out = build_active_trade_decision(row, MC, intra)
        self.assertEqual(out["state"], "WAITING_FOR_BREAKOUT")
        self.assertEqual(out["action"], "Wait")

    def test_missing_tape(self) -> None:
        row = {"side": "CALL", "ticker": "X", "entry_price": 1.0, "opened_at_ms": 1}
        out = build_active_trade_decision(row, MC, {"vwap": None})
        self.assertEqual(out["state"], "NO_ACTION")
        self.assertEqual(out["action"], "No action")


if __name__ == "__main__":
    unittest.main()
