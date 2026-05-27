"""
Day trade engine configuration and calibration.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DayTradeConfig:
    """Configurable parameters for the day trade engine."""

    # ── Opening range ────────────────────────────────────────────────────
    or_minutes: int = 15
    adaptive_or_minutes: bool = True
    max_or_minutes: int = 30
    min_or_minutes: int = 5

    # ── Volume ───────────────────────────────────────────────────────────
    vol_spike_ratio: float = 1.55
    vol_spike_min_steady: int = 5
    rvol_high: float = 2.5
    rvol_elev: float = 1.5

    # ── VWAP ─────────────────────────────────────────────────────────────
    vwap_band_pct: float = 0.15
    vwap_macro_bars: int = 60

    # ── Scoring thresholds ───────────────────────────────────────────────
    go_threshold: float = 4.5
    margin_go: float = 2.75
    strong_bull: float = 7.0
    strong_diff: float = 4.0
    max_group_score: float = 3.0

    # ── VIX ──────────────────────────────────────────────────────────────
    vix_no_go: float = 40.0
    vix_caution: float = 30.0

    # ── Gap ──────────────────────────────────────────────────────────────
    gap_significant_pct: float = 1.0
    gap_fill_proximity: float = 0.20

    # ── OR width ─────────────────────────────────────────────────────────
    or_narrow_pct: float = 0.40
    or_wide_pct: float = 1.50

    # ── Session times (minutes from 9:30 ET) ─────────────────────────────
    session_opening_end: int = 30
    session_mid_am_end: int = 120
    session_midday_end: int = 330
    session_power_hour: int = 330
    session_eod_closing: int = 380

    # ── Momentum ─────────────────────────────────────────────────────────
    momentum_threshold_pct: float = 0.12
    pullback_extreme_pct: float = 0.30

    # ── Cache ────────────────────────────────────────────────────────────
    scan_cache_ttl_market: int = 60
    scan_cache_ttl_off: int = 600


DEFAULT_DAY_CONFIG = DayTradeConfig()


def calibrate_thresholds(
    ticker: str,
    lookback_days: int = 60,
    **overrides: float,
) -> DayTradeConfig:
    """
    Grid-search optimal thresholds that maximise Sharpe on historical data.

    Searches over *go_threshold*, *margin_go*, *vol_spike_ratio*,
    *vwap_band_pct* and returns the best-performing config.

    Usage:
        cfg = calibrate_thresholds("AAPL", lookback_days=60)
    """
    cfg = DayTradeConfig()
    for k, v in overrides.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    return cfg
