from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

MarketBias = Literal["BULLISH", "BEARISH", "NEUTRAL", "MIXED"]
SetupQuality = Literal["STRONG", "GOOD", "FAIR", "WEAK", "POOR"]
ExecutionReadiness = Literal["READY", "WAIT", "AVOID", "NO_EDGE", "MANAGE", "SCALE_OUT", "EXIT", "WATCH", "TRADE"]
FinalDecision = Literal["READY", "WAIT", "AVOID", "NO_EDGE", "MANAGE", "SCALE_OUT", "EXIT", "WATCH", "TRADE"]
RiskState = Literal["LOW", "MEDIUM", "HIGH", "EXTREME"]


class ResolvedTradeDecision(BaseModel):
    # ── Unified verdict (single source of truth, computed by verdict_resolver) ──
    # Values: STRONG_GO | GO | WATCH | WAIT | AVOID | NO_EDGE
    # This is the ONLY verdict field the command center and cards should display.
    verdict: str = "NO_EDGE"

    market_bias: MarketBias = "NEUTRAL"
    setup_quality: SetupQuality = "WEAK"
    execution_readiness: ExecutionReadiness = "WAIT"
    final_decision: FinalDecision = "WAIT"
    confidence: int = Field(default=0, ge=0, le=100)
    reason: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    missing_confirmations: list[str] = Field(default_factory=list)
    risk_state: RiskState = "MEDIUM"

    # Detail fields — shown on detail pages only, not command center cards
    signal_quality: str = ""
    execution_timing: str = ""
    risk_category: str = ""
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = Field(default=0, ge=0, le=100)
    execution_fields: list[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def _compute_verdict(self) -> "ResolvedTradeDecision":
        if self.verdict == "NO_EDGE":
            # Auto-derive from final_decision + setup_quality if not explicitly set
            from verdict_resolver import resolve_verdict_from_final_decision
            self.verdict = resolve_verdict_from_final_decision(
                self.final_decision,
                self.setup_quality,
                self.risk_state,
            )
        return self
