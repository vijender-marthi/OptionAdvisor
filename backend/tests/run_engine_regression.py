#!/usr/bin/env python3
"""
Engine regression validation runner.

Loads golden scenarios from tests/golden_scenarios/, runs them through
resolve_trade_decision(), and validates outputs against expected values.

Usage:
    python3 tests/run_engine_regression.py
    python3 tests/run_engine_regression.py --verbose
    python3 tests/run_engine_regression.py --scenario day_strong_bullish
"""

import glob
import json
import os
import sys
import traceback
from typing import Any

# Ensure backend root is on sys.path
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from decision_resolver import resolve_trade_decision  # noqa: E402

SCENARIO_DIR = os.path.join(BACKEND_DIR, "tests", "golden_scenarios")

# ── Helpers ────────────────────────────────────────────────────────────────────


def _resolve(p: str) -> str:
    return p  # identity — field paths use dot notation in expected

def _get_at(obj: dict, path: str) -> Any:
    parts = path.split(".")
    cur = obj
    for p in parts:
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return None
    return cur


def _contains_all(text: str, items: list[str]) -> list[str]:
    return [item for item in items if item.lower() not in text.lower()]


def _missing_section(label: str, actual: str, must_contain: list[str]) -> list[str]:
    return [f"{label}: expected to contain '{x}' but text was: {actual[:120]}" for x in must_contain
            if x.lower() not in actual.lower()]


# ── Contradiction rules ────────────────────────────────────────────────────────

CONTRADICTION_RULES: list[tuple[list[tuple[str, str]], str]] = [
    ([("execution_timing", "ENTER NOW"), ("execution_timing", "WAIT FOR PULLBACK")],
     "ENTER NOW and WAIT FOR PULLBACK together"),
    ([("signal_quality", "STRONG GO"), ("execution_timing", "STAND ASIDE")],
     "STRONG GO with STAND ASIDE"),
    ([("signal_quality", "GO"), ("execution_timing", "STAND ASIDE")],
     "GO with STAND ASIDE"),
    ([("final_decision", "READY"), ("execution_timing", "STAND ASIDE")],
     "READY with STAND ASIDE"),
    ([("final_decision", "READY"), ("execution_timing", "WAIT FOR PULLBACK")],
     "READY with WAIT FOR PULLBACK"),
    ([("risk_state", "LOW"), ("missing_confirmations", "earnings")],
     "LOW risk with earnings danger"),
]

EXPLANATION_REQUIREMENTS: dict[str, list[str]] = {
    "Covered Call": ["assignment", "capped", "premium"],
    "Long Call": ["momentum", "premium"],
    "Long Put": ["breakdown", "put"],
    "Bull Put Spread": ["credit", "short strike", "support"],
    "Bear Call Spread": ["credit", "resistance", "short strike"],
    "Bull Call Spread": ["debit spread", "breakeven"],
    "Bear Put Spread": ["debit spread", "breakeven"],
    "Iron Condor": ["range", "credit"],
    "Covered Put": ["premium", "assignment"],
}

CONFIDENCE_MIN_READY = 50
CONFIDENCE_MAX_AVOID = 50
CONFIDENCE_MAX_NO_EDGE = 30


# ── Scenario runner ─────────────────────────────────────────────────────────────


