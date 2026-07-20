"""Presentation and scenario service for the position-trade workspace."""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Callable, Iterable
from urllib.parse import quote, unquote

from models import AnalyzeResponse, OptionLegOut, RecommendationOut
from day_trade_workspace_models import (
    DayTradeChartCandleView,
    DayTradeChartDefaultsView,
    DayTradeChartLevelView,
    DayTradeChartTradeFocusView,
    DayTradeChartView,
    DayTradeMarketStructureView,
    DayTradeStructurePivotView,
    DayTradeVwapOverlayView,
    DayTradeVwapPointView,
)
from position_trade_models import (
    PositionApiError,
    PositionAvailability,
    PositionChecklistItem,
    PositionDecision,
    PositionDecisionCard,
    PositionExpectation,
    PositionHeader,
    PositionKeyLevel,
    PositionLeg,
    PositionMarketStructure,
    PositionPayoff,
    PositionPayoffPoint,
    PositionRiskProfile,
    PositionScannerData,
    PositionScannerEnvelope,
    PositionScannerRow,
    PositionScenarioData,
    PositionScenarioEnvelope,
    PositionScenarioRequest,
    PositionStrategy,
    PositionStrategyDetails,
    PositionStrategyMode,
    PositionTimelineItem,
    PositionTutorial,
    PositionTutorialStep,
    PositionWatchlist,
    PositionWeeksOut,
    PositionWorkspaceData,
    PositionWorkspaceEnvelope,
    PositionWorkspaceMeta,
)
from services.market_structure_service import classify_structure
from services.pivot_detection_service import detect_confirmed_pivots


AnalyzeTicker = Callable[..., AnalyzeResponse]
LoadTickers = Callable[[str], list[dict[str, Any]]]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _strategy_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _engine_strategy_mode(strategy_mode: str) -> str:
    allowed = {"all", "long_only", "credit_only", "short_or_covered", "straddle_only", "calendar_only"}
    return strategy_mode if strategy_mode in allowed else "all"


def _selected_strategy_names(strategy_mode: str) -> set[str]:
    if strategy_mode in {"all", "long_only", "credit_only", "short_or_covered", "straddle_only", "calendar_only"}:
        return set()
    return {item.strip().lower() for item in strategy_mode.split(",") if item.strip()}


def _filter_recommendations(analysis: AnalyzeResponse, strategy_mode: str) -> list[RecommendationOut]:
    selected = _selected_strategy_names(strategy_mode)
    if not selected:
        return analysis.recommendations
    return [rec for rec in analysis.recommendations if (rec.strategy or "").strip().lower() in selected]


def _availability(analysis: AnalyzeResponse, *, has_strategies: bool = True) -> PositionAvailability:
    quality = analysis.quote_quality_summary
    if not has_strategies:
        return "partial"
    if quality.unreliable_rows > 0 or quality.model_rows > 0:
        return "partial"
    if quality.stale_rows > 0 or quality.underlying_quote_source == "previous_close":
        return "stale"
    return "available"


def _overall_availability(rows: Iterable[PositionScannerRow]) -> PositionAvailability:
    states = [row.data_quality for row in rows]
    if not states or all(state == "unavailable" for state in states):
        return "unavailable"
    if any(state in {"unavailable", "partial"} for state in states):
        return "partial"
    if any(state == "stale" for state in states):
        return "stale"
    return "available"


def _breakeven(rec: RecommendationOut) -> str | float | None:
    lower = _number(rec.breakeven_lower)
    upper = _number(rec.breakeven_upper)
    lower = lower if lower is not None and lower > 0 else None
    upper = upper if upper is not None and 0 < upper < 999 else None
    if lower is not None and upper is not None:
        return f"{lower:.2f} - {upper:.2f}"
    return lower if lower is not None else upper


def _candidate_id(
    symbol: str,
    weeks_out: int,
    strategy_mode: str,
    risk_profile: str,
    rec: RecommendationOut,
) -> str:
    return "|".join(
        (
            "PT1",
            symbol,
            str(weeks_out),
            strategy_mode,
            risk_profile,
            rec.expiry,
            quote(rec.strategy, safe=""),
        )
    )


def _parse_candidate_id(candidate_id: str) -> tuple[str, int, str, str, str, str] | None:
    parts = candidate_id.split("|")
    if len(parts) != 7 or parts[0] != "PT1":
        return None
    try:
        weeks_out = int(parts[2])
    except ValueError:
        return None
    return parts[1], weeks_out, parts[3], parts[4], parts[5], unquote(parts[6])


