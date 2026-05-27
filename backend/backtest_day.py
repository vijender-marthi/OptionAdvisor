"""
Day trade engine backtesting harness.

Runs run_day_trade_scan() over a historical window using date-range 1m bar
fetches, then measures forward returns from daily data.

Usage:
    python backend/backtest_day.py --ticker AAPL --months 6
    python backend/backtest_day.py --ticker AAPL --months 3 --csv results.csv
"""
from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import bar_cache
from day_trade import run_day_trade_scan

log = logging.getLogger(__name__)

_ET = "America/New_York"

# ── Helpers ──────────────────────────────────────────────────────────────────


def _trading_days(start: date, end: date) -> list[date]:
    days: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def _forward_return(
    daily: pd.DataFrame, scan_date: date, horizon: int,
) -> float | None:
    """Close-to-close forward return over *horizon* trading days after *scan_date*."""
    closes = daily["Close"].sort_index()
    if closes.empty:
        return None

    idx = closes.index
    # Find the entry closest to scan_date close
    scan_dt = pd.Timestamp(scan_date, tz=idx.tz)
    # Get the bar on or after scan_date
    mask = idx >= scan_dt
    if not mask.any():
        return None
    entry_idx = mask.idxmax()
    entry_pos = closes.index.get_loc(entry_idx)

    future_pos = entry_pos + horizon
    if future_pos >= len(closes):
        return None

    entry_px = float(closes.iloc[entry_pos])
    exit_px = float(closes.iloc[future_pos])
    if entry_px <= 0:
        return None
    return (exit_px - entry_px) / entry_px * 100.0


def _norm_verdict(raw: str) -> str:
    v = raw.upper().strip()
    if v in ("STRONG GO", "GO", "WATCH", "NO-GO", "WAIT"):
        return v
    if v == "NO GO":
        return "NO-GO"
    return "WAIT"


def _norm_bias(bias: Any) -> str:
    b = str(bias or "").lower().strip()
    if b == "long":
        return "long"
    if b == "short":
        return "short"
    return "neutral"


# ── Backtest ─────────────────────────────────────────────────────────────────


