from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MarketBias = Literal["BULLISH", "BEARISH", "NEUTRAL", "MIXED"]
SetupQuality = Literal["STRONG", "GOOD", "FAIR", "WEAK", "POOR"]
ExecutionReadiness = Literal["READY", "WAIT", "AVOID", "NO_EDGE", "MANAGE", "SCALE_OUT", "EXIT", "WATCH", "TRADE"]
FinalDecision = Literal["READY", "WAIT", "AVOID", "NO_EDGE", "MANAGE", "SCALE_OUT", "EXIT", "WATCH", "TRADE"]
RiskState = Literal["LOW", "MEDIUM", "HIGH", "EXTREME"]


class ResolvedTradeDecision(BaseModel):
    market_bias: MarketBias = "NEUTRAL"
    setup_quality: SetupQuality = "WEAK"
    execution_readiness: ExecutionReadiness = "WAIT"
    final_decision: FinalDecision = "WAIT"
    confidence: int = Field(default=0, ge=0, le=100)
    reason: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    missing_confirmations: list[str] = Field(default_factory=list)
    risk_state: RiskState = "MEDIUM"

    # Three-axis display fields (added 2026-05): separate opportunity quality
    # from timing and risk to eliminate contradictory UX (e.g. STRONG GO + AVOID).
    signal_quality: str = ""         # "STRONG GO" | "GO" | "READY" | ""
    execution_timing: str = ""       # "ENTER NOW" | "WAIT FOR PULLBACK" | "WATCH" | "STAND ASIDE" | "MANAGE" | ""
    risk_category: str = ""          # "LOW" | "MODERATE" | "EXTENDED" | "HIGH" | ""

    # Strategy-aware explanation fields (added 2026-05)
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = Field(default=0, ge=0, le=100)
    execution_fields: list[dict] = Field(default_factory=list)
