"""HTTP routing for the position-trade workspace."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from auth_routes import require_access_email
from position_trade_models import (
    PositionRiskProfile,
    PositionScannerEnvelope,
    PositionScenarioEnvelope,
    PositionScenarioRequest,
    PositionStrategyMode,
    PositionWeeksOut,
    PositionWorkspaceEnvelope,
)
from position_trade_service import PositionTradeService


def _validate_weeks_out(value: int) -> int:
    if value not in {2, 4, 6, 8}:
        raise HTTPException(status_code=422, detail="weeks_out must be one of 2, 4, 6, or 8")
    return value


def create_position_trade_router(service: PositionTradeService) -> APIRouter:
    router = APIRouter(prefix="/position-trade", tags=["position-trade"])

    @router.get("/scanner", response_model=PositionScannerEnvelope)
    def get_position_trade_scanner(
        weeks_out: PositionWeeksOut = Query(default=4, ge=2, le=8),
        strategy_mode: PositionStrategyMode = Query(default="all"),
        risk_profile: PositionRiskProfile = Query(default="balanced"),
        iv_rank_min: float | None = Query(default=None, ge=0, le=100),
        pop_min: float | None = Query(default=None, ge=0, le=100),
        expected_return_min: float | None = Query(default=None, ge=0),
        dte_max: int | None = Query(default=None, ge=1, le=365),
        min_confidence: float | None = Query(default=None, ge=0, le=100),
        auth_email: str = Depends(require_access_email),
    ) -> PositionScannerEnvelope:
        weeks_out = _validate_weeks_out(weeks_out)
        return service.scanner(auth_email, weeks_out, strategy_mode, risk_profile, iv_rank_min, pop_min, expected_return_min, dte_max, min_confidence)

    @router.get("/workspace/{symbol}", response_model=PositionWorkspaceEnvelope)
    def get_position_trade_workspace(
        symbol: str = Path(..., min_length=1, max_length=12, pattern=r"^[A-Za-z][A-Za-z0-9.\-]*$"),
        weeks_out: PositionWeeksOut = Query(default=4, ge=2, le=8),
        strategy_mode: PositionStrategyMode = Query(default="all"),
        risk_profile: PositionRiskProfile = Query(default="balanced"),
        auth_email: str = Depends(require_access_email),
    ) -> PositionWorkspaceEnvelope:
        weeks_out = _validate_weeks_out(weeks_out)
        return service.workspace(auth_email, symbol, weeks_out, strategy_mode, risk_profile)

    @router.post("/scenario", response_model=PositionScenarioEnvelope)
    def post_position_trade_scenario(
        body: PositionScenarioRequest,
        auth_email: str = Depends(require_access_email),
    ) -> PositionScenarioEnvelope:
        return service.scenario(auth_email, body)

    return router
