import unittest

from day_trade_trap_detection import DayTradeTrapDetectionEngine, TrapDetectionConfig


def _bars_for_bull(*, break_minute: int = 10, after=None):
    rows = [
        {"t": "2026-07-13T09:30:00-04:00", "o": 99, "h": 100, "l": 98, "c": 99, "v": 1000},
        {"t": f"2026-07-13T{9 + ((30 + break_minute) // 60):02d}:{(30 + break_minute) % 60:02d}:00-04:00", "o": 100, "h": 105, "l": 99, "c": 104, "v": 800},
    ]
    rows.extend(after or [])
    return rows


def _bars_for_bear(*, break_minute: int = 10, after=None):
    rows = [
        {"t": "2026-07-13T09:30:00-04:00", "o": 101, "h": 102, "l": 100, "c": 101, "v": 1000},
        {"t": f"2026-07-13T{9 + ((30 + break_minute) // 60):02d}:{(30 + break_minute) % 60:02d}:00-04:00", "o": 100, "h": 101, "l": 95, "c": 96, "v": 800},
    ]
    rows.extend(after or [])
    return rows


def _bull_snapshot(**overrides):
    data = {
        "ticker": "AAPL",
        "bars": _bars_for_bull(),
        "orHigh": 102,
        "orLow": 98,
        "tickerChangePct": 0.6,
        "spyChangePct": -0.3,
        "qqqChangePct": -0.4,
        "sectorEtf": "XLK",
        "sectorChangePct": -0.5,
        "average20BarVolume": 1000,
        "breakoutBarVolume": 800,
        "intradaySigma": 2,
        "putCallRatio": 0.42,
        "putCallFresh": True,
        "isWatched": True,
    }
    data.update(overrides)
    return data


def _bear_snapshot(**overrides):
    data = {
        "ticker": "AAPL",
        "bars": _bars_for_bear(),
        "orHigh": 102,
        "orLow": 98,
        "tickerChangePct": -0.6,
        "spyChangePct": 0.3,
        "qqqChangePct": 0.4,
        "sectorEtf": "XLK",
        "sectorChangePct": 0.5,
        "average20BarVolume": 1000,
        "breakoutBarVolume": 800,
        "intradaySigma": 2,
        "putCallRatio": 1.7,
        "putCallFresh": True,
        "isWatched": True,
    }
    data.update(overrides)
    return data


def _points(result, code):
    for factor in result["factors"]:
        if factor["code"] == code:
            return factor["earnedPoints"]
    raise AssertionError(f"Missing factor {code}")


