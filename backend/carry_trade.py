from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

import bar_cache

PT = ZoneInfo("America/Los_Angeles")


@dataclass
class CarryAnalysis:
    ticker: str
    company_name: str
    active_window: bool
    frozen: bool
    verdict: str
    bias: str
    carry_score: int
    confidence: str
    entry_window: str
    expected_hold: str
    recommended_dte: str
    risk: str
    reasons: list[str]
    blockers: list[str]
    execution_plan: dict[str, Any]
    exit_plan: dict[str, Any]
    score_breakdown: dict[str, int]
    metrics: dict[str, Any]


def _now_pt() -> datetime:
    return datetime.now(tz=PT)


def is_carry_window(now: datetime | None = None) -> tuple[bool, bool, str]:
    current = now.astimezone(PT) if now else _now_pt()
    minutes = current.hour * 60 + current.minute
    active = 12 * 60 <= minutes <= 13 * 60
    frozen = minutes >= 12 * 60 + 55
    if active:
        return True, frozen, "Carry analysis is active during the final trading hour."
    return False, False, "Carry Trade analysis becomes available during the final hour of trading."


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
        return n if pd.notna(n) else default
    except Exception:
        return default


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(close: pd.Series, period: int = 14) -> float:
    if len(close) < period + 2:
        return 50.0
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, pd.NA)
    value = 100 - (100 / (1 + rs.iloc[-1]))
    return _num(value, 50.0)


def _macd_hist(close: pd.Series) -> float:
    if len(close) < 35:
        return 0.0
    macd = _ema(close, 12) - _ema(close, 26)
    signal = _ema(macd, 9)
    return _num((macd - signal).iloc[-1], 0.0)


