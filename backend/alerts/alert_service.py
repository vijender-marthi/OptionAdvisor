from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .alert_models import Alert
from .alert_normalizer import normalize_alerts


SECTION_KEYS = {
    "DAY": "day_trade",
    "SWING": "swing_trade",
    "REGULAR": "regular_trade",
    "PORTFOLIO": "portfolio",
    "MARKET": "market",
}

PROFIT_PROTECTION_TYPES = {"SCALE_OUT", "PROTECT_PROFITS", "PROFIT_TARGET_HIT"}
TRADE_ENTRY_TYPES = {
    "DAY_GO",
    "DAY_WAIT",
    "OR_BREAKOUT",
    "SWING_GO",
    "SWING_WATCH",
    "BREAKOUT_CONFIRMED",
    "RELATIVE_STRENGTH",
    "LATE_DAY_STRENGTH",
    "REGULAR_TRADE",
    "REGULAR_WATCH",
    "CREDIT_SPREAD_TARGET",
}


def _section_key(engine_type: str) -> str:
    return SECTION_KEYS.get(str(engine_type or "").strip().upper(), "regular_trade")


def _alert_dict(alert: Alert | dict[str, Any]) -> dict[str, Any]:
    if isinstance(alert, Alert):
        if hasattr(alert, "model_dump"):
            return alert.model_dump()
        return alert.dict()
    return dict(alert)


def build_alert_center_payload(alerts: list[Alert | dict[str, Any]]) -> dict[str, Any]:
    rows = [_alert_dict(alert) for alert in alerts]
    sections = {
        "day_trade": [],
        "swing_trade": [],
        "regular_trade": [],
        "portfolio": [],
        "market": [],
    }
    for row in rows:
        sections[_section_key(str(row.get("engine_type") or ""))].append(row)

    summary = {
        "total": len(rows),
        "active": sum(1 for row in rows if str(row.get("status") or "") == "ACTIVE"),
        "critical": sum(1 for row in rows if str(row.get("severity") or "") == "CRITICAL"),
        "warning": sum(1 for row in rows if str(row.get("severity") or "") == "WARNING"),
        "info": sum(1 for row in rows if str(row.get("severity") or "") == "INFO"),
        "profit_protection": sum(1 for row in rows if str(row.get("alert_type") or "") in PROFIT_PROTECTION_TYPES),
        "trade_entry": sum(1 for row in rows if str(row.get("alert_type") or "") in TRADE_ENTRY_TYPES),
    }
    return {"summary": summary, "sections": sections, "alerts": rows}


def demo_alerts() -> list[Alert]:
    now = datetime.now(timezone.utc)
    return normalize_alerts(
        [
            {
                "id": "alert-day-vwap-lost",
                "ticker": "AMD",
                "alert_type": "VWAP_LOST",
                "severity": "CRITICAL",
                "signal": "EXIT",
                "message": "AMD lost VWAP after the opening push.",
                "reason": "Buyers failed to hold intraday trend support and follow-through faded quickly.",
                "recommended_action": "Exit failed longs and avoid new entries until VWAP is reclaimed with volume.",
                "status": "ACTIVE",
                "created_at": (now - timedelta(minutes=8)).isoformat(),
            },
        ],
        [
            {
                "id": "alert-swing-nvda",
                "ticker": "NVDA",
                "alert_type": "SWING_GO",
                "severity": "INFO",
                "signal": "WATCH",
                "message": "NVDA remains in a healthy swing uptrend.",
                "reason": "Trend structure is still intact and relative strength remains constructive.",
                "recommended_action": "Let run while trend holds",
                "status": "ACTIVE",
                "created_at": (now - timedelta(minutes=21)).isoformat(),
            },
        ],
        [
            {
                "id": "alert-regular-avgo",
                "ticker": "AVGO",
                "alert_type": "HIGH_IV_WARNING",
                "severity": "WARNING",
                "signal": "SKIP",
                "message": "AVGO trend is bullish, but option IV is elevated.",
                "reason": "Swing structure is constructive, but option pricing is rich enough to hurt a simple long call entry.",
                "recommended_action": "Use smaller size, longer expiry, or debit spread. Avoid oversized long calls.",
                "status": "ACTIVE",
                "created_at": (now - timedelta(minutes=16)).isoformat(),
            },
        ],
        [
            {
                "alert_id": "alert-portfolio-tsla",
                "id": "trade-tsla-runner",
                "ticker": "TSLA",
                "pnlPct": 100,
                "status": "open",
                "created_at": (now - timedelta(minutes=12)).isoformat(),
            },
        ],
        [
            {
                "id": "alert-market-vix",
                "ticker": "",
                "alert_type": "VIX_SPIKE",
                "severity": "WARNING",
                "signal": "WAIT",
                "message": "VIX is spiking and broad-market risk is rising.",
                "reason": "Elevated volatility often leads to wider spreads, weaker follow-through, and poorer premium selling conditions.",
                "recommended_action": "Reduce size and wait for the tape to stabilize before adding exposure.",
                "status": "ACTIVE",
                "created_at": (now - timedelta(minutes=5)).isoformat(),
            },
        ],
    )
