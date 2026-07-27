"""
Coaching engine — finds the *repeatable* mistakes in a user's realized book and
frames them as process leaks with a dollar cost and a weekly trend, so the next
week's focus is a concrete rule, not a stock pick.

Deterministic and pure (no LLM, no network) — the AI coach can layer a narrative
on top, but the findings here are auditable arithmetic over closed trades.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Optional

from performance_analyzer import (
    _agg, _closed, _exit_date, _f, _hold_days, _is_directional_long, _week_start,
)

__all__ = ["analyze_coaching"]

# thresholds
_OVERSIZED_LOSS_ABS = 1000.0     # a single trade losing more than this $
_OVERSIZED_LOSS_PCT = -60.0      # ...or more than this % of capital at risk


def _ex(p: dict) -> dict:
    return {
        "ticker": p.get("ticker", ""),
        "key": p.get("broker_import_key") or p.get("id", ""),
        "entry": (p.get("addedAt") or "")[:10],
        "exit": (p.get("exitDate") or "")[:10],
        "pnl": round(_f(p.get("realized_pnl")), 2),
    }


def _week_counts(rows: list[dict], now: date) -> tuple[int, float]:
    """(count this week, avg count per week over prior 4 weeks) by exit date."""
    ws = _week_start(now)
    prior_start = ws - timedelta(weeks=4)
    this_week = sum(1 for p in rows if (_exit_date(p) or date.min) >= ws)
    prior = [p for p in rows if prior_start <= (_exit_date(p) or date.min) < ws]
    weeks = max(1, len({_week_start(_exit_date(p)) for p in prior if _exit_date(p)}))
    return this_week, round(len(prior) / weeks, 1)


def _leak(code, title, severity, hits, now, insight, fix) -> dict:
    cost = round(sum(_f(p.get("realized_pnl")) for p in hits), 2)
    tw, prior = _week_counts(hits, now)
    hits_sorted = sorted(hits, key=lambda p: _f(p.get("realized_pnl")))
    return {
        "code": code, "title": title, "severity": severity,
        "count": len(hits), "cost": cost,
        "this_week": tw, "prior_weekly_avg": prior,
        "examples": [_ex(p) for p in hits_sorted[:3]],
        "insight": insight, "fix": fix,
    }


def analyze_coaching(positions: list[dict], *, now: Optional[date] = None) -> dict[str, Any]:
    now = now or date.today()
    rows = _closed(positions)
    leaks: list[dict] = []

    # 1) Directional longs carried overnight that lost — the signature mistake.
    overnight = [p for p in rows
                 if _is_directional_long(p) and (_hold_days(p) or 0) >= 1 and _f(p.get("realized_pnl")) < 0]
    if overnight:
        leaks.append(_leak(
            "OVERNIGHT_HELD_LOSS", "Directional longs held overnight that lost", "high", overnight, now,
            "Long calls/puts carried past the entry session are your most repeatable losers — "
            "premium bleeds and gaps go against a stale thesis.",
            "Flatten day-trade-style directional longs by the close; if it must be multi-day, "
            "size it as a swing with a defined stop."))

    # 2) Oversized single-trade losses — a loser allowed to run past the stop.
    oversized = [p for p in rows if _f(p.get("realized_pnl")) <= -_OVERSIZED_LOSS_ABS
                 or _f(p.get("realized_pnl_percent")) <= _OVERSIZED_LOSS_PCT]
    oversized = [p for p in oversized if _f(p.get("realized_pnl")) < 0]
    if oversized:
        leaks.append(_leak(
            "OVERSIZED_LOSS", "Losers allowed to run past a stop", "high", oversized, now,
            "A handful of outsized losses do most of the damage — each blew through where a "
            "stop should have been.",
            "Predefine a max loss per trade (e.g. −30% premium or a price stop) and honor it "
            "mechanically."))

    # 3) Directional-long structural drag (aggregate, informational).
    dlong = [p for p in rows if _is_directional_long(p)]
    dlong_agg = _agg(dlong)
    if dlong and dlong_agg["realized"] < 0:
        leaks.append({
            "code": "DIRECTIONAL_LONG_DRAG", "title": "Net-long directional premium is a net loser",
            "severity": "medium", "count": dlong_agg["n"], "cost": dlong_agg["realized"],
            "this_week": None, "prior_weekly_avg": None, "examples": [],
            "insight": f"Across {dlong_agg['n']} long calls/puts you are net "
                       f"{'down' if dlong_agg['realized'] < 0 else 'up'} "
                       f"${abs(dlong_agg['realized']):,.0f} (win rate {dlong_agg['win_rate']}%). "
                       f"Your edge sits in defined-risk / same-day structures instead.",
            "fix": "Shift weight toward the structures and holding periods that actually pay you; "
                   "treat naked directional longs as the exception, not the default.",
        })

    # 4) Risk/reward inverted — losers bigger than winners (aggregate, informational).
    a = _agg(rows)
    if a["avg_win"] and abs(a["avg_loss"]) > a["avg_win"]:
        leaks.append({
            "code": "RR_INVERTED", "title": "Losers cost more than winners make",
            "severity": "medium", "count": a["losses"], "cost": a["gross_loss"],
            "this_week": None, "prior_weekly_avg": None, "examples": [],
            "insight": f"Average loss ${abs(a['avg_loss']):,.0f} vs average win ${a['avg_win']:,.0f} — "
                       f"even at a {a['win_rate']}% hit rate the math barely clears breakeven.",
            "fix": "Cut losers sooner and let winners run to at least 1:1; a trailing stop after "
                   "the target's first touch protects the payoff.",
        })

    leaks.sort(key=lambda l: (0 if l["severity"] == "high" else 1, l["cost"]))

    # Distinct cost of the high-severity leaks (overnight & oversized overlap on
    # trades that were both — e.g. a big overnight loss — so sum the union, not
    # the leaks, to avoid double counting).
    high_hits = {id(p): p for p in (overnight + oversized)}
    total_leak_cost = round(sum(_f(p.get("realized_pnl")) for p in high_hits.values()), 2)

    # ── weekly digest ──────────────────────────────────────────────────────
    ws = _week_start(now)
    tw_rows = [p for p in rows if (_exit_date(p) or date.min) >= ws]
    tw = _agg(tw_rows)
    active = [l for l in leaks if l["severity"] == "high"]
    if tw["n"] == 0:
        digest = "No trades booked this week yet. Prior leaks below are the ones to watch."
    else:
        lead = (f"This week: {tw['n']} closed, {tw['win_rate']}% wins, "
                f"{'+' if tw['realized'] >= 0 else '−'}${abs(tw['realized']):,.0f} realized.")
        if active:
            top = active[0]
            digest = (f"{lead} Top leak still live: {top['title'].lower()} "
                      f"({top['count']} times, ${abs(top['cost']):,.0f}). Next week's one rule: {top['fix']}")
        else:
            digest = f"{lead} No high-severity process leaks flagged — keep the discipline."

    return {
        "leaks": leaks,
        "total_leak_cost": total_leak_cost,
        "weekly_digest": digest,
        "generated_for_now": now.isoformat(),
    }