def _atr(daily: pd.DataFrame, period: int = 14) -> float:
    if len(daily) < period + 1:
        return 0.0
    high = daily["High"].astype(float)
    low = daily["Low"].astype(float)
    close = daily["Close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return _num(tr.rolling(period).mean().iloc[-1], 0.0)


def _intraday_structure(bars: pd.DataFrame) -> tuple[str, list[str]]:
    if len(bars) < 8:
        return "MIXED", []
    closes = bars["Close"].astype(float).tail(8).tolist()
    highs = bars["High"].astype(float).tail(8).tolist()
    lows = bars["Low"].astype(float).tail(8).tolist()
    rising_highs = highs[-1] > highs[-3] > highs[-5]
    rising_lows = lows[-1] > lows[-3] > lows[-5]
    falling_highs = highs[-1] < highs[-3] < highs[-5]
    falling_lows = lows[-1] < lows[-3] < lows[-5]
    if rising_highs and rising_lows and closes[-1] >= closes[-3]:
        return "HH/HL", ["Higher highs and higher lows into the close"]
    if falling_highs and falling_lows and closes[-1] <= closes[-3]:
        return "LH/LL", ["Lower highs and lower lows into the close"]
    return "MIXED", ["Intraday structure is mixed into the close"]


def _session_vwap(bars: pd.DataFrame) -> float:
    typical = (bars["High"].astype(float) + bars["Low"].astype(float) + bars["Close"].astype(float)) / 3.0
    volume = bars["Volume"].astype(float).clip(lower=0)
    denom = volume.sum()
    if denom <= 0:
        return _num(bars["Close"].iloc[-1])
    return _num((typical * volume).sum() / denom)


def _closing_location_value(bars: pd.DataFrame) -> float:
    high = _num(bars["High"].astype(float).max())
    low = _num(bars["Low"].astype(float).min())
    close = _num(bars["Close"].iloc[-1])
    rng = high - low
    if rng <= 0:
        return 0.5
    return max(0.0, min(1.0, (close - low) / rng))


def _option_liquidity(ticker: str, close: float, bias: str, force_refresh: bool) -> tuple[int, list[str], dict[str, Any]]:
    try:
        expiries = bar_cache.get_option_dates(ticker, force_refresh=force_refresh)
    except Exception:
        expiries = ()
    if not expiries:
        return 0, ["Options chain unavailable"], {"status": "unavailable"}

    today = datetime.now(tz=PT).date()
    chosen = None
    for exp in expiries:
        try:
            dte = (datetime.fromisoformat(exp).date() - today).days
        except Exception:
            continue
        if 7 <= dte <= 14:
            chosen = exp
            break
    chosen = chosen or expiries[0]
    try:
        calls, puts = bar_cache.get_option_chain(ticker, chosen, force_refresh=force_refresh)
        chain = calls if bias == "LONG CALL" else puts
        if chain is None or chain.empty:
            return 0, ["Options chain unavailable"], {"expiration": chosen, "status": "empty"}
        chain = chain.copy()
        chain["dist"] = (chain["strike"].astype(float) - close).abs()
        row = chain.sort_values("dist").iloc[0]
        bid = _num(row.get("bid"))
        ask = _num(row.get("ask"))
        spread_pct = ((ask - bid) / ask * 100.0) if ask > 0 else 100.0
        oi = int(_num(row.get("openInterest")))
        vol = int(_num(row.get("volume")))
        delta = _num(row.get("delta"), 0.55)
        blockers: list[str] = []
        points = 5
        if spread_pct >= 10:
            blockers.append("Bid/ask spread too wide")
            points -= 3
        if oi < 1000:
            blockers.append("Open interest below 1000")
            points -= 1
        if vol < 500:
            blockers.append("Option volume below 500")
            points -= 1
        if delta and not 0.40 <= abs(delta) <= 0.70:
            blockers.append("Delta outside 0.40-0.70")
            points -= 1
        return max(0, points), blockers, {
            "expiration": chosen,
            "strike": _num(row.get("strike")),
            "bid": bid,
            "ask": ask,
            "spread_pct": round(spread_pct, 2),
            "open_interest": oi,
            "volume": vol,
            "delta": delta or None,
        }
    except Exception as exc:
        return 0, ["Options liquidity check failed"], {"expiration": chosen, "status": "error", "error": str(exc)}


def _event_blockers(ticker: str, force_refresh: bool) -> list[str]:
    blockers: list[str] = []
    try:
        cal = bar_cache.get_calendar(ticker, force_refresh=force_refresh) or {}
    except Exception:
        cal = {}
    raw = cal.get("Earnings Date") or cal.get("Earnings") or cal.get("earningsDate")
    dates = raw if isinstance(raw, (list, tuple)) else [raw] if raw else []
    tomorrow = _now_pt().date() + timedelta(days=1)
    for value in dates:
        try:
            dt = pd.Timestamp(value).date()
        except Exception:
            continue
        if dt <= tomorrow:
            blockers.append("Binary Event Tomorrow")
            break
    return blockers


def run_carry_trade_scan(ticker: str, force_refresh: bool = False, now: datetime | None = None) -> CarryAnalysis:
    symbol = ticker.upper().strip()
    active, frozen, window_message = is_carry_window(now)
    intraday = bar_cache.get_history(symbol, period="5d", interval="5m", auto_adjust=True, force_refresh=force_refresh)
    daily = bar_cache.get_history(symbol, period="6mo", interval="1d", auto_adjust=True, force_refresh=force_refresh)
    info = bar_cache.get_info(symbol, force_refresh=force_refresh) or {}
    company = str(info.get("shortName") or info.get("longName") or "")

    if intraday.empty or daily.empty or len(daily) < 25:
        return CarryAnalysis(
            ticker=symbol, company_name=company, active_window=active, frozen=frozen,
            verdict="Neutral", bias="NO TRADE", carry_score=0, confidence="LOW",
            entry_window="12:15 PM - 12:55 PM PT", expected_hold="1 Night",
            recommended_dte="7-14 Days", risk="High", reasons=[window_message],
            blockers=["Market data unavailable"], execution_plan={"entry": "No entry now"},
            exit_plan={"exit": "No carry trade"}, score_breakdown={}, metrics={},
        )

    session = intraday.dropna().tail(78)
    close = _num(session["Close"].iloc[-1])
    session_open = _num(session["Open"].iloc[0], close)
    session_high = _num(session["High"].max(), close)
    session_low = _num(session["Low"].min(), close)
    change_pct = ((close - session_open) / session_open * 100.0) if session_open else 0.0
    vwap = _session_vwap(session)
    clv = _closing_location_value(session)
    structure, structure_reasons = _intraday_structure(session)

    daily_close = daily["Close"].astype(float)
    ma20 = daily_close.rolling(20).mean()
    ma20_now = _num(ma20.iloc[-1], close)
    ma20_prev = _num(ma20.iloc[-6], ma20_now) if len(ma20) >= 6 else ma20_now
    ma20_rising = ma20_now > ma20_prev
    macd_hist = _macd_hist(daily_close)
    rsi = _rsi(daily_close)
    atr = _atr(daily)
    rvol = _num(session["Volume"].tail(12).mean()) / max(_num(session["Volume"].mean()), 1.0)

    bullish_points = 0
    bearish_points = 0
    score: dict[str, int] = {}
    reasons: list[str] = []
    blockers: list[str] = []

    if structure == "HH/HL":
        bullish_points += 25
        score["intraday_structure"] = 25
        reasons += structure_reasons
    elif structure == "LH/LL":
        bearish_points += 25
        score["intraday_structure"] = 25
        reasons += structure_reasons
    else:
        score["intraday_structure"] = 8
        blockers.append("Market structure has already broken or is mixed")

    if close >= vwap:
        bullish_points += 15
        score["vwap_trend"] = 15
        reasons.append("Price is holding above VWAP into the close")
    else:
        bearish_points += 15
        score["vwap_trend"] = 15
        reasons.append("Price is below VWAP into the close")

    if clv >= 0.8:
        bullish_points += 15
        score["closing_location_value"] = 15
        reasons.append(f"CLV = {clv:.2f}, closing near session highs")
    elif clv <= 0.2:
        bearish_points += 15
        score["closing_location_value"] = 15
        reasons.append(f"CLV = {clv:.2f}, closing near session lows")
    elif clv >= 0.6:
        bullish_points += 9
        score["closing_location_value"] = 9
    elif clv <= 0.4:
        bearish_points += 9
        score["closing_location_value"] = 9
    else:
        score["closing_location_value"] = 4

    daily_bull = close > ma20_now and ma20_rising and macd_hist >= 0
    daily_bear = close < ma20_now and not ma20_rising and macd_hist <= 0
    if daily_bull:
        bullish_points += 15
        score["daily_trend_alignment"] = 15
        reasons.append("Daily trend aligns bullish")
    elif daily_bear:
        bearish_points += 15
        score["daily_trend_alignment"] = 15
        reasons.append("Daily trend aligns bearish")
    else:
        score["daily_trend_alignment"] = 5
        blockers.append("Daily trend does not confirm the carry direction")

    spy = bar_cache.get_history("SPY", period="5d", interval="5m", auto_adjust=True, force_refresh=force_refresh)
    qqq = bar_cache.get_history("QQQ", period="5d", interval="5m", auto_adjust=True, force_refresh=force_refresh)
    spy_change = _session_change(spy)
    qqq_change = _session_change(qqq)
    if change_pct > spy_change and change_pct > qqq_change:
        bullish_points += 10
        score["relative_strength"] = 10
        reasons.append("Relative strength confirmed versus SPY and QQQ")
    elif change_pct < spy_change and change_pct < qqq_change:
        bearish_points += 10
        score["relative_strength"] = 10
        reasons.append("Relative weakness confirmed versus SPY and QQQ")
    else:
        score["relative_strength"] = 4
        blockers.append("Weak relative strength versus SPY/QQQ")

    if rvol > 1.3:
        score["volume_confirmation"] = 10
        if close >= vwap:
            bullish_points += 10
        else:
            bearish_points += 10
        reasons.append(f"RVOL {rvol:.1f}x supports the move")
    else:
        score["volume_confirmation"] = 3
        blockers.append("RVOL below 1.3")

    if abs(change_pct) > 6:
        score["volatility_filter"] = 0
        blockers.append(f"Already moved {change_pct:+.1f}%")
    else:
        score["volatility_filter"] = 5

    bias = "LONG CALL" if bullish_points >= bearish_points else "LONG PUT"
    option_points, option_blockers, option_contract = _option_liquidity(symbol, close, bias, force_refresh)
    score["options_liquidity"] = option_points
    blockers.extend(option_blockers)
    blockers.extend(_event_blockers(symbol, force_refresh))

    market_blockers: list[str] = []
    if spy_change < -0.8 and bias == "LONG CALL":
        market_blockers.append("SPY weak into the close")
    if qqq_change < -0.8 and bias == "LONG CALL":
        market_blockers.append("QQQ weak into the close")
    if spy_change > 0.8 and bias == "LONG PUT":
        market_blockers.append("SPY strong into the close")
    if qqq_change > 0.8 and bias == "LONG PUT":
        market_blockers.append("QQQ strong into the close")
    blockers.extend(market_blockers)

    total = sum(score.values())
    hard_blockers = [b for b in blockers if b in {"Binary Event Tomorrow", "Bid/ask spread too wide", "Options chain unavailable"} or "Already moved" in b]
    if not active:
        verdict = "Neutral"
    elif hard_blockers:
        verdict = "Do Not Carry"
    elif total >= 85 and len(blockers) <= 1:
        verdict = "High Probability Carry"
    elif total >= 70 and len(blockers) <= 2:
        verdict = "Acceptable Carry"
    elif total >= 55:
        verdict = "Wait"
    else:
        verdict = "Do Not Carry"

    confidence = "HIGH" if total >= 85 else "MEDIUM" if total >= 65 else "LOW"
    risk = "Medium" if verdict in {"High Probability Carry", "Acceptable Carry"} else "High"
    if not active:
        blockers = [window_message]

    return CarryAnalysis(
        ticker=symbol,
        company_name=company,
        active_window=active,
        frozen=frozen,
        verdict=verdict,
        bias=bias if active else "NO TRADE",
        carry_score=int(max(0, min(100, total))),
        confidence=confidence,
        entry_window="12:15 PM - 12:55 PM PT",
        expected_hold="1 Night",
        recommended_dte="7-14 Days",
        risk=risk,
        reasons=reasons[:8] or [window_message],
        blockers=blockers,
        execution_plan={
            "entry": "Enter only during final-hour continuation, not after a failed VWAP reclaim.",
            "contracts": "1 contract recommended; 2 contracts maximum.",
            "dte": "Use 7-14 DTE. Minimum 5 DTE. Never 0DTE.",
            "stop": "Do not average down. Gap against position exits immediately.",
        },
        exit_plan={
            "gap_with_position": "Sell into first strength 6:30-7:00 AM PT" if bias == "LONG CALL" else "Cover into first weakness 6:30-7:00 AM PT",
            "gap_against_position": "Exit immediately.",
            "latest_review": "Never hold beyond 7:30 AM PT without a new trading decision.",
        },
        score_breakdown=score,
        metrics={
            "price": round(close, 2),
            "change_pct": round(change_pct, 2),
            "vwap": round(vwap, 2),
            "clv": round(clv, 2),
            "structure": structure,
            "rvol": round(rvol, 2),
            "ma20": round(ma20_now, 2),
            "ma20_rising": ma20_rising,
            "macd_hist": round(macd_hist, 3),
            "rsi": round(rsi, 1),
            "atr": round(atr, 2),
            "spy_change_pct": round(spy_change, 2),
            "qqq_change_pct": round(qqq_change, 2),
            "option_contract": option_contract,
        },
    )


def _session_change(df: pd.DataFrame) -> float:
    if df is None or df.empty:
        return 0.0
    session = df.dropna().tail(78)
    if session.empty:
        return 0.0
    first = _num(session["Open"].iloc[0])
    last = _num(session["Close"].iloc[-1])
    return ((last - first) / first * 100.0) if first else 0.0


def carry_analysis_to_dict(result: CarryAnalysis) -> dict[str, Any]:
    return {
        "ticker": result.ticker,
        "company_name": result.company_name,
        "active_window": result.active_window,
        "frozen": result.frozen,
        "verdict": result.verdict,
        "bias": result.bias,
        "carry_score": result.carry_score,
        "confidence": result.confidence,
        "entry_window": result.entry_window,
        "expected_hold": result.expected_hold,
        "recommended_dte": result.recommended_dte,
        "risk": result.risk,
        "reasons": result.reasons,
        "blockers": result.blockers,
        "execution_plan": result.execution_plan,
        "exit_plan": result.exit_plan,
        "score_breakdown": result.score_breakdown,
        "metrics": result.metrics,
    }
