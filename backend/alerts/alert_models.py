from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


EngineType = Literal["DAY", "SWING", "REGULAR", "PORTFOLIO", "MARKET"]
Severity = Literal["INFO", "WARNING", "CRITICAL"]
Signal = Literal["GO", "WATCH", "WAIT", "SKIP", "AVOID", "EXIT", "SCALE_OUT"]
AlertStatus = Literal["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]


class Alert(BaseModel):
    id: str
    ticker: str
    alert_type: str
    engine_type: EngineType
    severity: Severity
    signal: Signal
    message: str
    reason: str
    recommended_action: str
    related_trade_id: Optional[str] = None
    related_watchlist_id: Optional[str] = None
    status: AlertStatus = "ACTIVE"
    created_at: str
    updated_at: Optional[str] = None
