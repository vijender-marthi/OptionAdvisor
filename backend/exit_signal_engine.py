"""
Exit Signal Engine — monitors held intraday positions and emits exit signals.

Priority-1 safety layer: the entry side can wait, but a held position bleeding
through VWAP or its stop must scream. This engine is pure logic — it takes held
positions + current market data and returns ExitSignal objects. Delivery
(alerts/email/push/modal) is wired by the caller.

Severity:
  critical → exit now (VWAP broken against you, stop hit, OR broken against you, EOD)
  warning  → prepare to exit (approaching VWAP, time-stop window, target reached)
  info     → context only
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

CRITICAL = "critical"
WARNING = "warning"
INFO = "info"


@dataclass
class HeldPosition:
    ticker: str
    direction: str  # "long" or "short"
    entry_price: float
    entry_premium: float = 0.0
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    contracts: int = 1
    entry_time: Optional[datetime] = None
    position_type: str = "day"  # "day" or "swing" — swing skips intraday-only checks (VWAP/OR/EOD)
    high_water_mark: Optional[float] = None  # max price since entry (for trailing stop)
    low_water_mark: Optional[float] = None   # min price since entry (for trailing stop)


@dataclass
class ExitSignal:
    ticker: str
    severity: str
    reason: str
    recommended_action: str
    current_price: float
    current_premium: float = 0.0
    pnl_estimate: float = 0.0
    code: str = ""  # machine code: VWAP_BREAK, STOP_HIT, OR_BREAK, EOD, APPROACH_VWAP, TIME_STOP, TARGET

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "severity": self.severity,
            "reason": self.reason,
            "recommended_action": self.recommended_action,
            "current_price": round(self.current_price, 2) if self.current_price else self.current_price,
            "current_premium": round(self.current_premium, 2),
            "pnl_estimate": round(self.pnl_estimate, 2),
            "code": self.code,
        }


# Number of consecutive 5m closes through VWAP/OR required to confirm a break.
_CONFIRM_BARS = 2
# "Approaching VWAP" warning band (fraction of price).
_APPROACH_BAND = 0.005
# Minutes before the close to fire the EOD time-stop warning.
_EOD_WARN_MINUTES = 15
# Trailing stop: retracement fraction from high/low water mark that triggers a warning.
_TRAIL_RETRACEMENT = 0.01  # 1% pullback from peak → tighten/exit
# Option premium hard stop for day trades.
_PREMIUM_LOSS_PCT = 0.30
# No-progress warning after entry.
_NO_PROGRESS_MINUTES = 15
_NO_PROGRESS_MIN_FAVORABLE = 0.0015  # 0.15% underlying progress


@dataclass
class ExitSignalEngine:
    """Monitor held positions and generate exit signals."""

    confirm_bars: int = _CONFIRM_BARS
    approach_band: float = _APPROACH_BAND

    def check_positions(self, positions: list[HeldPosition], market_data: dict) -> list[ExitSignal]:
        """Return exit signals for every position that has data."""
        signals: list[ExitSignal] = []
        for pos in positions:
            data = market_data.get(pos.ticker)
            if not data:
                continue
            if (pos.direction or "").lower() == "long":
                signals.extend(self._check_long_exits(pos, data))
            else:
                signals.extend(self._check_short_exits(pos, data))
        return signals

    # ── shared helpers ─────────────────────────────────────────────────────
    def _estimate_pnl(self, pos: HeldPosition, data: dict) -> float:
        """Rough P&L in dollars from premium when available, else from underlying."""
        prem = data.get("premium")
        if prem is not None and pos.entry_premium:
            return (float(prem) - pos.entry_premium) * 100 * max(1, pos.contracts)
        price = data.get("price")
        if price is None:
            return 0.0
        sign = 1.0 if (pos.direction or "").lower() == "long" else -1.0
        return sign * (float(price) - pos.entry_price) * max(1, pos.contracts)

    def _last_closes(self, data: dict) -> list[float]:
        candles = data.get("candles_5m") or []
        return [float(c["close"]) for c in candles[-self.confirm_bars:]]

    def _eod_minutes_left(self, data: dict) -> Optional[float]:
        m = data.get("minutes_to_close")
        return float(m) if m is not None else None

    def _minutes_since_entry(self, pos: HeldPosition, data: dict) -> Optional[float]:
        if data.get("minutes_since_entry") is not None:
            return float(data["minutes_since_entry"])
        if pos.entry_time is None:
            return None
        try:
            return max(0.0, (datetime.now(pos.entry_time.tzinfo) - pos.entry_time).total_seconds() / 60.0)
        except Exception:
            return None

    # ── long exits ─────────────────────────────────────────────────────────
    def _check_long_exits(self, pos: HeldPosition, data: dict) -> list[ExitSignal]:
        out: list[ExitSignal] = []
        price = data.get("price")
        vwap = data.get("vwap")
        orl = data.get("orl") or data.get("or_low")
        pnl = self._estimate_pnl(pos, data)
        prem = float(data.get("premium") or 0)
        closes = self._last_closes(data)
        _is_day = pos.position_type == "day"

        # CRITICAL: stop hit
        if price is not None and pos.stop_price is not None and float(price) <= pos.stop_price:
            out.append(ExitSignal(pos.ticker, CRITICAL, f"Stop hit at ${pos.stop_price:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price), prem, pnl, "STOP_HIT"))

        # CRITICAL: VWAP broken (N consecutive 5m closes below VWAP) — day trades only
        if _is_day and vwap is not None and len(closes) >= self.confirm_bars and all(c < vwap for c in closes):
            out.append(ExitSignal(pos.ticker, CRITICAL,
                                  f"VWAP broken: {self.confirm_bars} consecutive 5m closes below VWAP ${vwap:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price or closes[-1]), prem, pnl, "VWAP_BREAK"))

        # CRITICAL: OR low broken against the long — day trades only
        if _is_day and orl is not None and len(closes) >= self.confirm_bars and all(c < orl for c in closes):
            out.append(ExitSignal(pos.ticker, CRITICAL,
                                  f"OR low broken: {self.confirm_bars} consecutive 5m closes below ORL ${orl:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price or closes[-1]), prem, pnl, "OR_BREAK"))

        out.extend(self._common_exits(pos, data, price, vwap, pnl, prem, above=True))
        return out

    # ── short exits (mirror) ───────────────────────────────────────────────
    def _check_short_exits(self, pos: HeldPosition, data: dict) -> list[ExitSignal]:
        out: list[ExitSignal] = []
        price = data.get("price")
        vwap = data.get("vwap")
        orh = data.get("orh") or data.get("or_high")
        pnl = self._estimate_pnl(pos, data)
        prem = float(data.get("premium") or 0)
        closes = self._last_closes(data)
        _is_day = pos.position_type == "day"

        # CRITICAL: stop hit (short stop is above entry)
        if price is not None and pos.stop_price is not None and float(price) >= pos.stop_price:
            out.append(ExitSignal(pos.ticker, CRITICAL, f"Stop hit at ${pos.stop_price:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price), prem, pnl, "STOP_HIT"))

        # CRITICAL: VWAP reclaimed against the short (N consecutive 5m closes above VWAP) — day trades only
        if _is_day and vwap is not None and len(closes) >= self.confirm_bars and all(c > vwap for c in closes):
            out.append(ExitSignal(pos.ticker, CRITICAL,
                                  f"VWAP reclaimed: {self.confirm_bars} consecutive 5m closes above VWAP ${vwap:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price or closes[-1]), prem, pnl, "VWAP_BREAK"))

        # CRITICAL: OR high reclaimed against the short — day trades only
        if _is_day and orh is not None and len(closes) >= self.confirm_bars and all(c > orh for c in closes):
            out.append(ExitSignal(pos.ticker, CRITICAL,
                                  f"OR high reclaimed: {self.confirm_bars} consecutive 5m closes above ORH ${orh:.2f}",
                                  "EXIT IMMEDIATELY at market", float(price or closes[-1]), prem, pnl, "OR_BREAK"))

        out.extend(self._common_exits(pos, data, price, vwap, pnl, prem, above=False))
        return out

    # ── shared warning/info exits ──────────────────────────────────────────
    def _common_exits(self, pos, data, price, vwap, pnl, prem, *, above: bool) -> list[ExitSignal]:
        out: list[ExitSignal] = []
        _is_day = pos.position_type == "day"

        # WARNING: approaching VWAP from the favorable side — day trades only
        if _is_day and price is not None and vwap and vwap > 0:
            dist = (float(price) - vwap) / vwap if above else (vwap - float(price)) / vwap
            if 0 < dist < self.approach_band:
                out.append(ExitSignal(pos.ticker, WARNING,
                                      f"Approaching VWAP support ${vwap:.2f} ({dist*100:.2f}% away)",
                                      "Prepare to exit if VWAP breaks", float(price), prem, pnl, "APPROACH_VWAP"))

        # WARNING: target reached (applies to both day and swing)
        if price is not None and pos.target_price is not None:
            hit = float(price) >= pos.target_price if above else float(price) <= pos.target_price
            if hit:
                out.append(ExitSignal(pos.ticker, WARNING, f"Target ${pos.target_price:.2f} reached",
                                      "Take profit — sell ½, trail the rest", float(price), prem, pnl, "TARGET"))

        # CRITICAL: option premium loss >= 30% for day trades
        if _is_day and pos.entry_premium and prem > 0:
            loss_pct = (pos.entry_premium - prem) / pos.entry_premium
            if loss_pct >= _PREMIUM_LOSS_PCT:
                out.append(ExitSignal(pos.ticker, CRITICAL,
                                      f"Option premium down {loss_pct*100:.0f}% from entry",
                                      "EXIT IMMEDIATELY — day option premium stop hit",
                                      float(price or 0), prem, pnl, "PREMIUM_LOSS"))

        # WARNING: no progress after 15 minutes
        mins_since_entry = self._minutes_since_entry(pos, data)
        if _is_day and price is not None and mins_since_entry is not None and mins_since_entry >= _NO_PROGRESS_MINUTES:
            px = float(price)
            if pos.entry_price > 0:
                favorable = (px - pos.entry_price) / pos.entry_price if above else (pos.entry_price - px) / pos.entry_price
                if favorable < _NO_PROGRESS_MIN_FAVORABLE:
                    out.append(ExitSignal(pos.ticker, WARNING,
                                          f"No meaningful progress after {int(mins_since_entry)} min",
                                          "Reduce or exit unless the next 5m candle confirms continuation",
                                          px, prem, pnl, "NO_PROGRESS"))

        # WARNING: trailing stop — price retraced from high/low water mark
        if price is not None:
            if above and pos.high_water_mark and pos.high_water_mark > 0:
                _retrace = (pos.high_water_mark - float(price)) / pos.high_water_mark
                if _retrace >= _TRAIL_RETRACEMENT:
                    out.append(ExitSignal(pos.ticker, WARNING,
                                          f"Trailing stop: price pulled back {_retrace*100:.1f}% from peak ${pos.high_water_mark:.2f}",
                                          "Tighten stop to recent swing low or exit the trailing portion",
                                          float(price), prem, pnl, "TRAILING_STOP"))
            elif not above and pos.low_water_mark and pos.low_water_mark > 0:
                _retrace = (float(price) - pos.low_water_mark) / pos.low_water_mark
                if _retrace >= _TRAIL_RETRACEMENT:
                    out.append(ExitSignal(pos.ticker, WARNING,
                                          f"Trailing stop: price bounced {_retrace*100:.1f}% from trough ${pos.low_water_mark:.2f}",
                                          "Tighten stop to recent swing high or exit the trailing portion",
                                          float(price), prem, pnl, "TRAILING_STOP"))

        # WARNING: EOD time stop — never carry a day trade overnight (day trades only)
        if _is_day:
            mins = self._eod_minutes_left(data)
            if mins is not None and 0 < mins <= _EOD_WARN_MINUTES:
                severity = CRITICAL if mins <= 5 else WARNING
                out.append(ExitSignal(pos.ticker, severity,
                                      f"Market closes in {int(mins)} min — day trade must be flat",
                                      "Close before the bell — do not hold overnight",
                                      float(price or 0), prem, pnl, "TIME_STOP"))
        return out