class DayTradeTrapDetectionTests(unittest.TestCase):
    def test_bull_trap_scoring_factors(self):
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot())
        self.assertEqual(_points(result, "EARLY_ORH_BREAK"), 25)
        self.assertEqual(_points(result, "INDEX_DIVERGENCE_BULL"), 20)
        self.assertEqual(_points(result, "SECTOR_DIVERGENCE_BULL"), 15)
        self.assertEqual(_points(result, "LOW_BREAKOUT_PARTICIPATION"), 15)
        self.assertEqual(_points(result, "BLOW_OFF_EXTENSION_BULL"), 10)
        self.assertEqual(_points(result, "CROWDED_BULLISH_OPTIONS"), 10)

    def test_bull_reversion_hours_factor(self):
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(bars=_bars_for_bull(break_minute=155)))
        self.assertEqual(_points(result, "REVERSION_HOURS_BULL"), 5)

    def test_bull_all_factors_can_score_100_with_custom_or_window(self):
        engine = DayTradeTrapDetectionEngine(TrapDetectionConfig(openingRangeMinutes=200))
        result = engine.evaluate(_bull_snapshot(bars=_bars_for_bull(break_minute=155)))
        self.assertEqual(result["score"], 100)

    def test_bear_trap_scoring_factors(self):
        result = DayTradeTrapDetectionEngine().evaluate(_bear_snapshot())
        self.assertEqual(_points(result, "EARLY_ORL_BREAK"), 25)
        self.assertEqual(_points(result, "INDEX_DIVERGENCE_BEAR"), 20)
        self.assertEqual(_points(result, "SECTOR_DIVERGENCE_BEAR"), 15)
        self.assertEqual(_points(result, "LOW_BREAKDOWN_PARTICIPATION"), 15)
        self.assertEqual(_points(result, "BLOW_OFF_EXTENSION_BEAR"), 10)
        self.assertEqual(_points(result, "CROWDED_BEARISH_OPTIONS"), 10)

    def test_missing_data_contributes_zero_and_reports_completeness(self):
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(
            putCallRatio=None,
            sectorEtf=None,
            sectorChangePct=None,
            average20BarVolume=None,
        ))
        self.assertEqual(_points(result, "CROWDED_BULLISH_OPTIONS"), 0)
        self.assertEqual(_points(result, "SECTOR_DIVERGENCE_BULL"), 0)
        self.assertEqual(_points(result, "LOW_BREAKOUT_PARTICIPATION"), 0)
        self.assertLess(result["dataCompleteness"], 1.0)
        self.assertIn("Put/call ratio", result["missingInputs"])

    def test_state_thresholds(self):
        engine = DayTradeTrapDetectionEngine()
        watch = engine.evaluate(_bull_snapshot(
            spyChangePct=0.1,
            qqqChangePct=0.1,
            sectorChangePct=0.1,
            putCallRatio=0.8,
            intradaySigma=10,
        ))
        self.assertEqual(watch["score"], 40)
        self.assertEqual(watch["state"], "BULL_TRAP_WATCH")

        warning = engine.evaluate(_bull_snapshot(sectorChangePct=0.1, putCallRatio=0.8, intradaySigma=10))
        self.assertEqual(warning["score"], 60)
        self.assertEqual(warning["state"], "BULL_TRAP_WARNING")

        critical = engine.evaluate(_bull_snapshot())
        self.assertEqual(critical["state"], "BULL_TRAP_CRITICAL")

    def test_close_back_inside_or_confirms_trap(self):
        bars = _bars_for_bull(after=[
            {"t": "2026-07-13T09:45:00-04:00", "o": 104, "h": 104.5, "l": 101, "c": 102, "v": 900},
        ])
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(bars=bars))
        self.assertEqual(result["resolution"]["status"], "TRAP_CONFIRMED")
        self.assertEqual(result["state"], "BULL_TRAP_CONFIRMED")

    def test_two_qualifying_closes_confirm_continuation(self):
        bars = _bars_for_bull(after=[
            {"t": "2026-07-13T09:45:00-04:00", "o": 104, "h": 106, "l": 103, "c": 105, "v": 1300, "avg20Volume": 1000},
            {"t": "2026-07-13T09:50:00-04:00", "o": 105, "h": 107, "l": 104, "c": 106, "v": 1400, "avg20Volume": 1000},
        ])
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(bars=bars))
        self.assertEqual(result["resolution"]["status"], "CONTINUATION_CONFIRMED")
        self.assertEqual(result["state"], "BULL_CONTINUATION_CONFIRMED")

    def test_event_expires_after_resolution_window(self):
        after = [
            {"t": f"2026-07-13T09:{45 + i * 5:02d}:00-04:00", "o": 104, "h": 105, "l": 103, "c": 104, "v": 900, "avg20Volume": 1000}
            for i in range(7)
        ]
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(bars=_bars_for_bull(after=after)))
        self.assertEqual(result["resolution"]["status"], "EXPIRED")
        self.assertEqual(result["state"], "EXPIRED")

    def test_position_risk_and_notification(self):
        result = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(isHeld=True, positionDirection="BULLISH"))
        self.assertTrue(result["positionRisk"]["isExposedToTrap"])
        self.assertTrue(result["notification"]["eligible"])
        self.assertEqual(result["notification"]["priority"], "high")

        untracked = DayTradeTrapDetectionEngine().evaluate(_bull_snapshot(isWatched=False, isHeld=False))
        self.assertFalse(untracked["notification"]["eligible"])


if __name__ == "__main__":
    unittest.main()
