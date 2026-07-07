from __future__ import annotations


def trade_quality_score(
    *,
    structure: int,
    vwap_trend: int,
    relative_strength: int,
    volume: int,
    risk_reward: int,
    market_alignment: int,
) -> dict:
    breakdown = {
        "structure": max(0, min(25, structure)),
        "vwap_trend": max(0, min(20, vwap_trend)),
        "relative_strength": max(0, min(15, relative_strength)),
        "volume": max(0, min(15, volume)),
        "risk_reward": max(0, min(15, risk_reward)),
        "market_alignment": max(0, min(10, market_alignment)),
    }
    total = sum(breakdown.values())
    if total >= 80:
        verdict = "Strong Long Setup" if breakdown["vwap_trend"] >= 12 else "Strong Short Setup"
    elif total >= 65:
        verdict = "Long Watch" if breakdown["vwap_trend"] >= 12 else "Short Watch"
    elif total >= 50:
        verdict = "Neutral / No Trade"
    else:
        verdict = "Do Not Trade"
    return {"score": total, "breakdown": breakdown, "verdict": verdict}
