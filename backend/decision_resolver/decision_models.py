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