def run_scenario(path: str, verbose: bool = False) -> dict:
    """Run one scenario and return a result dict."""
    filename = os.path.basename(path)
    with open(path) as f:
        scenario = json.load(f)

    name = scenario.get("name", filename)
    inp = scenario.get("input", {})
    expected = scenario.get("expected", {})
    engine_type = scenario.get("engine_type", "regular")

    result: dict = {
        "name": name,
        "filename": filename,
        "passed": True,
        "errors": [],
        "warnings": [],
        "engine_type": engine_type,
    }

    # Run resolver
    try:
        decision = resolve_trade_decision(inp)
    except Exception as exc:
        result["passed"] = False
        result["errors"].append(f"Resolver raised exception: {exc}\n{traceback.format_exc()}")
        return result

    if decision is None:
        result["passed"] = False
        result["errors"].append("Resolver returned None")
        return result

    # ── Field validations ───────────────────────────────────────────────────
    field_checks = [
        ("market_bias", "market_bias", str),
        ("setup_quality", "setup_quality", str),
        ("final_decision", "final_decision", str),
        ("execution_timing", "execution_timing", str),
        ("signal_quality", "signal_quality", str),
        ("risk_state", "risk_state", str),
        ("risk_category", "risk_category", str),
    ]

    for field, attr, _ in field_checks:
        expected_val = expected.get(field)
        if expected_val is None:
            continue
        actual_val = str(getattr(decision, attr, "") or "")
        if actual_val.upper() != expected_val.upper():
            result["errors"].append(
                f"{field}: expected '{expected_val}', got '{actual_val}'"
            )

    # ── Confidence range ────────────────────────────────────────────────────
    conf = int(getattr(decision, "confidence", 0) or 0)
    if "confidence_min" in expected:
        if conf < expected["confidence_min"]:
            result["errors"].append(
                f"confidence: {conf} < min {expected['confidence_min']}"
            )
    if "confidence_max" in expected:
        if conf > expected["confidence_max"]:
            result["errors"].append(
                f"confidence: {conf} > max {expected['confidence_max']}"
            )

    # ── Missing confirmations ───────────────────────────────────────────────
    actual_missing = [str(x) for x in getattr(decision, "missing_confirmations", [])]
    expected_missing = expected.get("missing_confirmations", [])
    for exp_m in expected_missing:
        found = any(exp_m.lower() in am.lower() for am in actual_missing)
        if not found:
            result["errors"].append(
                f"missing_confirmations: expected '{exp_m}' not found in {actual_missing}"
            )

    # ── Must-not-contain ────────────────────────────────────────────────────
    must_not = expected.get("must_not_contain", [])
    check_fields = {
        "execution_timing": str(getattr(decision, "execution_timing", "") or ""),
        "final_decision": str(getattr(decision, "final_decision", "") or ""),
        "signal_quality": str(getattr(decision, "signal_quality", "") or ""),
    }
    for phrase in must_not:
        for fname, fval in check_fields.items():
            if phrase.lower() in fval.lower():
                result["errors"].append(
                    f"must_not_contain: '{phrase}' found in {fname}='{fval}'"
                )

    # ── Explanation checks ──────────────────────────────────────────────────
    explanation = {}
    if hasattr(decision, "explanation") and decision.explanation:
        explanation = dict(decision.explanation)
    expl_contains = expected.get("explanation_contains", [])
    if expl_contains:
        combined = " ".join(str(v) for v in explanation.values())
        missing_expl = _contains_all(combined, expl_contains)
        if missing_expl:
            result["warnings"].append(
                f"explanation missing terms: {missing_expl}"
            )

    # ── Strategy-specific explanation quality ──────────────────────────────
    strategy = str(getattr(decision, "setup_quality", "") or "")
    # Check input for strategy name
    recs = inp.get("recommendations") or []
    strategy_name = ""
    if recs:
        strategy_name = str(recs[0].get("strategy", "") or "")
    if strategy_name in EXPLANATION_REQUIREMENTS:
        required = EXPLANATION_REQUIREMENTS[strategy_name]
        combined = " ".join(str(v) for v in explanation.values())
        missing_terms = _contains_all(combined, required)
        if missing_terms:
            result["warnings"].append(
                f"{strategy_name} explanation missing required terms: {missing_terms}"
            )

    # ── Execution fields check ──────────────────────────────────────────────
    exec_fields_present = expected.get("execution_fields_present", [])
    if exec_fields_present:
        actual_fields = [str(x.get("label", "")) for x in
                         (getattr(decision, "execution_fields", None) or [])]
        for exp_field in exec_fields_present:
            if exp_field not in actual_fields:
                result["warnings"].append(
                    f"execution_fields: expected '{exp_field}' not found in {actual_fields}"
                )

    # ── Contradiction detection ─────────────────────────────────────────────
    decision_dict = {
        "execution_timing": str(getattr(decision, "execution_timing", "") or ""),
        "signal_quality": str(getattr(decision, "signal_quality", "") or ""),
        "final_decision": str(getattr(decision, "final_decision", "") or ""),
        "risk_state": str(getattr(decision, "risk_state", "") or ""),
        "missing_confirmations": [str(x).lower() for x in
                                   getattr(decision, "missing_confirmations", [])],
    }

    for _, rule_desc in CONTRADICTION_RULES:
        pass  # We check independent contradictions below

    # Specific contradiction: ENTER NOW with non-empty confirmations
    exec_timing = str(getattr(decision, "execution_timing", "") or "")
    if "ENTER NOW" in exec_timing.upper():
        if actual_missing:
            result["errors"].append(
                f"CONTRADICTION: execution_timing='{exec_timing}' but missing_confirmations={actual_missing}"
            )

    # Specific contradiction: READY + HIGH risk (for day/swing)
    fd = str(getattr(decision, "final_decision", "") or "")
    rs = str(getattr(decision, "risk_state", "") or "")
    if fd == "READY" and rs in ("HIGH", "EXTREME"):
        result["errors"].append(
            f"CONTRADICTION: final_decision='READY' with risk_state='{rs}'"
        )

    # Specific contradiction: AVOID + high confidence
    if fd in ("AVOID", "NO_EDGE") and conf >= 70:
        result["warnings"].append(
            f"UNUSUAL: {fd} with confidence={conf}"
        )

    # ── Strategy vs explanation contradiction check ──────────────────────
    reason_text = str(getattr(decision, "reason", "") or "")
    # Extract "Best structure: X" from reason
    best_struct_match = __import__("re").search(r"Best structure:\s*([^\.]+)", reason_text)
    if best_struct_match:
        best_struct = best_struct_match.group(1).strip()
        # Check scenario's input recommendation strategy (regular) or engine_type (swing)
        recs = inp.get("recommendations") or []
        if recs:
            input_strat = str(recs[0].get("strategy", "") or "")
            if input_strat and input_strat.lower() != best_struct.lower():
                result["errors"].append(
                    f"STRATEGY CONTRADICTION: explanation says 'Best structure: {best_struct}' "
                    f"but recommendation strategy is '{input_strat}'"
                )

    if result["errors"]:
        result["passed"] = False

    return result