def _option_expiry_payoff(legs: list[OptionLegOut], price: float) -> float:
    value = 0.0
    for leg in legs:
        intrinsic = (
            max(price - leg.strike, 0.0)
            if leg.option_type.upper() == "CALL"
            else max(leg.strike - price, 0.0)
        )
        if leg.action.upper() == "BUY":
            value += intrinsic - leg.mid_price
        else:
            value += leg.mid_price - intrinsic
    return value


def _strategy_payoff(rec: RecommendationOut, spot: float, price: float) -> float | None:
    expiries = {leg.expiry for leg in rec.legs if leg.expiry}
    if len(expiries) > 1:
        return None
    payoff = _option_expiry_payoff(rec.legs, price)
    if rec.strategy == "Covered Call":
        payoff += price - spot
    return payoff


def _payoff_prices(rec: RecommendationOut, spot: float) -> list[float]:
    values = {spot * factor for factor in (0.8, 0.9, 1.0, 1.1, 1.2)}
    values.update(leg.strike for leg in rec.legs if leg.strike > 0)
    if 0 < rec.breakeven_lower < 999:
        values.add(rec.breakeven_lower)
    if 0 < rec.breakeven_upper < 999:
        values.add(rec.breakeven_upper)
    return sorted(round(max(0.0, value), 2) for value in values)


def _payoff(rec: RecommendationOut, spot: float, contracts: int = 1) -> PositionPayoff | None:
    if not rec.legs or len({leg.expiry for leg in rec.legs if leg.expiry}) > 1:
        return None
    points = []
    for price in _payoff_prices(rec, spot):
        per_share = _strategy_payoff(rec, spot, price)
        if per_share is None:
            return None
        label = "Current price" if math.isclose(price, spot, abs_tol=0.01) else None
        points.append(
            PositionPayoffPoint(
                price=price,
                value=round(per_share * 100 * contracts, 2),
                label=label,
            )
        )
    return PositionPayoff(
        points=points,
        x_label="Underlying price at expiry ($)",
        y_label="P&L ($)",
    )


def _key_levels(analysis: AnalyzeResponse, rec: RecommendationOut | None = None) -> list[PositionKeyLevel]:
    levels: list[PositionKeyLevel] = []
    signals = analysis.signals
    for label, raw in (
        ("20-day moving average", signals.ma20),
        ("50-day moving average", signals.ma50),
        ("200-day moving average", signals.ma200),
    ):
        value = _number(raw)
        if value is not None and value > 0:
            levels.append(PositionKeyLevel(label=label, value=round(value, 2)))
    if rec is not None:
        lower = _number(rec.breakeven_lower)
        upper = _number(rec.breakeven_upper)
        if lower is not None and lower > 0:
            levels.append(PositionKeyLevel(label="Lower breakeven", value=round(lower, 2)))
        if upper is not None and 0 < upper < 999:
            levels.append(PositionKeyLevel(label="Upper breakeven", value=round(upper, 2)))
    return levels


def _level(
    level_id: str,
    kind: str,
    price: float | None,
    label: str,
    tone: str,
    priority: int,
    *,
    affects_scale: bool = True,
) -> DayTradeChartLevelView | None:
    if price is None or price <= 0:
        return None
    return DayTradeChartLevelView(
        id=level_id,
        kind=kind,
        price=round(price, 2),
        label=label,
        tone=tone,
        lineStyleToken="solid" if kind in {"target", "invalidation"} else "dashed",
        active=True,
        visibleByDefault=True,
        affectsTradeFocusScale=affects_scale,
        priority=priority,
    )


def _support_resistance(analysis: AnalyzeResponse) -> tuple[float | None, float | None]:
    history = analysis.price_history[-60:]
    lows = [_number(point.low) for point in history]
    highs = [_number(point.high) for point in history]
    lows = [value for value in lows if value is not None and value > 0]
    highs = [value for value in highs if value is not None and value > 0]
    return (min(lows) if lows else None, max(highs) if highs else None)


def _format_percent(value: float | int | None) -> str | None:
    number = _number(value)
    return f"{number:.0f}%" if number is not None else None


