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
    changeAmount: DayTradeDisplayValue
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


class DayTradeSetupLifecycleView(BaseModel):
    setupType: str
    triggerTime: str | None = None
    triggerPrice: float | None = None
    status: str
    result: str | None = None
    validFrom: str | None = None
    validUntil: str | None = None
    currentGainPct: float | None = None


class DayTradeCurrentStateView(BaseModel):
    state: str
    score: float
    explanation: str


class DayTradeCurrentActionView(BaseModel):
    action: str
    reason: str
    recommendation: str
    confidence: float


class DayTradeNextOpportunityView(BaseModel):
    nextOpportunity: str
    trigger: str
    explanation: str
    probability: float


class DayTradeExpectedStructureOptionView(BaseModel):
    label: str
    probability: float


class DayTradeExpectedStructureView(BaseModel):
    current: list[str] = Field(default_factory=list)
    expected: list[DayTradeExpectedStructureOptionView] = Field(default_factory=list)
    explanation: str


class DayTradeTrendHealthView(BaseModel):
    score: float
    label: str
    explanation: str
    inputs: dict[str, float] = Field(default_factory=dict)


class DayTradeRewardRiskView(BaseModel):
    risk: DayTradeDisplayValue
    reward: DayTradeDisplayValue
    ratio: float | None = None
    display: str
    targetUsed: str | None = None


class DayTradeDecisionEngineView(BaseModel):
    setup: DayTradeSetupLifecycleView
    currentState: DayTradeCurrentStateView
    currentAction: DayTradeCurrentActionView
    nextOpportunity: DayTradeNextOpportunityView
    expectedStructure: DayTradeExpectedStructureView
    trendHealth: DayTradeTrendHealthView
    rewardRisk: DayTradeRewardRiskView
    explanation: str
    confidence: float
    reasoning: list[str] = Field(default_factory=list)


class DayTradeMetricView(BaseModel):
    value: Any = None
    display: str
    formula: str | None = None
    inputs: list[str] = Field(default_factory=list)
    reason: str | None = None
    timestamp: str | None = None
    confidence: float | None = None
    source: str | None = None


class DayTradeDecisionHierarchyView(BaseModel):
    marketContext: DayTradeMetricView
    stockBias: DayTradeMetricView
    setup: DayTradeMetricView
    currentPhase: DayTradeMetricView
    nextOpportunity: DayTradeMetricView
    originalEntry: DayTradeMetricView | None = None
    currentAction: DayTradeMetricView


class DayTradeReasoningEngineView(BaseModel):
    positiveFactors: list[DayTradeMetricView] = Field(default_factory=list)
    negativeFactors: list[DayTradeMetricView] = Field(default_factory=list)
    neutralFactors: list[DayTradeMetricView] = Field(default_factory=list)


class DayTradeDecisionChangeView(BaseModel):
    bullish: list[DayTradeMetricView] = Field(default_factory=list)
    bearish: list[DayTradeMetricView] = Field(default_factory=list)
    invalidation: list[DayTradeMetricView] = Field(default_factory=list)


class DayTradeConfidenceView(BaseModel):
    biasConfidence: DayTradeMetricView
    tradeConfidence: DayTradeMetricView
    entryQuality: DayTradeMetricView
    entryTiming: DayTradeMetricView


class DayTradeEngineScoresView(BaseModel):
    trendScore: DayTradeMetricView
    structureScore: DayTradeMetricView
    momentumScore: DayTradeMetricView
    volumeScore: DayTradeMetricView
    marketScore: DayTradeMetricView
    entryScore: DayTradeMetricView
    overallTradeScore: DayTradeMetricView


class DayTradeRiskDecisionView(BaseModel):
    entry: DayTradeMetricView
    stop: DayTradeMetricView
    risk: DayTradeMetricView
    target: DayTradeMetricView
    riskReward: DayTradeMetricView
    rewardRemaining: DayTradeMetricView
    riskRemaining: DayTradeMetricView
    tradeQuality: DayTradeMetricView


