from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DayTradeDisplayValue(BaseModel):
    raw: float | str | None = None
    display: str
    tone: str | None = None
    helpText: str | None = None


class DayTradeDisplayStatus(BaseModel):
    code: str
    label: str
    tone: str
    iconKey: str | None = None
    description: str | None = None


class DayTradeWorkspaceAction(BaseModel):
    id: str
    type: str
    label: str
    enabled: bool
    disabledReason: str | None = None
    payload: dict[str, str | int | float | bool | None] | None = None


class DayTradeSymbolView(BaseModel):
    ticker: str
    companyName: str | None = None
    price: DayTradeDisplayValue
    change: DayTradeDisplayValue


class DayTradeSessionView(BaseModel):
    mode: str
    status: DayTradeDisplayStatus
    sessionDate: str
    displayDate: str
    marketTimeZone: str
    isExecutionAllowed: bool
    reviewCopy: str | None = None


class DayTradeDecisionView(BaseModel):
    context: DayTradeDisplayStatus
    permission: DayTradeDisplayStatus
    headline: str
    reason: str
    nextCondition: str | None = None
    setupName: str | None = None
    primaryAction: DayTradeWorkspaceAction
    secondaryActions: list[DayTradeWorkspaceAction] = Field(default_factory=list)


class DayTradeTriggerRequirementView(BaseModel):
    id: str
    label: str
    displayValue: str | None = None
    result: str
    tone: str


class DayTradeTriggerView(BaseModel):
    status: DayTradeDisplayStatus
    summary: str
    requirements: list[DayTradeTriggerRequirementView] = Field(default_factory=list)


class DayTradeRiskPlanView(BaseModel):
    entry: DayTradeDisplayValue
    stop: DayTradeDisplayValue
    target1: DayTradeDisplayValue
    target2: DayTradeDisplayValue
    positionSize: DayTradeDisplayValue
    riskReward: DayTradeDisplayValue


class DayTradeEvidenceItemView(BaseModel):
    id: str
    label: str
    detail: str | None = None
    result: str
    tone: str
    order: int
    ruleId: str | None = None
    observedAt: str | None = None


class DayTradeSelectedContractView(BaseModel):
    expiration: DayTradeDisplayValue
    dte: DayTradeDisplayValue
    strike: DayTradeDisplayValue
    optionType: DayTradeDisplayValue
    bid: DayTradeDisplayValue
    ask: DayTradeDisplayValue
    midpoint: DayTradeDisplayValue
    spread: DayTradeDisplayValue
    spreadPercent: DayTradeDisplayValue
    liquidity: DayTradeDisplayStatus
    roundTrip: DayTradeDisplayValue


class DayTradeChartCandleView(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class DayTradeChartLevelView(BaseModel):
    id: str
    kind: str
    price: float
    label: str
    tone: str
    lineStyleToken: str
    active: bool
    visibleByDefault: bool
    affectsTradeFocusScale: bool
    priority: int
    offscreenLabel: str | None = None


class DayTradeChartEventView(BaseModel):
    id: str
    timestamp: str
    eventType: str
    title: str
    detail: str | None = None
    tone: str
    visibleByDefault: bool
    priority: int
    price: float | None = None


class DayTradeVwapPointView(BaseModel):
    barStartUtc: str
    value: float | None = None
    sourceTimestampUtc: str
    state: str
    quality: str


class DayTradeVwapOverlayView(BaseModel):
    id: str
    label: str
    sessionDate: str
    exchangeTimeZone: str
    anchorPolicy: str
    includesExtendedHours: bool
    latestValue: float | None = None
    latestAsOfUtc: str | None = None
    visibleByDefault: bool
    affectsTradeFocusScale: bool
    points: list[DayTradeVwapPointView] = Field(default_factory=list)


class DayTradeChartDefaultsView(BaseModel):
    interval: str
    visibleRange: str
    initialVisibleBars: int
    initialBarSpacing: int
    minBarSpacing: int
    maxBarSpacing: int
    rightOffsetBars: int
    scaleMode: str
    followLive: bool
    visibleOverlayIds: list[str] = Field(default_factory=list)


class DayTradeChartTradeFocusView(BaseModel):
    scalePaddingPercent: float
    levelIdsAllowedToAffectScale: list[str] = Field(default_factory=list)


class DayTradeChartView(BaseModel):
    candles: list[DayTradeChartCandleView] = Field(default_factory=list)
    levels: list[DayTradeChartLevelView] = Field(default_factory=list)
    events: list[DayTradeChartEventView] = Field(default_factory=list)
    vwapOverlay: DayTradeVwapOverlayView | None = None
    defaults: DayTradeChartDefaultsView
    tradeFocus: DayTradeChartTradeFocusView | None = None


class DayTradeWorkspaceResponse(BaseModel):
    schemaVersion: str
    generatedAt: str
    symbol: DayTradeSymbolView
    session: DayTradeSessionView
    decision: DayTradeDecisionView
    trigger: DayTradeTriggerView
    riskPlan: DayTradeRiskPlanView
    evidence: list[DayTradeEvidenceItemView] = Field(default_factory=list)
    selectedContract: DayTradeSelectedContractView | None = None
    chart: DayTradeChartView
    tabs: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] | None = None
