"""Typed API contracts for the position-trade scanner and workspace."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from day_trade_workspace_models import DayTradeChartView


PositionAvailability = Literal["available", "partial", "stale", "unavailable"]
PositionWeeksOut = int
PositionStrategyMode = str
PositionRiskProfile = Literal["conservative", "balanced", "aggressive"]


class PositionApiError(BaseModel):
    code: str
    message: str
    symbol: str | None = None


class PositionScannerRow(BaseModel):
    symbol: str | None = None
    company: str | None = None
    recommendation: str | None = None
    position_score: int | None = None
    pop: float | None = None
    dte: int | None = None
    bias: str | None = None
    trend: str | None = None
    data_quality: PositionAvailability | None = None


class PositionScannerData(BaseModel):
    generated_at: datetime | None = None
    last_scan_time: datetime | None = None
    availability: PositionAvailability | None = None
    rows: list[PositionScannerRow] | None = None


class PositionScannerEnvelope(BaseModel):
    data: PositionScannerData
    error: PositionApiError | None = None
    stale: bool = False
    fetched_at: datetime


class PositionWorkspaceMeta(BaseModel):
    generated_at: datetime | None = None
    availability: PositionAvailability | None = None


class PositionHeader(BaseModel):
    symbol: str | None = None
    company: str | None = None
    sector: str | None = None
    industry: str | None = None
    price: float | None = None
    change: float | None = None
    change_pct: float | None = None
    market_cap: str | None = None
    volume: str | float | int | None = None
    iv_rank: float | None = None
    earnings: str | None = None
    market_bias: str | None = None
    as_of: datetime | None = None
    availability: PositionAvailability | None = None


class PositionChartPoint(BaseModel):
    time: str | None = None
    value: float | None = None


class PositionChart(BaseModel):
    title: str | None = None
    subtitle: str | None = None
    points: list[PositionChartPoint] | None = None
    x_label: str | None = None
    y_label: str | None = None


class PositionKeyLevel(BaseModel):
    label: str | None = None
    value: str | float | None = None
    detail: str | None = None


class PositionMarketStructure(BaseModel):
    title: str | None = None
    summary: str | None = None
    trend: str | None = None
    bias: str | None = None
    key_levels: list[PositionKeyLevel] | None = None
    items: list[PositionKeyLevel] | None = None
    levels: list[PositionKeyLevel] | None = None


class PositionDecisionCard(BaseModel):
    title: str | None = None
    value: str | float | int | None = None
    detail: str | None = None
    status: str | None = None


class PositionDecision(BaseModel):
    verdict: str | None = None
    recommended_strategy: str | None = None
    score: int | None = None
    confidence: str | float | int | None = None
    summary: str | None = None
    why: list[str] | None = None
    key_levels: list[PositionKeyLevel] | None = None
    timeline: list[PositionTimelineItem] | None = None
    headline: str | None = None
    detail: str | None = None
    cards: list[PositionDecisionCard] | None = None


class PositionLeg(BaseModel):
    action: str | None = None
    type: str | None = None
    strike: float | None = None
    expiry: str | None = None
    quantity: int | None = None


class PositionPayoffPoint(BaseModel):
    price: float | None = None
    value: float | None = None
    label: str | None = None


class PositionPayoff(BaseModel):
    points: list[PositionPayoffPoint] | None = None
    x_label: str | None = None
    y_label: str | None = None


class PositionExpectation(BaseModel):
    label: str | None = None
    value: str | float | int | None = None
    detail: str | None = None


class PositionChecklistItem(BaseModel):
    label: str | None = None
    status: str | None = None
    detail: str | None = None


class PositionTimelineItem(BaseModel):
    label: str | None = None
    detail: str | None = None
    value: str | float | int | None = None


class PositionStrategyDetails(BaseModel):
    expiry: str | None = None
    legs: list[PositionLeg] | None = None
    position_size: str | float | int | None = None
    breakeven: str | float | None = None
    iv_rank: float | None = None
    payoff: PositionPayoff | None = None
    payoff_points: list[PositionPayoffPoint] | None = None
    scenario_range: dict[str, float | None] | None = None
    probability_expectations: list[PositionExpectation] | None = None
    checklist: list[PositionChecklistItem] | None = None
    checklist_items: list[PositionChecklistItem] | None = None
    timeline: list[PositionTimelineItem] | None = None
    key_levels: list[PositionKeyLevel] | None = None


class PositionStrategy(BaseModel):
    id: str | None = None
    rank: int | None = None
    name: str | None = None
    direction: str | None = None
    position_score: int | None = None
    pop: float | None = None
    debit_credit: str | float | None = None
    max_profit: str | float | None = None
    max_loss: str | float | None = None
    risk_reward: str | float | None = None
    dte: int | None = None
    details: PositionStrategyDetails | None = None


class PositionTutorialStep(BaseModel):
    title: str | None = None
    body: str | None = None


class PositionTutorial(BaseModel):
    title: str | None = None
    summary: str | None = None
    steps: list[PositionTutorialStep] | None = None
    sections: list[PositionTutorialStep] | None = None


class PositionWatchlist(BaseModel):
    symbols: list[str] | None = None
    updated_at: datetime | None = None
    is_watched: bool = False


class PositionWorkspaceData(BaseModel):
    meta: PositionWorkspaceMeta | None = None
    header: PositionHeader | None = None
    chart: DayTradeChartView | None = None
    market_structure: PositionMarketStructure | None = None
    decision: PositionDecision | None = None
    strategies: list[PositionStrategy] | None = None
    selected_strategy_id: str | None = None
    tutorial: PositionTutorial | None = None
    watchlist: PositionWatchlist | None = None


class PositionWorkspaceEnvelope(BaseModel):
    data: PositionWorkspaceData
    error: PositionApiError | None = None
    stale: bool = False
    fetched_at: datetime


class PositionScenarioRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=12, pattern=r"^[A-Za-z][A-Za-z0-9.\-]*$")
    candidate_id: str = Field(..., min_length=1, max_length=300)
    price_move_pct: float = Field(..., ge=-100, le=1000)
    contracts: int = Field(..., ge=1, le=1000)


class PositionScenarioData(BaseModel):
    title: str | None = None
    summary: str | None = None
    availability: PositionAvailability | None = None
    payoff: PositionPayoff | None = None
    values: list[PositionExpectation] | None = None


class PositionScenarioEnvelope(BaseModel):
    data: PositionScenarioData
    error: PositionApiError | None = None
    stale: bool = False
    fetched_at: datetime