def _target_invalidation(analysis: AnalyzeResponse, rec: RecommendationOut | None) -> tuple[float | None, float | None]:
    support, resistance = _support_resistance(analysis)
    if rec is None:
        return resistance, support
    bias = (rec.bias or analysis.signals.directional_bias or "").upper()
    lower = _number(rec.breakeven_lower)
    upper = _number(rec.breakeven_upper)
    if "BEAR" in bias or "PUT" in bias:
        return support, upper or resistance
    return resistance, lower or support


def _position_chart(analysis: AnalyzeResponse, rec: RecommendationOut | None) -> DayTradeChartView | None:
    history = analysis.price_history[-180:]
    candles = [
        DayTradeChartCandleView(
            time=point.date,
            open=point.open,
            high=point.high,
            low=point.low,
            close=point.close,
            volume=0.0,
        )
        for point in history
        if point.date
    ]
    if not candles:
        return None

    support, resistance = _support_resistance(analysis)
    target, invalidation = _target_invalidation(analysis, rec)
    raw_levels = [
        _level("ma20", "moving_average", _number(analysis.signals.ma20), "MA20", "info", 20, affects_scale=False),
        _level("ma50", "moving_average", _number(analysis.signals.ma50), "MA50", "neutral", 30, affects_scale=False),
        _level("ma200", "moving_average", _number(analysis.signals.ma200), "MA200", "neutral", 40, affects_scale=False),
        _level("support", "support", support, "Support", "positive", 50),
        _level("resistance", "resistance", resistance, "Resistance", "warning", 60),
        _level("target", "target", target, "Target", "positive", 70),
        _level("invalidation", "invalidation", invalidation, "Invalidation", "danger", 80),
    ]
    levels = [level for level in raw_levels if level is not None]
    vwap_points = [
        DayTradeVwapPointView(
            barStartUtc=point.date,
            value=_number(point.close),
            sourceTimestampUtc=point.date,
            state="available",
            quality="available",
        )
        for point in history
        if point.date
    ]
    pivots: list[DayTradeStructurePivotView] = []
    try:
        detected = detect_confirmed_pivots([point.high for point in history], [point.low for point in history])
        for index, pivot in enumerate(detected[-16:]):
            pivot_index = int(getattr(pivot, "index", 0) or 0)
            source = history[min(max(pivot_index, 0), len(history) - 1)]
            price = _number(getattr(pivot, "price", None))
            if price is None:
                continue
            pivots.append(
                DayTradeStructurePivotView(
                    id=f"position-pivot-{index}",
                    timestamp=source.date,
                    label=str(getattr(pivot, "label", None) or getattr(pivot, "kind", None) or ""),
                    classification=str(getattr(pivot, "label", None) or ""),
                    pivotType="HIGH" if getattr(pivot, "kind", "") == "H" else "LOW",
                    type=str(getattr(pivot, "kind", "") or ""),
                    price=round(price, 2),
                    sourceTimeframe="daily",
                    timeframe="daily",
                    confirmed=True,
                    status="CONFIRMED",
                    latest=index == len(detected[-16:]) - 1,
                )
            )
    except (TypeError, ValueError, AttributeError):
        pivots = []

    structure = _market_structure(analysis)
    market_structure = DayTradeMarketStructureView(
        id="position-market-structure",
        timeframe="daily",
        trend=structure.trend if structure and structure.trend else (analysis.signals.trend or "Unavailable"),
        structure=structure.summary if structure and structure.summary else "Unavailable",
        display=structure.summary if structure and structure.summary else "Unavailable",
        confidence=_number(analysis.signals.bias_confidence),
        sequence=[pivot.label for pivot in pivots if pivot.label],
        expectedNext=next((item.value for item in (structure.items if structure else []) or [] if item.label == "Expected next structure"), None),
        expectedNextPivot=None,
        invalidationLevel=invalidation,
        structureStrength=_number(analysis.signals.bias_confidence),
        sourceTimeframe="daily",
        pivots=pivots,
        explanation=structure.summary if structure else None,
    )
    return DayTradeChartView(
        candles=candles,
        levels=levels,
        events=[],
        vwapOverlay=DayTradeVwapOverlayView(
            id="position-vwap",
            label="VWAP proxy",
            sessionDate=candles[-1].time,
            exchangeTimeZone="America/New_York",
            anchorPolicy="daily-close-proxy",
            includesExtendedHours=False,
            latestValue=vwap_points[-1].value if vwap_points else None,
            latestAsOfUtc=candles[-1].time,
            visibleByDefault=True,
            affectsTradeFocusScale=False,
            points=vwap_points,
        ),
        marketStructure=market_structure,
        defaults=DayTradeChartDefaultsView(
            interval="5m",
            visibleRange="7d",
            initialVisibleBars=min(120, len(candles)),
            initialBarSpacing=6,
            minBarSpacing=2,
            maxBarSpacing=24,
            rightOffsetBars=4,
            scaleMode="trade_focus",
            followLive=True,
            visibleOverlayIds=["position-vwap", "position-market-structure"],
        ),
        tradeFocus=DayTradeChartTradeFocusView(
            scalePaddingPercent=8,
            levelIdsAllowedToAffectScale=["support", "resistance", "target", "invalidation"],
        ),
    )