class DayTradeTimelineEventView(BaseModel):
    id: str
    label: str
    phase: str
    timestamp: str | None = None
    price: float | None = None
    status: str
    reason: str | None = None


class DayTradeMarketContextView(BaseModel):
    spy: DayTradeMetricView
    qqq: DayTradeMetricView
    sector: DayTradeMetricView
    vix: DayTradeMetricView
    breadth: DayTradeMetricView
    relativeStrength: DayTradeMetricView


class DayTradeAiCoachView(BaseModel):
    lines: list[str] = Field(default_factory=list)


class DayTradeProfessionalDecisionView(BaseModel):
    hierarchy: DayTradeDecisionHierarchyView
    why: DayTradeReasoningEngineView
    changesDecision: DayTradeDecisionChangeView
    confidence: DayTradeConfidenceView
    scores: DayTradeEngineScoresView
    risk: DayTradeRiskDecisionView
    marketContext: DayTradeMarketContextView
    # Canonical intraday-table gates; the workspace only presents these values.
    blockers: list[DayTradeMetricView] = Field(default_factory=list)
    timeline: list[DayTradeTimelineEventView] = Field(default_factory=list)
    aiCoach: DayTradeAiCoachView


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


class DayTradeSigmaPointView(BaseModel):
    barStartUtc: str
    plusOne: float | None = None
    minusOne: float | None = None
    plusTwo: float | None = None
    minusTwo: float | None = None
    sourceTimestampUtc: str
    state: str
    quality: str


class DayTradeSigmaOverlayView(BaseModel):
    id: str
    label: str
    sessionDate: str
    exchangeTimeZone: str
    anchorPolicy: str
    visibleByDefault: bool
    affectsTradeFocusScale: bool
    points: list[DayTradeSigmaPointView] = Field(default_factory=list)


class DayTradeStructurePivotView(BaseModel):
    id: str
    timestamp: str
    label: str
    classification: str | None = None
    pivotType: str
    type: str | None = None
    price: float
    sourceTimeframe: str
    timeframe: str | None = None
    confirmed: bool
    status: str | None = None
    latest: bool = False
    explanation: str | None = None


class DayTradeMarketStructureView(BaseModel):
    id: str
    timeframe: str | None = None
    trend: str
    structure: str
    display: str
    confidence: float | None = None
    sequence: list[str] = Field(default_factory=list)
    currentPivot: str | None = None
    currentPivotDetail: DayTradeStructurePivotView | None = None
    provisionalPivot: DayTradeStructurePivotView | None = None
    expectedNext: str | None = None
    expectedNextPivot: str | None = None
    invalidationLevel: float | None = None
    invalidation: dict[str, Any] | None = None
    structureStrength: float | None = None
    sourceTimeframe: str
    pivots: list[DayTradeStructurePivotView] = Field(default_factory=list)
    settings: dict[str, Any] | None = None
    visibleByDefault: bool = True
    showZigZagByDefault: bool = True
    explanation: str | None = None


class DayTradePatternSegmentView(BaseModel):
    id: str
    fromTimestamp: str
    fromPrice: float
    toTimestamp: str
    toPrice: float
    role: str


class DayTradePatternOverlayView(BaseModel):
    id: str
    label: str
    direction: str
    status: str
    tone: str
    confidence: float
    detail: str
    breakoutLevel: float
    stopLevel: float
    targetLevel: float
    visibleByDefault: bool = True
    segments: list[DayTradePatternSegmentView] = Field(default_factory=list)


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
    sigmaOverlay: DayTradeSigmaOverlayView | None = None
    marketStructure: DayTradeMarketStructureView | None = None
    patternOverlay: DayTradePatternOverlayView | None = None
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
    decisionEngine: DayTradeDecisionEngineView | None = None
    professionalDecision: DayTradeProfessionalDecisionView | None = None
    evidence: list[DayTradeEvidenceItemView] = Field(default_factory=list)
    selectedContract: DayTradeSelectedContractView | None = None
    trapDetection: dict[str, Any] | None = None
    chart: DayTradeChartView
    tabs: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] | None = None