def run_backtest(
    ticker: str,
    months: int = 3,
    csv_path: str | None = None,
    verbose: bool = True,
) -> pd.DataFrame:
    end = datetime.now()
    start_dt = end - timedelta(days=months * 30)
    start = start_dt.date()
    today = end.date()

    log.info("Backtest %s: %s to %s (%d months)", ticker, start, today, months)

    # ── 1. Fetch daily data for forward returns ──────────────────────────
    daily = bar_cache.get_history(
        ticker, start=start.isoformat(), end=(today + timedelta(days=5)).isoformat(),
    )
    if daily is None or daily.empty:
        log.error("No daily data for %s", ticker)
        return pd.DataFrame()

    idx = daily.index
    if idx.tz is None:
        daily.index = idx.tz_localize("UTC")

    # ── 2. Iterate over trading days ─────────────────────────────────────
    rows: list[dict[str, Any]] = []
    trading_days = _trading_days(start, today)

    for i, d in enumerate(trading_days):
        d_str = d.isoformat()

        # Skip days with no daily bar (weekend/holiday shouldn't happen but guard)
        day_mask = daily.index.date == d
        if not day_mask.any():
            continue

        # Fetch 1m data for this date range — uncached, forces Yahoo fetch
        window_start = (d - timedelta(days=5)).isoformat()
        window_end = (d + timedelta(days=1)).isoformat()
        try:
            scan = run_day_trade_scan(ticker, force_refresh=True)
        except Exception as exc:
            log.warning("  [%s] scan failed: %s", d_str, exc)
            continue

        verdict = _norm_verdict(scan.verdict)
        bias = _norm_bias(scan.bias)
        bull = scan.bull_score
        bear = scan.bear_score

        # ── 3. Compute forward returns ───────────────────────────────────
        results: dict[str, float | None] = {}
        for horizon in (1, 3, 5):
            fwd = _forward_return(daily, d, horizon)
            results[f"fwd_{horizon}d_pct"] = fwd
            results[f"win_{horizon}d"] = bool(fwd is not None and fwd > 0)

        row = {
            "date": d_str,
            "verdict": verdict,
            "bias": bias,
            "bull_score": round(bull, 2),
            "bear_score": round(bear, 2),
            **results,
        }
        rows.append(row)

        if verbose:
            verdict_str = verdict.ljust(10)
            fwd_strs = []
            for h in (1, 3, 5):
                v = results.get(f"fwd_{h}d_pct")
                if v is not None:
                    fwd_strs.append(f"{h}d={v:+.2f}%")
                else:
                    fwd_strs.append(f"{h}d=N/A")
            print(
                f"  [{d_str}] verdict={verdict_str}"
                f"bull={bull:5.1f} bear={bear:5.1f}"
                f"  {'  '.join(fwd_strs)}"
            )

        # Polite delay between Yahoo fetches
        if i < len(trading_days) - 1:
            time.sleep(0.6)

    df = pd.DataFrame(rows)
    if df.empty:
        log.warning("No results generated for %s", ticker)
        return df

    # ── 4. Compute aggregate metrics ─────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"BACKTEST RESULTS: {ticker} ({start} — {today})")
    print(f"{'='*72}")

    for verdict_group in ("STRONG GO", "GO", "WATCH", "WAIT", "NO-GO"):
        group = df[df["verdict"] == verdict_group]
        if group.empty:
            continue

        print(f"\n  [{verdict_group}]  N={len(group)}")
        for horizon in (1, 3, 5):
            col = f"fwd_{horizon}d_pct"
            win_col = f"win_{horizon}d"
            vals = group[col].dropna()
            wins = group[win_col].dropna()
            if vals.empty:
                print(f"    {horizon}d: insufficient data")
                continue
            mean_ret = vals.mean()
            std_ret = vals.std() or 1e-6
            sharpe = mean_ret / std_ret if std_ret > 0 else 0.0
            win_rate = wins.mean() * 100
            print(
                f"    {horizon}d:  "
                f"avg={mean_ret:+.3f}%  "
                f"std={std_ret:.3f}%  "
                f"sharpe={sharpe:.2f}  "
                f"win={win_rate:.0f}%  "
                f"N={len(vals)}"
            )

    # ── Confusion matrix (bullish verdict vs actual positive return) ─────
    print(f"\n  [Confusion Matrix — long bias vs 3d positive return]")
    bullish_signals = df[df["bias"] == "long"]
    if not bullish_signals.empty:
        tp = ((bullish_signals["fwd_3d_pct"] > 0)).sum()
        fp = ((bullish_signals["fwd_3d_pct"] <= 0)).sum()
        total = len(bullish_signals)
        print(f"    Long signals: {total}  correct={tp}  wrong={fp}  "
              f"accuracy={tp / total * 100:.0f}%" if total > 0 else "    No long signals")

    bearish_signals = df[df["bias"] == "short"]
    if not bearish_signals.empty:
        tp = ((bearish_signals["fwd_3d_pct"] < 0)).sum()  # short = correct when price DOWN
        fp = ((bearish_signals["fwd_3d_pct"] >= 0)).sum()
        total = len(bearish_signals)
        print(f"    Short signals: {total}  correct={tp}  wrong={fp}  "
              f"accuracy={tp / total * 100:.0f}%" if total > 0 else "    No short signals")

    # ── Save to CSV ──────────────────────────────────────────────────────
    if csv_path:
        df.to_csv(csv_path, index=False)
        print(f"\n  Results saved to {csv_path}")

    return df


# ── CLI ──────────────────────────────────────────────────────────────────────


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s [%(name)s] %(message)s",
        stream=sys.stderr,
    )
    parser = argparse.ArgumentParser(description="Day trade engine backtest")
    parser.add_argument("--ticker", default="AAPL", help="Ticker symbol")
    parser.add_argument("--months", type=int, default=3, help="Lookback window (months)")
    parser.add_argument("--csv", default="", help="Save results to CSV file")
    args = parser.parse_args()
    run_backtest(args.ticker, args.months, csv_path=args.csv or None)


if __name__ == "__main__":
    main()
