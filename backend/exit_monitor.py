"""
Exit monitor — gathers a user's held positions and runs the ExitSignalEngine.

Held positions come from two sources:
  1. Open rows in `active_trades` (intraday option trades; side CALL→long, PUT→short)
  2. Open portfolio positions (source == 'day' or 'swing')

Day-sourced positions get full intraday monitoring (VWAP break, OR break, stop hit,
EOD time stop). Swing-sourced positions get stop-hit monitoring (the most critical
safety check) plus target-hit warnings; VWAP/OR/EOD are intraday concepts that don't
apply to multi-day holds but the stop check is universal.

Market data per ticker is sourced from the day-trade intraday snapshot, which now
exposes `candles_5m_tail` in metrics (added with the trigger work). `snapshot_fn`
is injectable so this module is unit-testable without network/market data.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

import storage
from exit_signal_engine import ExitSignal, ExitSignalEngine, HeldPosition

_ET = ZoneInfo("America/New_York")


def _num(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _direction_from_side(side: str) -> str:
    s = (side or "").upper().strip()
    if s in ("PUT", "SHORT", "SELL"):
        return "short"
    return "long"  # CALL / LONG / BUY / unknown → long


def _direction_from_bias(bias: str, strategy: str) -> str:
    b = (bias or "").lower()
    st = (strategy or "").lower()
    if "bear" in b or "short" in b or st in ("long put", "short call", "bear call spread", "bear put spread"):
        return "short"
    return "long"


def _minutes_to_close(now: Optional[datetime] = None) -> float:
    now = now or datetime.now(_ET)
    close = now.replace(hour=16, minute=0, second=0, microsecond=0)
    if now >= close:
        return 0.0
    return (close - now).total_seconds() / 60.0


def held_positions_for_user(email: str) -> list[HeldPosition]:
    """Open active_trades (opened today ET only) + open portfolio positions (day + swing) → HeldPosition list.

    Active trades are filtered to today's ET calendar date to prevent stale rows
    from prior sessions (never explicitly exited) from generating phantom exit signals.
    """
    out: list[HeldPosition] = []

    for t in storage.list_active_trades_open_opened_today_et(email):
        entry_under = _num(t.get("entry_underlying_px")) or _num(t.get("entry_price")) or 0.0
        stop = _num(t.get("stop_price")) or _num(t.get("stop")) or _num(t.get("stopLoss"))
        target = _num(t.get("target_price")) or _num(t.get("target")) or _num(t.get("target1"))
        entry_time = None
        if t.get("opened_at_ms"):
            try:
                entry_time = datetime.fromtimestamp(int(t["opened_at_ms"]) / 1000.0, tz=_ET)
            except (TypeError, ValueError, OverflowError):
                entry_time = None
        ticker = str(t.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        out.append(HeldPosition(
            ticker=ticker,
            direction=_direction_from_side(str(t.get("side") or "")),
            entry_price=entry_under,
            entry_premium=_num(t.get("entry_price")) or 0.0,
            stop_price=stop,
            target_price=target,
            contracts=int(_num(t.get("contracts")) or 1),
            entry_time=entry_time,
        ))

    try:
        state = storage.get_user_state(email)
        portfolio = state.get("portfolio") or []
    except Exception:
        portfolio = []
    for p in portfolio:
        if str(p.get("status") or "").lower() != "open":
            continue
        _src = str(p.get("source") or "").lower()
        if _src not in ("day", "swing", ""):
            continue
        ticker = str(p.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        out.append(HeldPosition(
            ticker=ticker,
            direction=_direction_from_bias(str(p.get("bias") or ""), str(p.get("strategy") or "")),
            entry_price=_num(p.get("entryPrice")) or 0.0,
            entry_premium=0.0,
            stop_price=_num(p.get("stopLoss")),
            target_price=_num(p.get("target1")),
            contracts=int(_num(p.get("contracts")) or 1),
            position_type=_src if _src in ("day", "swing") else "day",
        ))

    return out


def _default_snapshot(ticker: str) -> dict:
    # Imported lazily so tests can inject snapshot_fn without importing day_trade.
    from day_trade import underlying_intraday_snapshot_for_active_trade
    return underlying_intraday_snapshot_for_active_trade(ticker)


def market_data_for_tickers(
    tickers: list[str],
    *,
    snapshot_fn: Optional[Callable[[str], dict]] = None,
    now: Optional[datetime] = None,
) -> dict[str, dict]:
    """Build the per-ticker market_data dict the ExitSignalEngine expects."""
    snapshot_fn = snapshot_fn or _default_snapshot
    mins = _minutes_to_close(now)
    data: dict[str, dict] = {}
    for tk in {str(t).upper().strip() for t in tickers if t}:
        try:
            snap = snapshot_fn(tk)
            m = (snap or {}).get("metrics") or {}
        except Exception:
            continue
        data[tk] = {
            "price": m.get("last_price"),
            "vwap": m.get("vwap"),
            "orh": m.get("or_high"),
            "orl": m.get("or_low"),
            "candles_5m": m.get("candles_5m_tail") or [],
            "minutes_to_close": mins,
            "premium": None,  # underlying-based monitoring; option premium not resolved here
        }
    return data


def scan_exit_signals_for_user(
    email: str,
    *,
    snapshot_fn: Optional[Callable[[str], dict]] = None,
    engine: Optional[ExitSignalEngine] = None,
    now: Optional[datetime] = None,
) -> list[ExitSignal]:
    positions = held_positions_for_user(email)
    if not positions:
        return []
    md = market_data_for_tickers([p.ticker for p in positions], snapshot_fn=snapshot_fn, now=now)
    eng = engine or ExitSignalEngine()
    return eng.check_positions(positions, md)
