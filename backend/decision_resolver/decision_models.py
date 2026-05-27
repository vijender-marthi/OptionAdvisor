from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MarketBias = Literal["BULLISH", "BEARISH", "NEUTRAL", "MIXED"]
SetupQuality = Literal["STRONG", "GOOD", "FAIR", "WEAK", "POOR"]
VerdictDisplay = Literal["STRONG_GO", "GO", "WATCH", "WAIT", "AVOID", "NO_EDGE"]
RiskState = Literal["LOW", "MEDIUM", "HIGH", "EXTREME"]


class ResolvedTradeDecision(BaseModel):
    market_bias: MarketBias = "NEUTRAL"
    setup_quality: SetupQuality = "WEAK"
    verdict: VerdictDisplay = "WAIT"
    confidence: int = Field(default=0, ge=0, le=100)
    reason: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    missing_confirmations: list[str] = Field(default_factory=list)
    risk_state: RiskState = "MEDIUM"

    # Strategy-aware explanation fields (added 2026-05)
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = Field(default=0, ge=0, le=100)
    execution_fields: list[dict] = Field(default_factory=list)
