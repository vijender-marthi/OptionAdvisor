"""Earnings volatility radar engine.

For each ticker with earnings inside a look-ahead window, assemble the honest
volatility picture:
  • next / last earnings dates and countdown,
  • the last earnings price reaction (run-up, gap, drift),
  • the market's implied expected move (from the ATM straddle),
  • the stock's typical historical earnings move,
  • a vol read — is the move under- or over-priced vs. how it actually moves,
  • sector peers reporting nearby,
  • a defined-risk long-straddle sized to a risk budget.

This is analysis, not a directional prediction: earnings direction is close to a
coin flip, so the read is framed around volatility mispricing, not "up or down".
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import pandas as pd

import bar_cache

# Curated peer groups keyed by a sector/industry keyword (matched case-insensitively).
_PEER_GROUPS: dict[str, list[str]] = {
    "semiconductor": ["NVDA", "AMD", "AVGO", "MU", "TSM", "INTC", "QCOM", "TXN", "ASML", "ARM"],
    "software": ["MSFT", "ORCL", "CRM", "ADBE", "NOW", "SNOW", "PLTR", "DDOG"],
    "internet": ["GOOGL", "META", "AMZN", "NFLX", "UBER", "ABNB"],
    "auto": ["TSLA", "RIVN", "LCID", "F", "GM"],
    "bank": ["JPM", "BAC", "WFC", "GS", "MS", "C"],
    "biotech": ["LLY", "PFE", "MRK", "ABBV", "JNJ", "AMGN", "GILD"],
    "drug": ["LLY", "PFE", "MRK", "ABBV", "JNJ", "AMGN", "GILD"],
    "retail": ["WMT", "TGT", "COST", "HD", "LOW"],
    "oil": ["XOM", "CVX", "COP", "SLB"],
    "energy": ["XOM", "CVX", "COP", "SLB"],
}


def _f(x: Any) -> float | None:
    try:
        v = float(x)
        return v if v == v and math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _parse_date(x: Any) -> date | None:
    if isinstance(x, date):
        return x
    if isinstance(x, (list, tuple)) and x:
        return _parse_date(x[0])
    try:
        return pd.Timestamp(str(x)).date()
    except Exception:
        return None


def next_earnings_date(cal: dict) -> date | None:
    """First earnings date on or after today from the calendar dict."""
    raw = cal.get("Earnings Date")
    candidates: list[date] = []
    if isinstance(raw, (list, tuple)):
        candidates = [d for d in (_parse_date(v) for v in raw) if d is not None]
    else:
        d = _parse_date(raw)
        if d:
            candidates = [d]
    today = date.today()
    upcoming = sorted(d for d in candidates if d >= today)
    return upcoming[0] if upcoming else None


def _reaction(df: pd.DataFrame, ev_date: date) -> dict[str, Any] | None:
    """Run-up (5 sessions before), gap (reaction day), drift (3 sessions after)."""
    if df is None or df.empty or "Close" not in df.columns:
        return None
    closes = df["Close"].astype(float)
    idx_dates = [i.date() if hasattr(i, "date") else pd.Timestamp(i).date() for i in df.index]
    # Reaction day R = first session strictly after the earnings date.
    r = next((k for k, d in enumerate(idx_dates) if d > ev_date), None)
    if r is None or r < 6 or r >= len(closes):
        return None
    c = closes.tolist()
    gap = (c[r] / c[r - 1] - 1.0) * 100.0 if c[r - 1] else None
    run_up = (c[r - 1] / c[r - 6] - 1.0) * 100.0 if c[r - 6] else None
    drift = ((c[min(r + 3, len(c) - 1)] / c[r] - 1.0) * 100.0) if c[r] else None
    return {
        "date": ev_date.isoformat(),
        "runUpPct": round(run_up, 2) if run_up is not None else None,
        "gapPct": round(gap, 2) if gap is not None else None,
        "driftPct": round(drift, 2) if drift is not None else None,
    }


def _typical_move_pct(df: pd.DataFrame, past_dates: list[date], n: int = 4) -> float | None:
    """Average absolute earnings-gap move over the last n past earnings."""
    moves: list[float] = []
    for d in sorted(past_dates, reverse=True):
        rec = _reaction(df, d)
        if rec and rec.get("gapPct") is not None:
            moves.append(abs(rec["gapPct"]))
        if len(moves) >= n:
            break
    return round(sum(moves) / len(moves), 2) if moves else None


def _expected_move(ticker: str, spot: float, on_or_after: date) -> dict[str, Any] | None:
    """Implied expected move from the ATM straddle on the nearest expiry >= earnings."""
    try:
        expiries = bar_cache.get_option_dates(ticker)
        exp = next((e for e in expiries if _parse_date(e) and _parse_date(e) >= on_or_after), None)
        if exp is None and expiries:
            exp = expiries[-1]
        if not exp:
            return None
        calls, puts = bar_cache.get_option_chain(ticker, exp)
        if calls is None or puts is None or calls.empty or puts.empty:
            return None

        def _mid_at(dfo: pd.DataFrame) -> float | None:
            dfo = dfo.copy()
            dfo["_d"] = (dfo["strike"].astype(float) - spot).abs()
            row = dfo.sort_values("_d").iloc[0]
            bid, ask, last = _f(row.get("bid")), _f(row.get("ask")), _f(row.get("lastPrice"))
            if bid and ask and bid > 0 and ask > 0:
                return (bid + ask) / 2.0
            return last

        call_mid = _mid_at(calls)
        put_mid = _mid_at(puts)
        if not call_mid or not put_mid:
            return None
        straddle = call_mid + put_mid
        atm_strike = float(calls.iloc[(calls["strike"].astype(float) - spot).abs().argsort().iloc[0]]["strike"])
        return {
            "expiry": str(exp),
            "atmStrike": round(atm_strike, 2),
            "callMid": round(call_mid, 2),
            "putMid": round(put_mid, 2),
            "straddle": round(straddle, 2),
            "movePct": round(straddle / spot * 100.0, 2) if spot else None,
            "moveDollars": round(straddle, 2),
        }
    except Exception:
        return None


def _vol_read(implied_pct: float | None, typical_pct: float | None) -> dict[str, str]:
    if implied_pct is None or typical_pct is None:
        return {"label": "Insufficient data", "tone": "neutral",
                "text": "Not enough option or history data to judge whether the move is priced fairly."}
    if typical_pct >= implied_pct * 1.1:
        return {"label": "Under-priced", "tone": "positive",
                "text": "This stock has historically moved more than the options currently price — the setup favours long premium into the run-up, exit before the print to avoid IV crush."}
    if typical_pct <= implied_pct * 0.9:
        return {"label": "Expensive", "tone": "warning",
                "text": "Options price a bigger move than this stock usually delivers. Long premium pays for a move it rarely makes — prefer caution or a defined-risk spread."}
    return {"label": "Fairly priced", "tone": "neutral",
            "text": "The implied move is roughly in line with how the stock actually moves — no clear volatility edge either way."}


def _directional_lean(df: pd.DataFrame, last_reaction: dict | None) -> str:
    """A soft lean from recent trend + last drift. Deliberately low-confidence."""
    try:
        closes = df["Close"].astype(float)
        sma20 = closes.rolling(20).mean().iloc[-1]
        trend_up = float(closes.iloc[-1]) > float(sma20)
        drift = (last_reaction or {}).get("driftPct")
        votes = 0
        votes += 1 if trend_up else -1
        if drift is not None:
            votes += 1 if drift > 0 else -1
        return "slight bullish" if votes > 0 else "slight bearish" if votes < 0 else "neutral"
    except Exception:
        return "neutral"


def _peers(sector: str, industry: str, ticker: str) -> list[str]:
    hay = f"{sector} {industry}".lower()
    for key, group in _PEER_GROUPS.items():
        if key in hay:
            return [p for p in group if p != ticker.upper()][:5]
    return []


def _size_to_budget(budget: float, straddle: float) -> dict[str, Any]:
    per = straddle * 100.0
    contracts = int(budget // per) if per > 0 else 0
    return {"contracts": contracts, "maxRisk": round(contracts * per, 2), "costPerContract": round(per, 2)}


def build_card(ticker: str, within_days: int, budget: float) -> dict[str, Any] | None:
    ticker = ticker.upper().strip()
    if not ticker:
        return None
    try:
        cal = bar_cache.get_calendar(ticker)
    except Exception:
        return None
    nxt = next_earnings_date(cal or {})
    if nxt is None:
        return None
    days_to = (nxt - date.today()).days
    if days_to < 0 or days_to > within_days:
        return None

    try:
        df = bar_cache.get_history(ticker, period="2y", interval="1d", auto_adjust=True)
    except Exception:
        df = None
    spot = None
    if df is not None and not df.empty:
        df = df.sort_index()
        spot = _f(df["Close"].iloc[-1])
    if not spot:
        return None

    try:
        info = bar_cache.get_info(ticker) or {}
    except Exception:
        info = {}
    sector = str(info.get("sector") or "")
    industry = str(info.get("industry") or "")

    past_dates = [d for d in (_parse_date(x) for x in bar_cache.get_earnings_dates(ticker)) if d and d < date.today()]
    last_date = max(past_dates) if past_dates else _parse_date(cal.get("Last Earnings Date"))
    last_reaction = _reaction(df, last_date) if last_date else None
    typical_pct = _typical_move_pct(df, past_dates)
    em = _expected_move(ticker, spot, nxt)
    implied_pct = em.get("movePct") if em else None
    read = _vol_read(implied_pct, typical_pct)
    lean = _directional_lean(df, last_reaction)

    # Size a single directional leg (matches how earnings are usually traded and stays
    # affordable on a small budget); fall back to a straddle only when the lean is flat.
    play = None
    if em:
        if lean == "slight bullish":
            leg_type, leg_prem, leg_side = "Long call", em.get("callMid"), "call"
        elif lean == "slight bearish":
            leg_type, leg_prem, leg_side = "Long put", em.get("putMid"), "put"
        else:
            leg_type, leg_prem, leg_side = "Long straddle", em.get("straddle"), "both"
        sizing = _size_to_budget(budget, leg_prem) if leg_prem else None
        scenario_gain = None
        if sizing and sizing["contracts"] > 0 and typical_pct is not None and leg_prem:
            move_dollars = typical_pct / 100.0 * spot
            scenario_gain = round((move_dollars - leg_prem) * 100.0 * sizing["contracts"], 2)
        play = {
            "type": leg_type,
            "side": leg_side,
            "expiry": em.get("expiry"),
            "atmStrike": em.get("atmStrike"),
            "premiumPerContract": round((leg_prem or 0) * 100.0, 2),
            "sizing": sizing,
            "breakevenUp": round(spot + em["straddle"], 2),
            "breakevenDown": round(spot - em["straddle"], 2),
            "scenarioGainIfTypical": scenario_gain,
        }

    return {
        "ticker": ticker,
        "companyName": str(info.get("shortName") or info.get("longName") or ticker),
        "sector": sector,
        "industry": industry,
        "spot": round(spot, 2),
        "nextEarnings": nxt.isoformat(),
        "daysToEarnings": days_to,
        "timing": str(cal.get("Earnings Call Time") or "").strip() or None,
        "lastEarnings": last_date.isoformat() if last_date else None,
        "lastReaction": last_reaction,
        "typicalMovePct": typical_pct,
        "expectedMove": em,
        "impliedMovePct": implied_pct,
        "ivRank": _f(info.get("ivRank")),
        "volRead": read,
        "directionalLean": lean,
        "peers": _peers(sector, industry, ticker),
        "play": play,
    }


def scan(tickers: list[str], within_days: int = 21, budget: float = 1000.0) -> dict[str, Any]:
    """Build cards for every ticker with earnings inside the window, sorted by soonest."""
    seen: set[str] = set()
    cards: list[dict[str, Any]] = []
    skipped: list[str] = []
    for t in tickers:
        tt = str(t or "").upper().strip()
        if not tt or tt in seen:
            continue
        seen.add(tt)
        try:
            card = build_card(tt, within_days, budget)
        except Exception:
            card = None
        if card:
            cards.append(card)
        else:
            skipped.append(tt)
    cards.sort(key=lambda c: c["daysToEarnings"])
    return {
        "withinDays": within_days,
        "riskBudget": budget,
        "count": len(cards),
        "cards": cards,
        "noEarningsInWindow": skipped,
    }