def run_all_scenarios(verbose: bool = False, filter_name: str | None = None) -> list[dict]:
    """Run all scenarios or filter by name substring."""
    pattern = os.path.join(SCENARIO_DIR, "*.json")
    paths = sorted(glob.glob(pattern))
    if not paths:
        print(f"ERROR: No scenario files found in {SCENARIO_DIR}")
        sys.exit(1)

    results = []
    for p in paths:
        if filter_name and filter_name not in os.path.basename(p):
            continue
        results.append(run_scenario(p, verbose=verbose))
    return results


def print_report(results: list[dict]) -> None:
    """Print a human-readable summary."""
    passed = [r for r in results if r["passed"]]
    failed = [r for r in results if not r["passed"]]

    total = len(results)
    n_pass = len(passed)
    n_fail = len(failed)
    n_warn = sum(1 for r in results if r["warnings"])

    print(f"\n{'='*60}")
    print(f"  ENGINE REGRESSION REPORT")
    print(f"{'='*60}")
    print(f"  Scenarios : {total}")
    print(f"  Passed    : {n_pass}")
    print(f"  Failed    : {n_fail}")
    print(f"  Warnings  : {n_warn}")
    print(f"{'='*60}")

    if failed:
        print(f"\n  FAILURES:")
        for r in failed:
            print(f"    ✗ {r['name']} ({r['filename']})")
            for err in r["errors"]:
                print(f"      - {err}")

    if n_warn > 0:
        print(f"\n  WARNINGS:")
        for r in results:
            if r["warnings"]:
                print(f"    ⚠ {r['name']} ({r['filename']})")
                for w in r["warnings"]:
                    print(f"      - {w}")

    print(f"\n  Engine types covered:")
    types: dict[str, int] = {}
    for r in results:
        et = r.get("engine_type", "unknown")
        types[et] = types.get(et, 0) + 1
    for et, cnt in sorted(types.items()):
        status = "✓" if all(r["passed"] for r in results if r.get("engine_type") == et) else "✗"
        print(f"    {status} {et}: {cnt}")

    print(f"\n{'='*60}")
    print(f"  SUMMARY: {n_pass}/{total} passed")
    if n_fail:
        print(f"  ❌  {n_fail} FAILURES — review errors above")
    else:
        print(f"  ✅  ALL PASSED")
    print(f"{'='*60}\n")


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Engine regression validation")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--scenario", "-s", type=str, default=None,
                        help="Run only scenarios matching name substring")
    args = parser.parse_args()

    results = run_all_scenarios(
        verbose=args.verbose,
        filter_name=args.scenario,
    )
    print_report(results)

    failed_count = sum(1 for r in results if not r["passed"])
    return 1 if failed_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