def _market_structure(analysis: AnalyzeResponse) -> PositionMarketStructure | None:
    history = analysis.price_history
    if len(history) < 5:
        return None
    try:
        pivots = detect_confirmed_pivots(
            [point.high for point in history],
            [point.low for point in history],
        )
        structure = classify_structure(pivots)
    except (TypeError, ValueError):
        return None
    support, resistance = _support_resistance(analysis)
    strength = _number(analysis.signals.bias_confidence)
    return PositionMarketStructure(
        title="Daily market structure",
        summary=str(structure.get("story") or structure.get("display") or "") or None,
        trend=str(structure.get("state") or analysis.signals.trend) or None,
        bias=str(structure.get("bias") or analysis.signals.directional_bias) or None,
        key_levels=_key_levels(analysis) or None,
        items=[
            PositionKeyLevel(label="Higher Highs", value=str(structure.get("higher_highs") or "Unavailable")),
            PositionKeyLevel(label="Higher Lows", value=str(structure.get("higher_lows") or "Unavailable")),
            PositionKeyLevel(label="Lower Highs", value=str(structure.get("lower_highs") or "Unavailable")),
            PositionKeyLevel(label="Lower Lows", value=str(structure.get("lower_lows") or "Unavailable")),
            PositionKeyLevel(label="Momentum", value=analysis.signals.macd_crossover or analysis.signals.rsi_signal or None),
            PositionKeyLevel(label="Trend Strength", value=f"{strength:.0f}%" if strength is not None else None),
            PositionKeyLevel(label="Support", value=round(support, 2) if support else None),
            PositionKeyLevel(label="Resistance", value=round(resistance, 2) if resistance else None),
            PositionKeyLevel(label="Expected next structure", value=str(structure.get("expected_next") or structure.get("expectedNext") or "Unavailable")),
            PositionKeyLevel(label="Invalidation", value=round(support, 2) if support else None),
        ],
        levels=_key_levels(analysis) or None,
    )


def _strategy_details(analysis: AnalyzeResponse, rec: RecommendationOut, spot: float) -> PositionStrategyDetails:
    position_size = None
    if rec.half_kelly_fraction > 0:
        position_size = f"{rec.half_kelly_fraction * 100:.1f}% of risk capital (half Kelly)"
    expectations = [
        PositionExpectation(label="Probability of profit", value=rec.prob_of_profit),
        PositionExpectation(label="Probability of max loss", value=rec.prob_of_max_loss),
        PositionExpectation(label="Expected value per share", value=rec.expected_value),
    ]
    checklist = [
        PositionChecklistItem(
            label="Liquidity",
            status="pass" if rec.passes_liquidity_filter else "fail",
        ),
        PositionChecklistItem(
            label="Risk/reward",
            status="pass" if rec.passes_rr_filter else "fail",
        ),
        PositionChecklistItem(
            label="Premium threshold",
            status="pass" if rec.passes_credit_filter else "fail",
        ),
    ]
    checklist.extend(
        PositionChecklistItem(label="Engine warning", status="warning", detail=warning)
        for warning in rec.warnings
    )
    payoff = _payoff(rec, spot)
    support, resistance = _support_resistance(analysis)
    target, invalidation = _target_invalidation(analysis, rec)
    timeline = [
        PositionTimelineItem(label="Entry Window", detail=rec.rationale or None, value=rec.status),
        PositionTimelineItem(label="Expected Hold", detail=f"{rec.dte} DTE contract window", value=f"{rec.dte} DTE"),
        PositionTimelineItem(label="Management Review", detail=rec.exit_plan or None, value="Backend plan"),
        PositionTimelineItem(label="Target Zone", detail=None, value=round(target, 2) if target else None),
        PositionTimelineItem(label="Maximum Exit", detail=None, value=rec.expiry or None),
    ]
    return PositionStrategyDetails(
        expiry=rec.expiry or None,
        legs=[
            PositionLeg(
                action=leg.action or None,
                type=leg.option_type or None,
                strike=_number(leg.strike),
                expiry=leg.expiry or None,
                quantity=1 if leg.action.upper() == "BUY" else -1,
            )
            for leg in rec.legs
        ] or None,
        position_size=position_size,
        breakeven=_breakeven(rec),
        iv_rank=_number(analysis.signals.iv_rank),
        payoff=payoff,
        payoff_points=payoff.points if payoff else None,
        scenario_range={"min": -20.0, "max": 20.0, "step": 1.0, "default": 0.0},
        probability_expectations=expectations,
        checklist=checklist,
        checklist_items=checklist,
        timeline=timeline,
        key_levels=[
            PositionKeyLevel(label="Support", value=round(support, 2) if support else None),
            PositionKeyLevel(label="Resistance", value=round(resistance, 2) if resistance else None),
            PositionKeyLevel(label="Break-even", value=_breakeven(rec)),
            PositionKeyLevel(label="Target", value=round(target, 2) if target else None),
            PositionKeyLevel(label="Invalidation", value=round(invalidation, 2) if invalidation else None),
        ],
    )


