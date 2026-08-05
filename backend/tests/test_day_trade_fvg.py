"""Unit tests for the FVG / CHoCH / order-block Smart-Money engine."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from day_trade_fvg import detect_fvgs, detect_choch, compute_fvg_strategy  # noqa: E402


def _bar(o, h, l, c, t="t"):
    return {"o": o, "h": h, "l": l, "c": c, "t": t}


def _norm(bars):
    # Attach the index the engine relies on (detect_* consume normalized bars).
    return [{"i": i, "t": str(i), "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"]} for i, b in enumerate(bars)]


def test_bullish_fvg_zone_and_midline():
    bars = _norm([
        _bar(10, 11, 9, 10.5),      # 0  candle 1 (high 11)
        _bar(10.5, 13, 10.4, 12.8), # 1  displacement
        _bar(12.8, 14, 12, 13.5),   # 2  candle 3 (low 12) -> gap [11,12]
    ])
    fvgs = detect_fvgs(bars, extend_bars=20)
    assert len(fvgs) == 1
    f = fvgs[0]
    assert f["type"] == "bullish"
    assert f["bottom"] == 11 and f["top"] == 12
    assert f["mid"] == 11.5


def test_bearish_fvg_zone():
    bars = _norm([
        _bar(13, 14, 12, 12.5),   # candle 1 (low 12)
        _bar(12.5, 12.4, 10, 10.2),
        _bar(10.2, 11, 9, 9.5),   # candle 3 (high 11) -> gap [11,12]
    ])
    fvgs = detect_fvgs(bars, extend_bars=20)
    assert len(fvgs) == 1
    assert fvgs[0]["type"] == "bearish"
    assert fvgs[0]["top"] == 12 and fvgs[0]["bottom"] == 11


def test_bullish_fvg_mitigation():
    bars = _norm([
        _bar(10, 11, 9, 10.5),
        _bar(10.5, 13, 10.4, 12.8),
        _bar(12.8, 14, 12, 13.5),   # FVG [11,12], mid 11.5
        _bar(13.5, 13.6, 13, 13.2),
        _bar(13.2, 13.3, 10.9, 11),  # low 10.9 <= bottom 11 -> mitigated here
    ])
    f = detect_fvgs(bars, extend_bars=20)[0]
    assert f["mitigated"] is True
    assert f["mitigatedIndex"] == 4
    assert f["midTouchIndex"] == 4
    assert f["endIndex"] == 4  # box stops at mitigation


def test_first_change_of_character_bullish():
    bars = _norm([
        _bar(100, 101, 99, 99.5),
        _bar(99.5, 100, 98, 98.5),
        _bar(98.5, 101, 98, 99),     # swing high 101
        _bar(99, 99.5, 97, 97.5),
        _bar(97.5, 98, 96, 96.5),
        _bar(96.5, 97, 95, 95.5),    # swing low 95
        _bar(95.5, 97, 95.4, 96.8),
        _bar(96.8, 100, 96.7, 99.8),
        _bar(99.8, 103, 99, 102.5),  # close 102.5 > 101 -> bullish CHoCH
    ])
    events = detect_choch(bars, lookback=2)
    assert events, "expected a CHoCH"
    first = events[0]
    assert first["direction"] == "bullish"
    assert first["isFirst"] is True
    assert first["index"] == 8


def test_full_strategy_bullish_reversal():
    raw = [
        _bar(100, 101, 99, 99.5),
        _bar(99.5, 100, 98, 98.5),
        _bar(98.5, 101, 98, 99),
        _bar(99, 99.5, 97, 97.5),
        _bar(97.5, 98, 96, 96.5),
        _bar(96.5, 97, 95, 95.5),    # last down candle before displacement -> bullish OB
        _bar(95.5, 97, 95.4, 96.8),  # candle 1 of FVG (high 97)
        _bar(96.8, 100, 96.7, 99.8), # displacement
        _bar(99.8, 103, 99, 102.5),  # candle 3 (low 99) -> bullish FVG [97,99] mid 98; CHoCH
    ]
    result = compute_fvg_strategy(raw, extend_bars=20, pivot_lookback=2)
    assert result["choch"] and result["choch"][0]["direction"] == "bullish"
    assert any(f["type"] == "bullish" and f["mid"] == 98 for f in result["fvgs"])
    s = result["strategy"]
    assert s["valid"] is True
    assert s["direction"] == "bullish"
    assert s["entry"] == 98      # FVG midline
    assert s["stop"] == 97       # FVG bottom
    assert result["orderBlocks"], "expected an order block at the CHoCH"


def test_not_enough_bars():
    r = compute_fvg_strategy([_bar(1, 2, 0, 1)], extend_bars=20)
    assert r["strategy"]["valid"] is False
    assert r["fvgs"] == []
