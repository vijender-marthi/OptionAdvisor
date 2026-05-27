"""Test that all verdicts use the single unified source."""
from verdict import Verdict


def test_all_verdicts_use_single_source():
    """Verify no old verdict fields remain in key files."""
    from decision_resolver.resolver import resolve_trade_decision
    result = resolve_trade_decision({
        "engine_type": "regular",
        "signals": {
            "directional_bias": "Bullish",
            "trend": "uptrend",
            "iv_rank": 30,
            "bias_confidence": 0.71,
            "iv_environment": "normal",
            "volatility_regime": "normal",
        },
        "recommendations": [
            {
                "strategy": "Long Call",
                "bias": "Bullish",
                "net_credit": -4.25,
                "expected_value": 0.18,
                "edge_ratio": 0.07,
                "dte": 28,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
                "warnings": [],
                "scores": {"total_score": 24},
            }
        ],
    })
    assert not hasattr(result, 'final_decision')
    assert not hasattr(result, 'signal_quality')
    assert not hasattr(result, 'execution_timing')
    assert not hasattr(result, 'risk_category')
    assert not hasattr(result, 'execution_readiness')
    assert hasattr(result, 'verdict')


def test_verdict_from_raw_coverage():
    """Verify all old verdict strings map correctly."""
    assert Verdict.from_raw("STRONG GO").value == "STRONG_GO"
    assert Verdict.from_raw("GO").value == "GO"
    assert Verdict.from_raw("WATCH").value == "WATCH"
    assert Verdict.from_raw("WAIT").value == "WAIT"
    assert Verdict.from_raw("NO-GO").value == "AVOID"
    assert Verdict.from_raw("NO_EDGE").value == "NO_EDGE"
    assert Verdict.from_raw("READY").value == "GO"
    assert Verdict.from_raw("AVOID").value == "AVOID"
