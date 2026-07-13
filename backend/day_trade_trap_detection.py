"""Backend-owned Day Trade trap detection.

This module is intentionally isolated from API handlers and React. It consumes
the already-computed Day Trade opening-range and intraday metrics, evaluates
trap risk, and returns a presentation-ready DTO with evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


TRAP_ENGINE_VERSION = "day-trade-trap-detection-2026.07"
TRAP_CONFIG_VERSION = "day-trade-trap-config-2026.07"


@dataclass(frozen=True)
class TrapDetectionConfig:
    enabled: bool = True
    shadowMode: bool = False
    visualMode: bool = True
    notificationMode: bool = False
    warningThreshold: int = 60
    criticalThreshold: int = 80
    volumeParticipationThreshold: float = 1.2
    blowOffSigmaThreshold: float = 1.0
    blowOffWindowBars: int = 3
    resolutionWindowBars: int = 6
    realMoveConfirmationBars: int = 2
    bullishPutCallExtreme: float = 0.5
    bearishPutCallExtreme: float = 1.5
    reversionHoursStartMinutes: int = 150
    openingRangeMinutes: int = 15
    notificationCooldownMinutes: int = 30
    sameEventScoreIncreaseThreshold: int = 10


DEFAULT_CONFIG = TrapDetectionConfig()


def _num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _bar_time(bar: dict[str, Any]) -> str:
    return str(bar.get("t") or bar.get("time") or "")


def _minutes_since_open(bar: dict[str, Any], fallback_index: int) -> int:
    parsed = _parse_time(_bar_time(bar))
    if parsed is None:
        return fallback_index * 5
    open_time = parsed.replace(hour=9, minute=30, second=0, microsecond=0)
    return max(0, int((parsed - open_time).total_seconds() // 60))


def _bar_price(bar: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        n = _num(bar.get(key))
        if n is not None:
            return n
    return None


def _format_pct(value: float | None) -> str:
    if value is None:
        return "unavailable"
    return f"{value:+.2f}%"


def _format_price(value: float | None) -> str:
    if value is None:
        return "unavailable"
    return f"${value:.2f}"


def _input(label: str, value: Any, display: str | None = None, source: str = "day_trade_metrics") -> dict[str, Any]:
    return {"label": label, "value": value, "display": display if display is not None else str(value), "source": source}


def _factor(
    *,
    code: str,
    label: str,
    description: str,
    points: int,
    active: bool,
    available: bool,
    evidence: str,
    inputs: list[dict[str, Any]] | None = None,
    formula: str = "",
    source: str = "day_trade_trap_detection",
) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "description": description,
        "points": points,
        "earnedPoints": points if active and available else 0,
        "active": bool(active and available),
        "available": available,
        "displayEvidence": evidence,
        "formula": formula,
        "inputs": inputs or [],
        "source": source,
        "freshness": "AVAILABLE" if available else "UNAVAILABLE",
    }


class DayTradeTrapDetectionEngine:
    def __init__(self, config: TrapDetectionConfig | None = None) -> None:
        self.config = config or DEFAULT_CONFIG

    def evaluate(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        ticker = str(snapshot.get("ticker") or "").upper()
        bars = [_as_dict(item) for item in _as_list(snapshot.get("bars")) if isinstance(item, dict)]
        or_high = _num(snapshot.get("orHigh"))
        or_low = _num(snapshot.get("orLow"))
        missing_inputs: list[str] = []

        if not self.config.enabled:
            return self._empty(enabled=False, missing_inputs=[])
        if or_high is None:
            missing_inputs.append("ORH")
        if or_low is None:
            missing_inputs.append("ORL")
        if not bars:
            missing_inputs.append("5m bars")
        if missing_inputs:
            dto = self._empty(enabled=True, missing_inputs=missing_inputs)
            dto["summary"] = f"Trap detection unavailable: missing {', '.join(missing_inputs)}."
            return dto

        bull_break = self._find_directional_break(bars, or_high or 0.0, "UP")
        bear_break = self._find_directional_break(bars, or_low or 0.0, "DOWN")
        bull_profile = self._direction_profile(snapshot, bars, bull_break, "BULL_TRAP")
        bear_profile = self._direction_profile(snapshot, bars, bear_break, "BEAR_TRAP")
        risk_monitor = self._risk_monitor(snapshot, bull_profile, bear_profile)
        active_profile = self._active_profile(bull_profile, bear_profile)
        if active_profile.get("break") is None:
            dto = self._empty(enabled=True, missing_inputs=[])
            dto["summary"] = "No confirmed ORH breakout or ORL breakdown is active."
            dto["dataCompleteness"] = 1.0
            dto["bullTrap"] = bull_profile
            dto["bearTrap"] = bear_profile
            dto["riskMonitor"] = risk_monitor
            return dto

        trap_type = str(active_profile["type"])
        break_event = _as_dict(active_profile.get("break"))
        factors = _as_list(active_profile.get("factors"))
        available_points = sum(int(item["points"]) for item in factors if item.get("available"))
        earned_points = sum(int(item["earnedPoints"]) for item in factors)
        score = int(active_profile.get("score") or min(100, earned_points))
        data_completeness = round(available_points / 100.0, 2)
        missing_inputs = self._missing_inputs(factors)
        resolution = _as_dict(active_profile.get("resolution"))
        state, severity = self._legacy_state(trap_type, active_profile)
        protective = self._protective_level(bars, break_event, trap_type)
        position_risk = self._position_risk(snapshot, trap_type, state, protective)
        summary = str(active_profile.get("explanation") or self._summary(ticker, trap_type, factors, break_event, score, resolution))

        return {
            "enabled": True,
            "featureFlag": "dayTradeTrapDetectionEnabled",
            "engineVersion": TRAP_ENGINE_VERSION,
            "configurationVersion": TRAP_CONFIG_VERSION,
            "type": trap_type,
            "state": state,
            "severity": severity,
            "score": score,
            "scoreAtBreak": score,
            "highestScore": score,
            "threshold": self.config.warningThreshold,
            "criticalThreshold": self.config.criticalThreshold,
            "availablePoints": available_points,
            "earnedPoints": earned_points,
            "normalizedScore": round((earned_points / available_points) * 100, 2) if available_points else None,
            "dataCompleteness": data_completeness,
            "missingInputs": missing_inputs,
            "break": break_event,
            "factors": factors,
            "summary": summary,
            "structureContext": _as_dict(snapshot.get("structureContext")),
            "positionRisk": position_risk,
            "resolution": resolution,
            "notification": self._notification(ticker, snapshot, trap_type, score, state, break_event),
            "bullTrap": bull_profile,
            "bearTrap": bear_profile,
            "riskMonitor": risk_monitor,
        }

    def _empty(self, *, enabled: bool, missing_inputs: list[str]) -> dict[str, Any]:
        return {
            "enabled": enabled,
            "featureFlag": "dayTradeTrapDetectionEnabled",
            "engineVersion": TRAP_ENGINE_VERSION,
            "configurationVersion": TRAP_CONFIG_VERSION,
            "type": None,
            "state": "NONE",
            "severity": "NONE",
            "score": 0,
            "highestScore": 0,
            "threshold": self.config.warningThreshold,
            "criticalThreshold": self.config.criticalThreshold,
            "availablePoints": 0,
            "earnedPoints": 0,
            "normalizedScore": None,
            "dataCompleteness": 0.0 if missing_inputs else 1.0,
            "missingInputs": missing_inputs,
            "break": None,
            "factors": [],
            "summary": "Trap detection is inactive.",
            "structureContext": None,
            "positionRisk": {"isHeld": False, "isExposedToTrap": False, "actionLevel": "NONE"},
            "resolution": {"status": "NONE", "deadlineBars": self.config.resolutionWindowBars, "barsElapsed": 0, "resolvedAt": None, "resolutionType": None},
            "notification": {"eligible": False, "reason": "NO_ACTIVE_TRAP", "dedupeKey": None, "priority": "none"},
            "bullTrap": self._empty_direction_profile("BULL_TRAP", missing_inputs=missing_inputs),
            "bearTrap": self._empty_direction_profile("BEAR_TRAP", missing_inputs=missing_inputs),
            "riskMonitor": self._risk_monitor({}, self._empty_direction_profile("BULL_TRAP", missing_inputs=missing_inputs), self._empty_direction_profile("BEAR_TRAP", missing_inputs=missing_inputs)),
        }

    def _find_break(self, bars: list[dict[str, Any]], or_high: float, or_low: float) -> dict[str, Any] | None:
        tolerance = max(0.01, abs(or_high or or_low) * 0.0001)
        for index, bar in enumerate(bars):
            high = _bar_price(bar, "h", "high")
            low = _bar_price(bar, "l", "low")
            close = _bar_price(bar, "c", "close")
            ts = _bar_time(bar)
            minutes = _minutes_since_open(bar, index)
            if high is not None and high > or_high + tolerance:
                return {
                    "levelType": "ORH",
                    "direction": "UP",
                    "level": round(or_high, 4),
                    "price": round(high, 4),
                    "close": round(close, 4) if close is not None else None,
                    "timestamp": ts,
                    "barTimestamp": ts,
                    "minutesSinceOpen": minutes,
                    "openingRangeComplete": minutes >= self.config.openingRangeMinutes,
                    "barsSinceBreak": max(0, len(bars) - index - 1),
                    "distanceBeyondLevel": round(high - or_high, 4),
                    "barIndex": index,
                }
            if low is not None and low < or_low - tolerance:
                return {
                    "levelType": "ORL",
                    "direction": "DOWN",
                    "level": round(or_low, 4),
                    "price": round(low, 4),
                    "close": round(close, 4) if close is not None else None,
                    "timestamp": ts,
                    "barTimestamp": ts,
                    "minutesSinceOpen": minutes,
                    "openingRangeComplete": minutes >= self.config.openingRangeMinutes,
                    "barsSinceBreak": max(0, len(bars) - index - 1),
                    "distanceBeyondLevel": round(or_low - low, 4),
                    "barIndex": index,
                }
        return None

    def _find_directional_break(self, bars: list[dict[str, Any]], level: float, direction: str) -> dict[str, Any] | None:
        tolerance = max(0.01, abs(level) * 0.0001)
        for index, bar in enumerate(bars):
            high = _bar_price(bar, "h", "high")
            low = _bar_price(bar, "l", "low")
            close = _bar_price(bar, "c", "close")
            ts = _bar_time(bar)
            minutes = _minutes_since_open(bar, index)
            if direction == "UP" and high is not None and high > level + tolerance:
                return {
                    "levelType": "ORH",
                    "direction": "UP",
                    "level": round(level, 4),
                    "price": round(high, 4),
                    "close": round(close, 4) if close is not None else None,
                    "timestamp": ts,
                    "barTimestamp": ts,
                    "minutesSinceOpen": minutes,
                    "openingRangeComplete": minutes >= self.config.openingRangeMinutes,
                    "barsSinceBreak": max(0, len(bars) - index - 1),
                    "distanceBeyondLevel": round(high - level, 4),
                    "barIndex": index,
                }
            if direction == "DOWN" and low is not None and low < level - tolerance:
                return {
                    "levelType": "ORL",
                    "direction": "DOWN",
                    "level": round(level, 4),
                    "price": round(low, 4),
                    "close": round(close, 4) if close is not None else None,
                    "timestamp": ts,
                    "barTimestamp": ts,
                    "minutesSinceOpen": minutes,
                    "openingRangeComplete": minutes >= self.config.openingRangeMinutes,
                    "barsSinceBreak": max(0, len(bars) - index - 1),
                    "distanceBeyondLevel": round(level - low, 4),
                    "barIndex": index,
                }
        return None

    def _direction_profile(self, snapshot: dict[str, Any], bars: list[dict[str, Any]], break_event: dict[str, Any] | None, trap_type: str) -> dict[str, Any]:
        if break_event is None:
            return self._empty_direction_profile(trap_type, missing_inputs=[])
        factors = self._score_factors(snapshot, bars, break_event, trap_type)
        earned_points = min(100, sum(int(item["earnedPoints"]) for item in factors))
        resolution = self._resolution(bars, break_event, trap_type, snapshot)
        stage = self._stage(trap_type, earned_points, resolution, factors, snapshot)
        score = self._stage_score(earned_points, stage)
        status, tone = self._status_for_stage(score, stage)
        explanation = self._profile_explanation(snapshot, trap_type, score, stage, factors, resolution, break_event)
        return {
            "type": trap_type,
            "name": "Bull Trap" if trap_type == "BULL_TRAP" else "Bear Trap",
            "score": score,
            "scoreDisplay": f"{score} /100",
            "progressPercent": f"{max(0, min(100, score))}%",
            "stage": stage,
            "status": status,
            "tone": tone,
            "confidence": self._confidence(factors),
            "confidenceDisplay": f"Confidence {self._confidence(factors)}%",
            "explanation": explanation,
            "nextConfirmation": self._next_confirmation(trap_type, stage, resolution),
            "nextInvalidation": self._next_invalidation(trap_type, stage, resolution),
            "sparkline": self._sparkline(score, stage),
            "triggeredFactors": [self._monitor_factor(item, "Triggered") for item in factors if item.get("active")],
            "passedFactors": [self._monitor_factor(item, "Passed") for item in factors if item.get("available") and not item.get("active")],
            "missingFactors": [self._monitor_factor(item, "Missing Data") for item in factors if not item.get("available")],
            "formula": "Backend staged risk model using opening range, VWAP, volume, market divergence, sector context, options sentiment, and confirmed 5-minute structure.",
            "evidence": [self._monitor_factor(item, "Triggered" if item.get("active") else "Passed") for item in factors if item.get("available")],
            "factors": factors,
            "break": break_event,
            "resolution": resolution,
        }

    def _empty_direction_profile(self, trap_type: str, *, missing_inputs: list[str]) -> dict[str, Any]:
        status = "Missing Data" if missing_inputs else "Not Triggered"
        explanation = "Waiting for backend inputs." if missing_inputs else "No active opening-range break for this risk."
        return {
            "type": trap_type,
            "name": "Bull Trap" if trap_type == "BULL_TRAP" else "Bear Trap",
            "score": 0,
            "scoreDisplay": "0 /100",
            "progressPercent": "0%",
            "stage": "NONE",
            "status": status,
            "tone": "gray",
            "confidence": 0 if missing_inputs else 100,
            "confidenceDisplay": "Confidence 0%" if missing_inputs else "Confidence 100%",
            "explanation": explanation,
            "nextConfirmation": "Unavailable" if missing_inputs else "Opening-range break required.",
            "nextInvalidation": "Unavailable" if missing_inputs else "No active trap thesis.",
            "sparkline": [0],
            "triggeredFactors": [],
            "passedFactors": [],
            "missingFactors": [{"label": item, "status": "Missing Data", "explanation": "Backend input is unavailable.", "displayEvidence": "Unavailable"} for item in missing_inputs],
            "formula": "Unavailable until backend inputs are present.",
            "evidence": [],
            "factors": [],
            "break": None,
            "resolution": {"status": "NONE", "deadlineBars": self.config.resolutionWindowBars, "barsElapsed": 0, "resolvedAt": None, "resolutionType": None},
        }

    def _score_factors(self, snapshot: dict[str, Any], bars: list[dict[str, Any]], break_event: dict[str, Any], trap_type: str) -> list[dict[str, Any]]:
        bullish = trap_type == "BULL_TRAP"
        break_index = int(break_event["barIndex"])
        break_bar = bars[break_index]
        ticker_change = _num(snapshot.get("tickerChangePct"))
        spy_change = _num(snapshot.get("spyChangePct"))
        qqq_change = _num(snapshot.get("qqqChangePct"))
        sector_symbol = snapshot.get("sectorEtf")
        sector_change = _num(snapshot.get("sectorChangePct"))
        avg_volume = _num(snapshot.get("average20BarVolume"))
        break_volume = _num(snapshot.get("breakoutBarVolume")) or _bar_price(break_bar, "v", "volume")
        sigma = _num(snapshot.get("intradaySigma"))
        put_call_ratio = _num(snapshot.get("putCallRatio"))
        put_call_fresh = bool(snapshot.get("putCallFresh", put_call_ratio is not None))

        early_code = "EARLY_ORH_BREAK" if bullish else "EARLY_ORL_BREAK"
        factors = [
            _factor(
                code=early_code,
                label=("ORH broke before opening range completed" if bullish else "ORL broke before opening range completed"),
                description="Break occurred before the configured opening-range interval closed.",
                points=25,
                active=bool(not break_event["openingRangeComplete"] and int(break_event["minutesSinceOpen"]) < self.config.openingRangeMinutes),
                available=True,
                evidence=f"{break_event['levelType']} broke {break_event['minutesSinceOpen']} minutes after open.",
                inputs=[
                    _input("Minutes since open", break_event["minutesSinceOpen"], f"{break_event['minutesSinceOpen']} min"),
                    _input("Opening range complete", break_event["openingRangeComplete"], str(break_event["openingRangeComplete"])),
                ],
                formula=f"minutesSinceOpen < {self.config.openingRangeMinutes} and openingRangeComplete is false",
            )
        ]

        index_available = ticker_change is not None and spy_change is not None and qqq_change is not None
        index_active = (ticker_change or 0) > 0 and (spy_change or 0) < 0 and (qqq_change or 0) < 0 if bullish else (ticker_change or 0) < 0 and (spy_change or 0) > 0 and (qqq_change or 0) > 0
        factors.append(_factor(
            code="INDEX_DIVERGENCE_BULL" if bullish else "INDEX_DIVERGENCE_BEAR",
            label="Ticker diverged from SPY and QQQ",
            description="Ticker direction opposed both broad market proxies.",
            points=20,
            active=index_active,
            available=index_available,
            evidence=f"{snapshot.get('ticker') or 'Ticker'} {_format_pct(ticker_change)}, SPY {_format_pct(spy_change)}, QQQ {_format_pct(qqq_change)}.",
            inputs=[
                _input("Ticker change", ticker_change, _format_pct(ticker_change)),
                _input("SPY change", spy_change, _format_pct(spy_change)),
                _input("QQQ change", qqq_change, _format_pct(qqq_change)),
            ],
            formula="bull: ticker > 0 and SPY < 0 and QQQ < 0; bear: ticker < 0 and SPY > 0 and QQQ > 0",
        ))

        sector_available = ticker_change is not None and sector_change is not None and bool(sector_symbol)
        sector_active = (ticker_change or 0) > 0 and (sector_change or 0) < 0 if bullish else (ticker_change or 0) < 0 and (sector_change or 0) > 0
        factors.append(_factor(
            code="SECTOR_DIVERGENCE_BULL" if bullish else "SECTOR_DIVERGENCE_BEAR",
            label="Ticker diverged from mapped sector ETF",
            description="Ticker direction opposed its mapped sector ETF.",
            points=15,
            active=sector_active,
            available=sector_available,
            evidence=f"{sector_symbol or 'Sector ETF'} {_format_pct(sector_change)} while ticker {_format_pct(ticker_change)}.",
            inputs=[
                _input("Sector ETF", sector_symbol, str(sector_symbol or "unavailable")),
                _input("Sector change", sector_change, _format_pct(sector_change)),
            ],
            formula="bull: ticker > 0 and sector < 0; bear: ticker < 0 and sector > 0",
        ))

        volume_available = break_volume is not None and avg_volume is not None and avg_volume > 0
        ratio = (break_volume / avg_volume) if volume_available else None
        factors.append(_factor(
            code="LOW_BREAKOUT_PARTICIPATION" if bullish else "LOW_BREAKDOWN_PARTICIPATION",
            label="Break volume lacked participation",
            description="Break bar volume was below the configured multiple of the 20-bar average.",
            points=15,
            active=(ratio or 0) < self.config.volumeParticipationThreshold,
            available=volume_available,
            evidence=f"Break volume {ratio:.2f}x the 20-bar average." if ratio is not None else "Break volume or 20-bar average volume unavailable.",
            inputs=[
                _input("Break volume", break_volume, f"{break_volume:,.0f}" if break_volume is not None else "unavailable"),
                _input("20-bar average volume", avg_volume, f"{avg_volume:,.0f}" if avg_volume is not None else "unavailable"),
                _input("Volume ratio", round(ratio, 4) if ratio is not None else None, f"{ratio:.2f}x" if ratio is not None else "unavailable"),
            ],
            formula=f"breakVolume / average20BarVolume < {self.config.volumeParticipationThreshold}",
        ))

        extension = self._sigma_extension(bars, break_event, bullish, sigma)
        factors.append(_factor(
            code="BLOW_OFF_EXTENSION_BULL" if bullish else "BLOW_OFF_EXTENSION_BEAR",
            label="Fast extension beyond opening range",
            description="Price extended more than the configured sigma within the post-break window.",
            points=10,
            active=bool(extension and extension["sigmaUnits"] > self.config.blowOffSigmaThreshold),
            available=sigma is not None and sigma > 0,
            evidence=extension["display"] if extension else "Intraday sigma unavailable.",
            inputs=[
                _input("Sigma", sigma, f"{sigma:.2f}" if sigma is not None else "unavailable"),
                _input("Extension sigma units", extension["sigmaUnits"] if extension else None, f"{extension['sigmaUnits']:.2f}σ" if extension else "unavailable"),
            ],
            formula=f"max extension within {self.config.blowOffWindowBars} bars > {self.config.blowOffSigmaThreshold} sigma",
        ))

        options_available = put_call_ratio is not None and put_call_fresh
        options_active = (put_call_ratio or 9) < self.config.bullishPutCallExtreme if bullish else (put_call_ratio or 0) > self.config.bearishPutCallExtreme
        factors.append(_factor(
            code="CROWDED_BULLISH_OPTIONS" if bullish else "CROWDED_BEARISH_OPTIONS",
            label="Options sentiment is crowded",
            description="Fresh put/call ratio is at the configured directional extreme.",
            points=10,
            active=options_active,
            available=options_available,
            evidence=f"Put/call ratio {put_call_ratio:.2f}." if options_available else "Fresh intraday put/call ratio unavailable.",
            inputs=[_input("Put/call ratio", put_call_ratio, f"{put_call_ratio:.2f}" if put_call_ratio is not None else "unavailable")],
            formula=f"bull: put/call < {self.config.bullishPutCallExtreme}; bear: put/call > {self.config.bearishPutCallExtreme}",
        ))

        factors.append(_factor(
            code="REVERSION_HOURS_BULL" if bullish else "REVERSION_HOURS_BEAR",
            label="Break occurred during reversion hours",
            description="Break occurred after the configured late-morning threshold.",
            points=5,
            active=int(break_event["minutesSinceOpen"]) >= self.config.reversionHoursStartMinutes,
            available=True,
            evidence=f"Break occurred {break_event['minutesSinceOpen']} minutes after open.",
            inputs=[_input("Minutes since open", break_event["minutesSinceOpen"], f"{break_event['minutesSinceOpen']} min")],
            formula=f"minutesSinceOpen >= {self.config.reversionHoursStartMinutes}",
        ))
        return factors

    def _sigma_extension(self, bars: list[dict[str, Any]], break_event: dict[str, Any], bullish: bool, sigma: float | None) -> dict[str, Any] | None:
        if sigma is None or sigma <= 0:
            return None
        start = int(break_event["barIndex"])
        level = float(break_event["level"])
        window = bars[start:min(len(bars), start + self.config.blowOffWindowBars + 1)]
        if bullish:
            values = [_bar_price(bar, "h", "high") for bar in window]
            extreme = max([value for value in values if value is not None], default=None)
            distance = (extreme - level) if extreme is not None else None
        else:
            values = [_bar_price(bar, "l", "low") for bar in window]
            extreme = min([value for value in values if value is not None], default=None)
            distance = (level - extreme) if extreme is not None else None
        if distance is None:
            return None
        units = distance / sigma
        return {
            "price": round(extreme, 4) if extreme is not None else None,
            "sigmaUnits": round(units, 4),
            "display": f"Maximum extension reached {_format_price(extreme)}, {units:.2f}σ beyond {break_event['levelType']}.",
        }

    def _resolution(self, bars: list[dict[str, Any]], break_event: dict[str, Any], trap_type: str, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
        bullish = trap_type == "BULL_TRAP"
        snapshot = snapshot or {}
        explicit_confirmed = bool(
            snapshot.get("bullTrapConfirmed") if bullish else snapshot.get("bearTrapConfirmed")
        ) or bool(snapshot.get("trapConfirmed"))
        index = int(break_event["barIndex"])
        level = float(break_event["level"])
        after = bars[index + 1:index + 1 + self.config.resolutionWindowBars]
        qualifying_continuation = 0
        for offset, bar in enumerate(after, start=1):
            close = _bar_price(bar, "c", "close")
            volume = _bar_price(bar, "v", "volume")
            avg_volume = _bar_price(bar, "avg20Volume", "average20BarVolume") or _num(bar.get("average_20_bar_volume"))
            if close is None:
                continue
            if bullish and close <= level:
                return self._resolved(
                    "TRAP_CONFIRMED" if explicit_confirmed else "RETURNED_INSIDE_RANGE",
                    "BULL_TRAP_CONFIRMED" if explicit_confirmed else "BULL_ORH_REENTRY_PENDING_CONFIRMATION",
                    bar,
                    offset,
                )
            if not bullish and close >= level:
                return self._resolved(
                    "TRAP_CONFIRMED" if explicit_confirmed else "RETURNED_INSIDE_RANGE",
                    "BEAR_TRAP_CONFIRMED" if explicit_confirmed else "BEAR_ORL_REENTRY_PENDING_CONFIRMATION",
                    bar,
                    offset,
                )
            beyond = close > level if bullish else close < level
            volume_ok = volume is not None and avg_volume is not None and avg_volume > 0 and (volume / avg_volume) >= self.config.volumeParticipationThreshold
            qualifying_continuation = qualifying_continuation + 1 if beyond and volume_ok else 0
            if qualifying_continuation >= self.config.realMoveConfirmationBars:
                return self._resolved("CONTINUATION_CONFIRMED", "BULLISH_CONTINUATION_CONFIRMED" if bullish else "BEARISH_CONTINUATION_CONFIRMED", bar, offset)
        if len(bars) - index - 1 > self.config.resolutionWindowBars:
            return {
                "status": "EXPIRED",
                "deadlineBars": self.config.resolutionWindowBars,
                "barsElapsed": len(after),
                "resolvedAt": _bar_time(after[-1]) if after else None,
                "resolutionType": "UNRESOLVED_WINDOW_EXPIRED",
            }
        return {
            "status": "PENDING",
            "deadlineBars": self.config.resolutionWindowBars,
            "barsElapsed": len(after),
            "resolvedAt": None,
            "resolutionType": None,
        }

    def _stage(self, trap_type: str, score: int, resolution: dict[str, Any], factors: list[dict[str, Any]], snapshot: dict[str, Any]) -> str:
        if resolution.get("status") == "TRAP_CONFIRMED":
            return "CONFIRMED"
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return "NONE"
        if resolution.get("status") == "EXPIRED":
            return "NONE"
        explicit_warning = bool(snapshot.get("bullTrapWarning") if trap_type == "BULL_TRAP" else snapshot.get("bearTrapWarning"))
        active_codes = {str(item.get("code")) for item in factors if item.get("active")}
        has_range_reentry = resolution.get("status") == "RETURNED_INSIDE_RANGE"
        has_market_or_sector_divergence = any("DIVERGENCE" in code for code in active_codes)
        has_low_participation = any("LOW_BREAK" in code for code in active_codes)
        if explicit_warning or score >= 50 or (has_range_reentry and (has_market_or_sector_divergence or has_low_participation)):
            return "WARNING"
        if score >= 25 or has_range_reentry or has_low_participation or has_market_or_sector_divergence:
            return "WATCH"
        return "POTENTIAL"

    def _stage_score(self, score: int, stage: str) -> int:
        if stage == "NONE":
            return 0
        if stage == "CONFIRMED":
            return max(75, min(100, score))
        return max(1, min(100, score))

    def _status_for_stage(self, score: int, stage: str) -> tuple[str, str]:
        if stage == "CONFIRMED":
            return "Confirmed", "red"
        if stage == "NONE":
            return ("None", "gray") if score == 0 else ("Low", "green")
        if score >= 50:
            return "Warning", "orange"
        if score >= 25:
            return "Watch", "yellow"
        return "Low", "green"

    def _confidence(self, factors: list[dict[str, Any]]) -> int:
        available = sum(1 for item in factors if item.get("available"))
        if not factors:
            return 0
        return int(round((available / len(factors)) * 100))

    def _monitor_factor(self, factor: dict[str, Any], status: str) -> dict[str, Any]:
        label = self._clean_factor_label(str(factor.get("code") or ""), str(factor.get("label") or "Factor"))
        explanation = str(factor.get("displayEvidence") or factor.get("description") or "Unavailable")
        if status == "Missing Data":
            explanation = self._missing_factor_message(label)
        return {
            "code": factor.get("code"),
            "label": label,
            "status": status,
            "points": factor.get("points"),
            "earnedPoints": factor.get("earnedPoints"),
            "explanation": explanation,
            "displayEvidence": factor.get("displayEvidence") or explanation,
            "formula": factor.get("formula") or "",
            "inputs": factor.get("inputs") or [],
            "source": factor.get("source"),
            "freshness": factor.get("freshness"),
        }

    def _clean_factor_label(self, code: str, fallback: str) -> str:
        if "INDEX_DIVERGENCE" in code:
            return "Market Confirmation"
        if "SECTOR_DIVERGENCE" in code:
            return "Sector Confirmation"
        if "LOW_BREAK" in code:
            return "Volume Analysis"
        if "BLOW_OFF" in code:
            return "ATR Exhaustion"
        if "CROWDED" in code:
            return "Options Sentiment"
        if "REVERSION_HOURS" in code:
            return "Time Window"
        if "EARLY_ORH" in code:
            return "ORH Break Timing"
        if "EARLY_ORL" in code:
            return "ORL Break Timing"
        return fallback

    def _missing_factor_message(self, label: str) -> str:
        if label == "Volume Analysis":
            return "Waiting for sufficient history. 20-bar average volume is not yet available."
        if label in {"Market Confirmation", "Sector Confirmation"}:
            return "Waiting for fresh market or sector comparison data."
        if label == "Options Sentiment":
            return "Waiting for fresh intraday put/call data."
        return "Backend evidence is unavailable for this factor."

    def _profile_explanation(
        self,
        snapshot: dict[str, Any],
        trap_type: str,
        score: int,
        stage: str,
        factors: list[dict[str, Any]],
        resolution: dict[str, Any],
        break_event: dict[str, Any],
    ) -> str:
        if stage == "CONFIRMED":
            return "Backend confirmed the staged trap sequence with final confirmation evidence."
        if resolution.get("status") == "RETURNED_INSIDE_RANGE":
            return f"{break_event['levelType']} break returned inside the range. Waiting for final backend confirmation before marking confirmed."
        active = [self._clean_factor_label(str(item.get("code") or ""), str(item.get("label") or "")) for item in factors if item.get("active")]
        if active:
            return f"{trap_type.replace('_', ' ').title()} risk is {score}/100 from backend factors: {', '.join(active[:3])}."
        return f"{break_event['levelType']} break is being monitored. No additional backend risk factors are currently triggered."

    def _next_confirmation(self, trap_type: str, stage: str, resolution: dict[str, Any]) -> str:
        if stage == "CONFIRMED":
            return "Confirmed by backend."
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return "Continuation confirmed; trap monitor reset."
        if trap_type == "BULL_TRAP":
            return "Backend confirmation requires VWAP loss, failed ORH retest, lower-low structure, and seller participation."
        return "Backend confirmation requires VWAP reclaim failure, failed ORL retest, higher-high structure, and buyer participation."

    def _next_invalidation(self, trap_type: str, stage: str, resolution: dict[str, Any]) -> str:
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return "Trap thesis invalidated by continuation."
        if stage == "NONE":
            return "No active trap thesis."
        return "Continuation beyond the broken opening-range level with participation."

    def _sparkline(self, score: int, stage: str) -> list[int]:
        if stage == "NONE":
            return [0]
        if score <= 1:
            return [0, score]
        start = max(0, score - 24)
        midpoint = max(start, score - 10)
        return [start, midpoint, score]

    def _active_profile(self, bull_profile: dict[str, Any], bear_profile: dict[str, Any]) -> dict[str, Any]:
        if int(bear_profile.get("score") or 0) > int(bull_profile.get("score") or 0):
            return bear_profile
        if bull_profile.get("break") is not None:
            return bull_profile
        return bear_profile

    def _risk_monitor(self, snapshot: dict[str, Any], bull_profile: dict[str, Any], bear_profile: dict[str, Any]) -> dict[str, Any]:
        return {
            "title": "Risk Monitor",
            "items": [
                self._monitor_item_from_profile(bull_profile),
                self._monitor_item_from_profile(bear_profile),
                self._context_risk("VWAP Failure", snapshot.get("vwapFailureStatus"), snapshot.get("vwapFailureExplanation")),
                self._context_risk("Trend Failure", snapshot.get("trendFailureStatus"), snapshot.get("trendFailureExplanation")),
                self._context_risk("Momentum Failure", snapshot.get("momentumFailureStatus"), snapshot.get("momentumFailureExplanation")),
                self._context_risk("Market Divergence", snapshot.get("marketDivergenceStatus"), snapshot.get("marketDivergenceExplanation")),
                self._context_risk("Exhaustion", snapshot.get("exhaustionStatus"), snapshot.get("exhaustionExplanation")),
            ],
        }

    def _monitor_item_from_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(profile.get("type") or profile.get("name") or "risk").lower(),
            "name": profile.get("name"),
            "status": profile.get("status"),
            "stage": profile.get("stage"),
            "tone": profile.get("tone"),
            "score": profile.get("score"),
            "scoreDisplay": profile.get("scoreDisplay"),
            "progressPercent": profile.get("progressPercent"),
            "confidence": profile.get("confidence"),
            "confidenceDisplay": profile.get("confidenceDisplay"),
            "explanation": profile.get("explanation"),
            "nextConfirmation": profile.get("nextConfirmation"),
            "nextInvalidation": profile.get("nextInvalidation"),
            "sparkline": profile.get("sparkline"),
            "triggeredFactors": profile.get("triggeredFactors") or [],
            "passedFactors": profile.get("passedFactors") or [],
            "missingFactors": profile.get("missingFactors") or [],
            "formula": profile.get("formula"),
            "evidence": profile.get("evidence") or [],
        }

    def _context_risk(self, name: str, status_value: Any, explanation_value: Any) -> dict[str, Any]:
        status = str(status_value or "Not Triggered")
        explanation = str(explanation_value or "No backend trigger is active.")
        missing = status.upper() in {"MISSING", "UNAVAILABLE", "MISSING_DATA"}
        display_status = "Missing Data" if missing else status.replace("_", " ").title()
        return {
            "id": name.lower().replace(" ", "_"),
            "name": name,
            "status": display_status,
            "stage": "NONE",
            "tone": "gray" if missing or display_status == "Not Triggered" else "yellow",
            "score": 0,
            "scoreDisplay": "0 /100",
            "progressPercent": "0%",
            "confidence": 0 if missing else 100,
            "confidenceDisplay": "Confidence 0%" if missing else "Confidence 100%",
            "explanation": explanation,
            "nextConfirmation": "Unavailable" if missing else "Backend will update when evidence changes.",
            "nextInvalidation": "Unavailable" if missing else "No active risk thesis.",
            "sparkline": [0],
            "triggeredFactors": [],
            "passedFactors": [] if missing else [{"label": name, "status": "Passed", "explanation": explanation}],
            "missingFactors": [{"label": name, "status": "Missing Data", "explanation": explanation}] if missing else [],
            "formula": "Backend-owned risk monitor item.",
            "evidence": [],
        }

    def _resolved(self, status: str, resolution_type: str, bar: dict[str, Any], bars_elapsed: int) -> dict[str, Any]:
        return {
            "status": status,
            "deadlineBars": self.config.resolutionWindowBars,
            "barsElapsed": bars_elapsed,
            "resolvedAt": _bar_time(bar),
            "resolutionType": resolution_type,
            "priceOnResolution": _bar_price(bar, "c", "close"),
        }

    def _state(self, trap_type: str, score: int, resolution: dict[str, Any]) -> tuple[str, str]:
        if resolution.get("status") == "TRAP_CONFIRMED":
            return ("BULL_TRAP_CONFIRMED" if trap_type == "BULL_TRAP" else "BEAR_TRAP_CONFIRMED", "CONFIRMED")
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return ("BULL_CONTINUATION_CONFIRMED" if trap_type == "BULL_TRAP" else "BEAR_CONTINUATION_CONFIRMED", "CONTINUATION")
        if resolution.get("status") == "EXPIRED":
            return "EXPIRED", "NEUTRAL"
        prefix = "BULL_TRAP" if trap_type == "BULL_TRAP" else "BEAR_TRAP"
        if score >= self.config.criticalThreshold:
            return f"{prefix}_CRITICAL", "CRITICAL"
        if score >= self.config.warningThreshold:
            return f"{prefix}_WARNING", "WARNING"
        return f"{prefix}_WATCH", "WATCH"

    def _legacy_state(self, trap_type: str, profile: dict[str, Any]) -> tuple[str, str]:
        resolution = _as_dict(profile.get("resolution"))
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return ("BULL_CONTINUATION_CONFIRMED" if trap_type == "BULL_TRAP" else "BEAR_CONTINUATION_CONFIRMED", "CONTINUATION")
        stage = str(profile.get("stage") or "NONE").upper()
        if stage == "CONFIRMED":
            return ("BULL_TRAP_CONFIRMED" if trap_type == "BULL_TRAP" else "BEAR_TRAP_CONFIRMED", "CONFIRMED")
        if resolution.get("status") == "EXPIRED":
            return "EXPIRED", "NEUTRAL"
        prefix = "BULL_TRAP" if trap_type == "BULL_TRAP" else "BEAR_TRAP"
        if stage == "WARNING":
            return f"{prefix}_WARNING", "WARNING"
        if stage == "WATCH":
            return f"{prefix}_WATCH", "WATCH"
        if stage == "POTENTIAL":
            return f"{prefix}_POTENTIAL", "WATCH"
        return "NONE", "NONE"

    def _protective_level(self, bars: list[dict[str, Any]], break_event: dict[str, Any], trap_type: str) -> dict[str, Any]:
        bullish = trap_type == "BULL_TRAP"
        for bar in bars[int(break_event["barIndex"]) + 1:]:
            open_value = _bar_price(bar, "o", "open")
            close = _bar_price(bar, "c", "close")
            high = _bar_price(bar, "h", "high")
            low = _bar_price(bar, "l", "low")
            if open_value is None or close is None:
                continue
            if bullish and close < open_value and low is not None:
                return {"price": round(low, 4), "status": "AVAILABLE", "basis": "FIRST_BEARISH_5M_CANDLE_LOW", "timestamp": _bar_time(bar)}
            if not bullish and close > open_value and high is not None:
                return {"price": round(high, 4), "status": "AVAILABLE", "basis": "FIRST_BULLISH_5M_CANDLE_HIGH", "timestamp": _bar_time(bar)}
        return {"price": None, "status": "WAITING_FOR_CONFIRMING_CANDLE", "basis": None, "timestamp": None}

    def _position_risk(self, snapshot: dict[str, Any], trap_type: str, state: str, protective: dict[str, Any]) -> dict[str, Any]:
        is_held = bool(snapshot.get("isHeld"))
        direction = str(snapshot.get("positionDirection") or "").upper()
        exposed = is_held and ((trap_type == "BULL_TRAP" and direction in {"BULLISH", "LONG", "CALL"}) or (trap_type == "BEAR_TRAP" and direction in {"BEARISH", "SHORT", "PUT"}))
        active = any(token in state for token in ("WARNING", "CRITICAL", "CONFIRMED"))
        message = "Position is not exposed to the active trap risk."
        if exposed and active:
            if protective.get("price") is None:
                message = "Waiting for the first confirming 5-minute candle."
            elif trap_type == "BULL_TRAP":
                message = f"Consider reducing into strength or tightening the stop to {_format_price(protective.get('price'))}."
            else:
                message = f"Consider covering into weakness or tightening the stop to {_format_price(protective.get('price'))}."
        return {
            "isHeld": is_held,
            "positionDirection": direction or None,
            "isExposedToTrap": bool(exposed and active),
            "actionLevel": "ESCALATED" if exposed and active else "INFO",
            "message": message,
            "protectiveLevel": protective.get("price"),
            "protectiveLevelStatus": protective.get("status"),
            "protectiveLevelBasis": protective.get("basis"),
            "protectiveLevelTimestamp": protective.get("timestamp"),
        }

    def _notification(self, ticker: str, snapshot: dict[str, Any], trap_type: str, score: int, state: str, break_event: dict[str, Any]) -> dict[str, Any]:
        watched = bool(snapshot.get("isWatched"))
        held = bool(snapshot.get("isHeld"))
        threshold_crossed = score >= self.config.warningThreshold
        eligible = bool(threshold_crossed and (watched or held))
        priority = "high" if held or score >= self.config.criticalThreshold else "normal" if eligible else "none"
        return {
            "eligible": eligible,
            "reason": "HELD_OR_WATCHED_TICKER_SCORE_CROSSED_THRESHOLD" if eligible else "NOT_HELD_OR_WATCHED_OR_BELOW_THRESHOLD",
            "dedupeKey": f"{ticker}:{trap_type}:{break_event['levelType']}:{break_event['timestamp']}" if eligible else None,
            "priority": priority,
            "notificationMode": self.config.notificationMode,
        }

    def _missing_inputs(self, factors: list[dict[str, Any]]) -> list[str]:
        missing: list[str] = []
        for factor in factors:
            if factor.get("available"):
                continue
            for item in factor.get("inputs") or []:
                if item.get("value") in (None, "", "unavailable"):
                    missing.append(str(item.get("label") or factor.get("code")))
        return sorted(set(missing))

    def _summary(self, ticker: str, trap_type: str, factors: list[dict[str, Any]], break_event: dict[str, Any], score: int, resolution: dict[str, Any]) -> str:
        if resolution.get("status") == "TRAP_CONFIRMED":
            return f"{ticker} {trap_type.replace('_', ' ').title()} confirmed: price closed back inside the opening range after {resolution.get('barsElapsed')} bars."
        if resolution.get("status") == "CONTINUATION_CONFIRMED":
            return f"{ticker} continuation confirmed: two 5-minute closes held beyond {break_event['levelType']} with participation."
        active = [item["displayEvidence"] for item in factors if item.get("active")]
        if active:
            return f"{trap_type.replace('_', ' ').title()} Risk {score}. " + " ".join(active[:4])
        return f"{trap_type.replace('_', ' ').title()} watch is active, but no scored risk factors are currently active."


def build_trap_detection_from_metrics(
    *,
    ticker: str,
    metrics: dict[str, Any],
    five_minute_bars: list[dict[str, Any]],
    market_structure: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the Day Trade trap DTO from backend-owned metrics only."""
    snapshot = {
        "ticker": ticker,
        "bars": five_minute_bars,
        "orHigh": metrics.get("or_high"),
        "orLow": metrics.get("or_low"),
        "tickerChangePct": metrics.get("session_change_pct", metrics.get("change_pct")),
        "spyChangePct": metrics.get("spy_session_change_pct", metrics.get("spy_change_pct")),
        "qqqChangePct": metrics.get("qqq_session_change_pct", metrics.get("qqq_change_pct")),
        "sectorEtf": metrics.get("sector_etf") or metrics.get("mapped_sector_etf"),
        "sectorChangePct": metrics.get("sector_change_pct") or metrics.get("sector_etf_change_pct"),
        "average20BarVolume": metrics.get("average_20_bar_volume") or metrics.get("avg_20_bar_volume"),
        "breakoutBarVolume": metrics.get("breakout_bar_volume") or metrics.get("breakdown_bar_volume"),
        "intradaySigma": metrics.get("intraday_sigma") or metrics.get("vwap_std_dev"),
        "putCallRatio": metrics.get("put_call_ratio"),
        "putCallFresh": metrics.get("put_call_ratio_fresh", metrics.get("put_call_ratio") is not None),
        "isWatched": metrics.get("is_watched") or metrics.get("watchlist_match"),
        "isHeld": metrics.get("is_held") or metrics.get("position_held"),
        "positionDirection": metrics.get("position_direction"),
        "bullTrapConfirmed": metrics.get("bull_trap_confirmed"),
        "bearTrapConfirmed": metrics.get("bear_trap_confirmed"),
        "trapConfirmed": metrics.get("trap_confirmed"),
        "bullTrapWarning": metrics.get("bull_trap_warning"),
        "bearTrapWarning": metrics.get("bear_trap_warning"),
        "vwapFailureStatus": metrics.get("vwap_failure_status"),
        "vwapFailureExplanation": metrics.get("vwap_failure_explanation"),
        "trendFailureStatus": metrics.get("trend_failure_status"),
        "trendFailureExplanation": metrics.get("trend_failure_explanation"),
        "momentumFailureStatus": metrics.get("momentum_failure_status"),
        "momentumFailureExplanation": metrics.get("momentum_failure_explanation"),
        "marketDivergenceStatus": metrics.get("market_divergence_status"),
        "marketDivergenceExplanation": metrics.get("market_divergence_explanation"),
        "exhaustionStatus": metrics.get("exhaustion_status"),
        "exhaustionExplanation": metrics.get("exhaustion_explanation"),
        "structureContext": {
            "timeframe": "5m",
            "structure": (market_structure or {}).get("structure") or (market_structure or {}).get("trend") or "UNKNOWN",
            "scoringImpact": 0,
        },
    }
    return DayTradeTrapDetectionEngine().evaluate(snapshot)


def build_unavailable_trap_detection(reason: str) -> dict[str, Any]:
    dto = DayTradeTrapDetectionEngine()._empty(enabled=True, missing_inputs=["market data"])
    dto["summary"] = f"Trap detection unavailable: {reason}"
    return dto