def _strategy(
    analysis: AnalyzeResponse,
    rec: RecommendationOut,
    weeks_out: int,
    strategy_mode: str,
    risk_profile: str,
) -> PositionStrategy:
    spot = analysis.signals.current_price
    return PositionStrategy(
        id=_candidate_id(analysis.ticker, weeks_out, strategy_mode, risk_profile, rec),
        rank=rec.rank,
        name=rec.strategy or None,
        direction=rec.bias or None,
        position_score=rec.scores.total_score,
        pop=rec.prob_of_profit,
        debit_credit=rec.net_credit,
        max_profit=rec.max_profit,
        max_loss=rec.max_loss,
        risk_reward=rec.risk_reward_ratio,
        dte=rec.dte,
        details=_strategy_details(analysis, rec, spot),
    )


def _selected_strategy(strategies: list[PositionStrategy], risk_profile: str) -> str | None:
    if not strategies:
        return None
    if risk_profile == "conservative":
        selected = max(strategies, key=lambda item: (item.pop or -1.0, item.position_score or -1))
    elif risk_profile == "aggressive":
        selected = max(strategies, key=lambda item: (item.position_score or -1, -(item.pop or 0.0)))
    else:
        selected = min(strategies, key=lambda item: item.rank or 10_000)
    return selected.id


