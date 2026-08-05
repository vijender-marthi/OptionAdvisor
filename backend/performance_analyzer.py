"""
Performance analyzer — retrospective analytics over a user's *realized* book.

Takes the portfolio position list (the same dicts the Positions Center renders)
and produces daily/weekly rollups, headline metrics, an equity curve, and the
breakdowns that inform next-day / next-week decisions. Pure logic, no network —
so it is unit-testable and cheap to call inside the positions-center payload.

Realized P&L is attributed to a trade's EXIT date (when the money is booked).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

__all__ = ["analyze_performance"]


def _f(x: Any, default: float = 0.0) -> float:
    try:
        if x is None or x == "":
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    s = str(value)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _entry_date(p: dict) -> Optional[date]:
    return _parse_date(p.get("addedAt"))


def _exit_date(p: dict) -> Optional[date]:
    return _parse_date(p.get("exitDate"))


def _structure_family(strategy: str) -> str:
    s = (strategy or "").lower()
    if "calendar" in s:
        return "Calendar"
    if "spread" in s:
        return "Vertical Spread"
    if s.startswith("short"):
        return "Credit (naked)"
    if s.startswith("long"):
        return "Directional long"
    return "Other"


def _is_directional_long(p: dict) -> bool:
    return (p.get("strategy") or "").lower() in ("long call", "long put")


def _hold_days(p: dict) -> Optional[int]:
    e, x = _entry_date(p), _exit_date(p)
    if e is None or x is None:
        return None
    return (x - e).days


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # Monday


def _closed(positions: list[dict]) -> list[dict]:
    return [
        p for p in positions
        if str(p.get("status") or "").lower() == "closed" and p.get("realized_pnl") is not None
    ]


def _agg(rows: list[dict]) -> dict[str, Any]:
    """Headline metrics for a set of closed positions."""
    n = len(rows)
    if n == 0:
        return {"n": 0, "realized": 0.0, "win_rate": 0.0, "wins": 0, "losses": 0,
                "gross_win": 0.0, "gross_loss": 0.0, "profit_factor": None,
                "expectancy": 0.0, "avg_win": 0.0, "avg_loss": 0.0, "best": 0.0, "worst": 0.0}
    pnls = [_f(p.get("realized_pnl")) for p in rows]
    wins = [v for v in pnls if v > 0]
    losses = [v for v in pnls if v < 0]
    gross_win = round(sum(wins), 2)
    gross_loss = round(sum(losses), 2)
    total = round(sum(pnls), 2)
    return {
        "n": n,
        "realized": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(100 * len(wins) / n, 1),
        "gross_win": gross_win,
        "gross_loss": gross_loss,
        "profit_factor": round(gross_win / abs(gross_loss), 2) if gross_loss else None,
        "expectancy": round(total / n, 2),
        "avg_win": round(gross_win / len(wins), 2) if wins else 0.0,
        "avg_loss": round(gross_loss / len(losses), 2) if losses else 0.0,
        "best": round(max(pnls), 2),
        "worst": round(min(pnls), 2),
    }


def _breakdown(rows: list[dict], key) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for p in rows:
        k = key(p)
        if k is None:
            continue
        buckets.setdefault(str(k), []).append(p)
    out = []
    for k, items in buckets.items():
        a = _agg(items)
        out.append({"key": k, "n": a["n"], "realized": a["realized"], "win_rate": a["win_rate"]})
    out.sort(key=lambda r: r["realized"])
    return out


def _equity_and_drawdown(daily: list[dict]) -> tuple[list[dict], float]:
    cum = 0.0
    peak = 0.0
    max_dd = 0.0
    equity = []
    for d in daily:
        cum = round(cum + d["pnl"], 2)
        peak = max(peak, cum)
        max_dd = min(max_dd, round(cum - peak, 2))
        equity.append({"date": d["date"], "cum": cum})
    return equity, round(max_dd, 2)


def _streak(daily: list[dict]) -> int:
    """Signed current streak of up/down *days* (+n winning days, -n losing days)."""
    if not daily:
        return 0
    last_sign = 0
    streak = 0
    for d in reversed(daily):
        sign = 1 if d["pnl"] > 0 else (-1 if d["pnl"] < 0 else 0)
        if sign == 0:
            continue
        if last_sign == 0:
            last_sign = sign
            streak = sign
        elif sign == last_sign:
            streak += sign
        else:
            break
    return streak


def analyze_performance(positions: list[dict], *, now: Optional[date] = None) -> dict[str, Any]:
    now = now or date.today()
    rows = _closed(positions)

    # ── daily & weekly rollups (by exit date) ──────────────────────────────
    by_day: dict[date, list[dict]] = {}
    for p in rows:
        xd = _exit_date(p)
        if xd is None:
            continue
        by_day.setdefault(xd, []).append(p)
    daily = []
    for d in sorted(by_day):
        a = _agg(by_day[d])
        daily.append({"date": d.isoformat(), "pnl": a["realized"], "n": a["n"], "wins": a["wins"]})

    by_week: dict[date, list[dict]] = {}
    for p in rows:
        xd = _exit_date(p)
        if xd is None:
            continue
        by_week.setdefault(_week_start(xd), []).append(p)
    weekly = []
    for w in sorted(by_week):
        a = _agg(by_week[w])
        weekly.append({"week_start": w.isoformat(), "pnl": a["realized"],
                       "n": a["n"], "win_rate": a["win_rate"]})

    equity, max_dd = _equity_and_drawdown(daily)

    # ── this week vs trailing 4 weeks ──────────────────────────────────────
    this_week_start = _week_start(now)
    prior_start = this_week_start - timedelta(weeks=4)
    this_week_rows = [p for p in rows if (_exit_date(p) or date.min) >= this_week_start]
    prior_rows = [p for p in rows if prior_start <= (_exit_date(p) or date.min) < this_week_start]
    prior_weeks = max(1, len({_week_start(_exit_date(p)) for p in prior_rows if _exit_date(p)}))
    prior_agg = _agg(prior_rows)

    summary = _agg(rows)
    summary["max_drawdown"] = max_dd
    summary["day_streak"] = _streak(daily)
    summary["trading_days"] = len(daily)

    return {
        "summary": summary,
        "daily": daily,
        "weekly": weekly,
        "equity": equity,
        "by_ticker": _breakdown(rows, lambda p: p.get("ticker")),
        "by_structure": _breakdown(rows, lambda p: _structure_family(p.get("strategy", ""))),
        "by_hold": _breakdown(rows, lambda p: (
            "Same-day" if _hold_days(p) == 0 else ("Overnight / multi-day" if _hold_days(p) else None))),
        "by_source": _breakdown(rows, lambda p: p.get("source")),
        "by_weekday": _breakdown(rows, lambda p: (
            _exit_date(p).strftime("%a") if _exit_date(p) else None)),
        "this_week": {
            "week_start": this_week_start.isoformat(),
            **_agg(this_week_rows),
            "prior_avg_pnl": round(prior_agg["realized"] / prior_weeks, 2),
            "prior_avg_win_rate": prior_agg["win_rate"],
        },
    }


# ── Edge review: where your money actually comes from ─────────────────────────
_EDGE_BUCKETS = {
    "earnings": {"label": "Earnings-adjacent plays", "repeatable": False, "cadence": "~8 weeks/year",
                 "detail": "Pre/post-print options, calendars, fades around earnings."},
    "structure_day": {"label": "Structure day trades", "repeatable": True, "cadence": "every week",
                      "detail": "VWAP rejections/reclaims, LH@VWAP, crowding-top fades."},
    "carry": {"label": "Overnight carries", "repeatable": True, "cadence": "trending weeks",
              "detail": "Final-hour trend into a morning exit."},
    "swing": {"label": "Swings", "repeatable": True, "cadence": "any week",
              "detail": "Multi-day holds at Fib/MA confluence and weekly higher lows."},
    "other": {"label": "Other", "repeatable": True, "cadence": "", "detail": "Uncategorized closed trades."},
}

_BEST_SETUP = {
    "structure_day": "VWAP rejection / reclaim day trade",
    "swing": "Swing pullback at confluence",
    "carry": "Carry trade (final-hour trend → AM exit)",
    "earnings": "Earnings volatility play",
    "other": "Review manually",
}

_PLAYBOOK = [
    {"name": "VWAP rejection / reclaim", "frequency": "2–4/week", "expectation": "$150–400", "note": "Highest hit-rate pattern"},
    {"name": "Swing pullback at confluence", "frequency": "1–2/month", "expectation": "$300–800", "note": "Fib + MA clusters, weekly HLs"},
    {"name": "Carry trade", "frequency": "2–3/week", "expectation": "$100–300", "note": "Final-hour trend → AM exit"},
    {"name": "Theta income", "frequency": "1–2/month", "expectation": "25–50% of debit", "note": "Calendars/spreads on any range thesis"},
    {"name": "Event substitutes", "frequency": "~2/month", "expectation": "= earnings fades", "note": "Fed, CPI, launches — same fade grammar"},
]


def _near_earnings(ticker: str, d: Optional[date], earnings_map: dict[str, list[date]], window: int = 5) -> bool:
    if not d:
        return False
    for ed in earnings_map.get(ticker.upper(), []):
        if abs((ed - d).days) <= window:
            return True
    return False


def _edge_bucket(p: dict, earnings_map: dict[str, list[date]]) -> str:
    ticker = str(p.get("ticker") or "").upper()
    if _near_earnings(ticker, _entry_date(p), earnings_map) or _near_earnings(ticker, _exit_date(p), earnings_map):
        return "earnings"
    hold = _hold_days(p)
    if hold is None:
        return "other"
    if hold == 0:
        return "structure_day"
    if hold == 1:
        return "carry"
    return "swing"


def _resolved_realized_pnl(p: dict) -> Optional[float]:
    """Realized P&L for a closed position, mirroring the dashboard's fallback so the
    edge tab counts the same trades: use realized_pnl if set, else derive it from the
    stored percent × cost basis × contracts (debit → |net_credit|, credit → max_profit)."""
    rp = p.get("realized_pnl")
    if rp is not None:
        return _f(rp)
    pnl_pct = p.get("pnlPct")
    if pnl_pct is None:
        pnl_pct = p.get("realized_pnl_percent")
    if pnl_pct is None:
        return None
    net_credit = _f(p.get("net_credit"), 0.0)
    cost_ref = abs(net_credit) if net_credit < 0 else _f(p.get("max_profit"), 0.0)
    if cost_ref <= 0:
        return None
    contracts = max(1.0, _f(p.get("contracts"), 1.0))
    return round((_f(pnl_pct, 0.0) / 100.0) * cost_ref * 100.0 * contracts, 2)


def analyze_edge(positions: list[dict]) -> dict[str, Any]:
    """Separate durable, repeatable edge from earnings-season harvest, and surface
    the best setup per ticker — an honest 'where your money came from' review."""
    # Backfill realized_pnl using the dashboard's fallback so closed trades that only
    # carry a percent (not an absolute P&L) are still counted here.
    enriched: list[dict] = []
    for p in positions:
        if str(p.get("status") or "").lower() == "closed" and p.get("realized_pnl") is None:
            resolved = _resolved_realized_pnl(p)
            if resolved is not None:
                p = {**p, "realized_pnl": resolved}
        enriched.append(p)
    positions = enriched
    rows = _closed(positions)
    tickers = {str(p.get("ticker") or "").upper() for p in rows if p.get("ticker")}

    earnings_map: dict[str, list[date]] = {}
    try:
        import bar_cache
        for t in tickers:
            try:
                earnings_map[t] = [d for d in (_parse_date(x) for x in bar_cache.get_earnings_dates(t)) if d]
            except Exception:
                earnings_map[t] = []
    except Exception:
        earnings_map = {}

    buckets: dict[str, list[dict]] = {}
    for p in rows:
        buckets.setdefault(_edge_bucket(p, earnings_map), []).append(p)

    by_source = []
    for key, meta in _EDGE_BUCKETS.items():
        items = buckets.get(key, [])
        if not items:
            continue
        a = _agg(items)
        by_source.append({
            "key": key, "label": meta["label"], "repeatable": meta["repeatable"],
            "cadence": meta["cadence"], "detail": meta["detail"],
            "realized": a["realized"], "n": a["n"], "win_rate": a["win_rate"],
        })
    by_source.sort(key=lambda r: r["realized"], reverse=True)

    total = round(sum(_f(p.get("realized_pnl")) for p in rows), 2)
    durable = round(sum(r["realized"] for r in by_source if r["repeatable"]), 2)
    earnings = round(total - durable, 2)

    per_ticker = []
    tb: dict[str, list[dict]] = {}
    for p in rows:
        tb.setdefault(str(p.get("ticker") or "—").upper(), []).append(p)
    for t, items in tb.items():
        counts: dict[str, int] = {}
        for p in items:
            counts[_edge_bucket(p, earnings_map)] = counts.get(_edge_bucket(p, earnings_map), 0) + 1
        dominant = max(counts, key=counts.get) if counts else "other"
        per_ticker.append({
            "ticker": t, "realized": _agg(items)["realized"], "n": len(items),
            "dominant": dominant, "bestSetup": _BEST_SETUP.get(dominant, "Review manually"),
        })
    per_ticker.sort(key=lambda r: r["realized"], reverse=True)

    return {
        "total": total,
        "durable": durable,
        "earningsDependent": earnings,
        "durablePct": round(100 * durable / total, 0) if total else 0,
        "bySource": by_source,
        "perTicker": per_ticker,
        "playbook": _PLAYBOOK,
        "oneLiner": ("You don't need earnings — run your durable setups at high read-quality with discipline. "
                     "Treat steady months as the baseline and earnings quarters as the bonus, not the business."),
    }