class PositionTradeService:
    def __init__(self, analyze_ticker: AnalyzeTicker, load_tickers: LoadTickers):
        self.analyze_ticker = analyze_ticker
        self.load_tickers = load_tickers

    def _analyze(self, symbol: str, weeks_out: int, strategy_mode: str) -> AnalyzeResponse:
        return self.analyze_ticker(
            symbol,
            weeks_out=weeks_out,
            strategy_mode=_engine_strategy_mode(strategy_mode),
            force_refresh=False,
        )

    def scanner(
        self,
        email: str,
        weeks_out: PositionWeeksOut,
        strategy_mode: PositionStrategyMode,
        risk_profile: PositionRiskProfile,
        iv_rank_min: float | None = None,
        pop_min: float | None = None,
        expected_return_min: float | None = None,
        dte_max: int | None = None,
        min_confidence: float | None = None,
    ) -> PositionScannerEnvelope:
        generated_at = _utc_now()
        rows: list[PositionScannerRow] = []
        failures = 0
        for ticker in self.load_tickers(email)[:15]:
            symbol = str(ticker.get("symbol") or ticker.get("ticker") or "").strip().upper()
            if not symbol:
                continue
            company = str(ticker.get("company_name") or ticker.get("company") or "").strip() or None
            try:
                analysis = self._analyze(symbol, weeks_out, strategy_mode)
                recommendations = _filter_recommendations(analysis, strategy_mode)
                rec = recommendations[0] if recommendations else None
                if rec is not None:
                    iv_rank = _number(analysis.signals.iv_rank)
                    pop = _number(rec.prob_of_profit)
                    expected_return = _number(rec.expected_value)
                    confidence = _number(analysis.display_confidence or analysis.confidence)
                    if iv_rank_min is not None and (iv_rank is None or iv_rank < iv_rank_min):
                        rec = None
                    if rec is not None and pop_min is not None and (pop is None or pop < pop_min):
                        rec = None
                    if rec is not None and expected_return_min is not None and (expected_return is None or expected_return < expected_return_min):
                        rec = None
                    if rec is not None and dte_max is not None and (rec.dte is None or rec.dte > dte_max):
                        rec = None
                    if rec is not None and min_confidence is not None and (confidence is None or confidence < min_confidence):
                        rec = None
                if rec is None:
                    continue
                rows.append(
                    PositionScannerRow(
                        symbol=symbol,
                        company=(analysis.company_name or company),
                        recommendation=rec.strategy if rec else None,
                        position_score=rec.scores.total_score if rec else None,
                        pop=rec.prob_of_profit if rec else None,
                        dte=rec.dte if rec else None,
                        bias=rec.bias if rec else analysis.signals.directional_bias,
                        trend=analysis.signals.trend or None,
                        data_quality=_availability(analysis, has_strategies=rec is not None),
                    )
                )
            except Exception:
                failures += 1
                rows.append(
                    PositionScannerRow(
                        symbol=symbol,
                        company=company,
                        data_quality="unavailable",
                    )
                )
        availability = _overall_availability(rows)
        error = None
        if availability == "unavailable":
            error = PositionApiError(
                code="POSITION_SCANNER_UNAVAILABLE",
                message="No position-trade analyses are currently available.",
            )
        elif failures:
            error = PositionApiError(
                code="POSITION_SCANNER_PARTIAL",
                message=f"Analysis was unavailable for {failures} symbol(s).",
            )
        return PositionScannerEnvelope(
            data=PositionScannerData(
                generated_at=generated_at,
                last_scan_time=generated_at,
                availability=availability,
                rows=rows,
            ),
            error=error,
            stale=availability == "stale",
            fetched_at=generated_at,
        )

    def workspace(
        self,
        email: str,
        symbol: str,
        weeks_out: PositionWeeksOut,
        strategy_mode: PositionStrategyMode,
        risk_profile: PositionRiskProfile,
    ) -> PositionWorkspaceEnvelope:
        generated_at = _utc_now()
        ticker = symbol.strip().upper()
        watchlist = self.load_tickers(email)[:15]
        symbols = [
            str(item.get("symbol") or item.get("ticker") or "").strip().upper()
            for item in watchlist
            if str(item.get("symbol") or item.get("ticker") or "").strip()
        ]
        company = next(
            (
                str(item.get("company_name") or item.get("company") or "").strip() or None
                for item in watchlist
                if str(item.get("symbol") or item.get("ticker") or "").strip().upper() == ticker
            ),
            None,
        )
        if ticker not in symbols:
            return PositionWorkspaceEnvelope(
                data=PositionWorkspaceData(
                    meta=PositionWorkspaceMeta(generated_at=generated_at, availability="unavailable"),
                    header=PositionHeader(
                        symbol=ticker,
                        company=company,
                        availability="unavailable",
                    ),
                    chart=None,
                    market_structure=None,
                    decision=None,
                    strategies=None,
                    selected_strategy_id=None,
                    tutorial=None,
                    watchlist=PositionWatchlist(symbols=symbols, updated_at=None, is_watched=False),
                ),
                error=PositionApiError(
                    code="POSITION_SYMBOL_NOT_REGULAR_MY_TICKER",
                    message="Add this ticker to My Tickers with the Regular type to use Position Trading.",
                    symbol=ticker,
                ),
                fetched_at=generated_at,
            )
        try:
            analysis = self._analyze(ticker, weeks_out, strategy_mode)
        except Exception as exc:
            return PositionWorkspaceEnvelope(
                data=PositionWorkspaceData(
                    meta=PositionWorkspaceMeta(generated_at=generated_at, availability="unavailable"),
                    header=PositionHeader(
                        symbol=ticker,
                        company=company,
                        availability="unavailable",
                    ),
                    chart=None,
                    market_structure=None,
                    decision=None,
                    strategies=None,
                    selected_strategy_id=None,
                    tutorial=None,
                    watchlist=PositionWatchlist(symbols=symbols, updated_at=None),
                ),
                error=PositionApiError(
                    code="POSITION_WORKSPACE_UNAVAILABLE",
                    message=str(getattr(exc, "detail", None) or "Position-trade analysis is unavailable."),
                    symbol=ticker,
                ),
                fetched_at=generated_at,
            )

        availability = _availability(analysis, has_strategies=bool(analysis.recommendations))
        strategies = [
            _strategy(analysis, rec, weeks_out, strategy_mode, risk_profile)
            for rec in _filter_recommendations(analysis, strategy_mode)
        ]
        chart_points = [
            PositionChartPoint(time=point.date or None, value=_number(point.close))
            for point in analysis.price_history
        ]
        top = analysis.recommendations[0] if analysis.recommendations else None
        top_details = _strategy_details(analysis, top, _number(analysis.signals.current_price) or 0) if top else None
        why = [item for item in [*(analysis.supporting_factors or []), top.rationale if top else None] if item]
        cards = [
            PositionDecisionCard(
                title="Position score",
                value=top.scores.total_score if top else None,
                detail=analysis.setup_quality or None,
                status=analysis.verdict or None,
            ),
            PositionDecisionCard(
                title="Probability of profit",
                value=top.prob_of_profit if top else None,
                detail=top.strategy if top else None,
                status=analysis.risk_state or None,
            ),
            PositionDecisionCard(
                title="Bias confidence",
                value=analysis.signals.bias_confidence,
                detail=analysis.signals.directional_bias or None,
                status=analysis.signals.trend_strength or None,
            ),
        ]
        tutorial = None
        if top is not None:
            sections = [
                PositionTutorialStep(title="Overview", body=top.rationale or None),
                PositionTutorialStep(title="Ideal Market", body=analysis.market_bias or analysis.signals.directional_bias or None),
                PositionTutorialStep(title="Ideal IV", body=analysis.signals.iv_environment or _format_percent(analysis.signals.iv_rank)),
                PositionTutorialStep(title="Ideal DTE", body=f"{top.dte} DTE"),
                PositionTutorialStep(title="Max Profit", body=str(top.max_profit) if top.max_profit is not None else None),
                PositionTutorialStep(title="Max Loss", body=str(top.max_loss) if top.max_loss is not None else None),
                PositionTutorialStep(title="Break-even", body=str(_breakeven(top) or "")),
                PositionTutorialStep(title="Avoid Conditions", body="; ".join(top.warnings) if top.warnings else None),
                PositionTutorialStep(title="Example Trade", body=", ".join(f"{leg.action} {leg.option_type} {leg.strike}" for leg in top.legs) or None),
                PositionTutorialStep(title="Payoff Diagram", body="Rendered from backend payoff points in the execution rail."),
                PositionTutorialStep(title="Management Rules", body=top.exit_plan or None),
            ]
            tutorial = PositionTutorial(
                title=top.strategy or None,
                summary=top.rationale or None,
                steps=[
                    PositionTutorialStep(title="Trade thesis", body=top.rationale or None),
                    PositionTutorialStep(title="Management", body=top.exit_plan or None),
                ],
                sections=sections,
            )
        error = None
        if not strategies:
            error = PositionApiError(
                code="POSITION_STRATEGIES_UNAVAILABLE",
                message="Market data is available, but the engine produced no eligible strategies.",
                symbol=ticker,
            )
        return PositionWorkspaceEnvelope(
            data=PositionWorkspaceData(
                meta=PositionWorkspaceMeta(generated_at=generated_at, availability=availability),
                header=PositionHeader(
                    symbol=analysis.ticker or ticker,
                    company=analysis.company_name or company,
                    sector=analysis.sector or None,
                    industry=None,
                    price=_number(analysis.signals.current_price),
                    change=_number(analysis.signals.price_change),
                    change_pct=_number(analysis.signals.price_change_pct),
                    market_cap=analysis.market_cap or None,
                    volume=None,
                    iv_rank=_number(analysis.signals.iv_rank),
                    earnings=None,
                    market_bias=analysis.market_bias or analysis.signals.directional_bias or None,
                    as_of=generated_at,
                    availability=availability,
                ),
                chart=_position_chart(analysis, top),
                market_structure=_market_structure(analysis),
                decision=PositionDecision(
                    verdict=analysis.verdict or top.status if top else analysis.verdict or None,
                    recommended_strategy=top.strategy if top else None,
                    score=top.scores.total_score if top else None,
                    confidence=analysis.display_confidence or analysis.confidence or None,
                    summary=analysis.reason or top.rationale if top else analysis.reason or None,
                    why=why[:6] or None,
                    key_levels=top_details.key_levels if top_details else None,
                    timeline=top_details.timeline if top_details else None,
                    headline=analysis.verdict or None,
                    detail=analysis.reason or None,
                    cards=cards,
                ),
                strategies=strategies,
                selected_strategy_id=_selected_strategy(strategies, risk_profile),
                tutorial=tutorial,
                watchlist=PositionWatchlist(symbols=symbols, updated_at=None, is_watched=ticker in symbols),
            ),
            error=error,
            stale=availability == "stale",
            fetched_at=generated_at,
        )

    def scenario(self, email: str, body: PositionScenarioRequest) -> PositionScenarioEnvelope:
        generated_at = _utc_now()
        symbol = body.symbol.strip().upper()
        allowed_symbols = {
            str(item.get("symbol") or item.get("ticker") or "").strip().upper()
            for item in self.load_tickers(email)
            if str(item.get("symbol") or item.get("ticker") or "").strip()
        }
        if symbol not in allowed_symbols:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_SYMBOL_NOT_REGULAR_MY_TICKER",
                "Add this ticker to My Tickers with the Regular type to use Position Trading.",
            )
        parsed = _parse_candidate_id(body.candidate_id)
        if parsed is None or parsed[0] != symbol:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_CANDIDATE_INVALID",
                "The candidate identifier is invalid for this symbol.",
            )
        _, weeks_out, strategy_mode, _risk_profile, expiry, strategy_name = parsed
        if weeks_out not in {2, 4, 6, 8}:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_CANDIDATE_INVALID",
                "The candidate identifier contains an unsupported horizon.",
            )
        try:
            analysis = self._analyze(symbol, weeks_out, strategy_mode)
        except Exception as exc:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_SCENARIO_UNAVAILABLE",
                str(getattr(exc, "detail", None) or "Position scenario analysis is unavailable."),
            )
        rec = next(
            (
                candidate
                for candidate in analysis.recommendations
                if candidate.expiry == expiry and candidate.strategy == strategy_name
            ),
            None,
        )
        if rec is None:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_CANDIDATE_UNAVAILABLE",
                "The candidate is no longer present in the current engine output.",
            )
        spot = _number(analysis.signals.current_price)
        if spot is None or spot <= 0:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_PRICE_UNAVAILABLE",
                "A current underlying price is required for the scenario.",
            )
        target_price = max(0.0, spot * (1.0 + body.price_move_pct / 100.0))
        per_share = _strategy_payoff(rec, spot, target_price)
        if per_share is None:
            return self._scenario_unavailable(
                generated_at,
                symbol,
                "POSITION_PAYOFF_UNAVAILABLE",
                "An intrinsic-only payoff is unavailable for strategies with multiple expiries.",
            )
        total = round(per_share * 100 * body.contracts, 2)
        payoff = _payoff(rec, spot, contracts=body.contracts)
        availability = _availability(analysis)
        return PositionScenarioEnvelope(
            data=PositionScenarioData(
                title=f"{symbol} {rec.strategy} scenario",
                summary=f"At ${target_price:.2f}, expiration P&L is ${total:.2f} for {body.contracts} contract(s).",
                availability=availability,
                payoff=payoff,
                values=[
                    PositionExpectation(label="Current price", value=round(spot, 2)),
                    PositionExpectation(label="Scenario price", value=round(target_price, 2)),
                    PositionExpectation(label="Price move", value=body.price_move_pct),
                    PositionExpectation(label="Contracts", value=body.contracts),
                    PositionExpectation(label="Expiration P&L", value=total),
                ],
            ),
            stale=availability == "stale",
            fetched_at=generated_at,
        )

    @staticmethod
    def _scenario_unavailable(
        generated_at: datetime,
        symbol: str,
        code: str,
        message: str,
    ) -> PositionScenarioEnvelope:
        return PositionScenarioEnvelope(
            data=PositionScenarioData(
                title=f"{symbol} scenario",
                summary=None,
                availability="unavailable",
                payoff=None,
                values=None,
            ),
            error=PositionApiError(code=code, message=message, symbol=symbol),
            fetched_at=generated_at,
        )
