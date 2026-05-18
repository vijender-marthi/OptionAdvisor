"""
ai_coach.py — AI-powered structured coaching summary for the Day Trade Engine.

Supports Anthropic (preferred) and OpenAI as LLM backends.
Falls back to a rich deterministic stub when no API key is configured so
the platform is fully functional without any GenAI subscription.

Environment variables
---------------------
ANTHROPIC_API_KEY   use Claude (preferred)
OPENAI_API_KEY      use GPT-4o-mini (fallback when no Anthropic key)
AI_COACH_ENABLED    set to "false" to force deterministic path (default: "true")
AI_COACH_MODEL      override model name (optional)
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

# ── In-process cache ────────────────────────────────────────────────────────────
_coach_cache: dict[str, tuple[float, dict[str, Any]]] = {}
COACH_CACHE_TTL = 900  # 15 minutes — matches day trade scan cache

# ── System / coaching prompt ────────────────────────────────────────────────────
_SYSTEM_PROMPT = """\
You are an AI Trading Coach embedded in a professional options trading platform.
Your job is to analyze trading signals from a trading engine and return a
structured JSON coaching summary.

STRICT RULES:
- Always respond with valid JSON only
- No preamble, no markdown, no explanation outside JSON
- Never use free text summaries — all output must be typed structured fields
- All price levels must be numbers, not strings
- Confidence must be 0-100 integer
- Bias must be: "bullish" | "bearish" | "neutral"
- Action must be: "WATCH" | "ENTER" | "EXIT" | "HOLD"
- Setup type must be: "CALL" | "PUT" | "SPREAD" | "NONE"
- Risk must be: "LOW" | "MEDIUM" | "HIGH"

INPUT: You will receive a signal JSON from the trading engine:
{
  "ticker": string,
  "price": number,
  "vwap": number,
  "orh": number,
  "orl": number,
  "bias": string,
  "confidence": number,
  "action": string,
  "risk": string,
  "volume_confirmed": boolean,
  "price_vs_vwap": "above" | "below",
  "price_vs_or": "above_orh" | "inside_or" | "below_orl",
  "spy_bias": "bullish" | "bearish" | "neutral",
  "spy_vs_vwap": "above" | "below",
  "spy_vs_orh": "above" | "below" | "inside"
}

OUTPUT: Return exactly this JSON structure, nothing else:
{
  "ticker": string,
  "timestamp": ISO8601 string,
  "setup_type": "CALL" | "PUT" | "SPREAD" | "NONE",
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": number,
  "action": "WATCH" | "ENTER" | "EXIT" | "HOLD",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "market_context": {
    "spy_alignment": boolean,
    "spy_note": string,
    "volume_confirmed": boolean,
    "relative_strength": "strong" | "weak" | "neutral"
  },
  "summary": string,
  "entry_condition": string,
  "invalidation": string,
  "states": {
    "setup": { "label": string, "detail": string, "key_levels": [number] },
    "entry": { "label": string, "trigger": string, "price": number },
    "in_play": { "label": string, "target": number, "trail_level": number, "add_condition": string },
    "exit": { "label": string, "stop_loss": number, "exit_condition": string }
  },
  "decision_tree": [
    { "if": string, "then": string, "action": "ENTER"|"WAIT"|"EXIT"|"AVOID", "confidence": "high"|"medium"|"low" }
  ],
  "best_next_step": string,
  "options_note": string
}

COACHING LOGIC RULES:

1. SPY ALIGNMENT
   - If ticker bias CONFLICTS with SPY bias, lower confidence by 15 points
   - If ticker bias ALIGNS with SPY bias, raise confidence by 10 points
   - Always note divergence/alignment in market_context.spy_note

2. SETUP TYPE LOGIC
   - above VWAP + bullish bias = CALL (or SPREAD if confidence < 70)
   - below VWAP + bearish bias = PUT (or SPREAD if confidence < 70)
   - Inside OR + no volume confirmation = NONE
   - confidence < 60 = NONE

3. DECISION TREE RULES
   - Always include minimum 3 IF/THEN nodes
   - Node 1: Primary entry confirmation scenario
   - Node 2: Bias invalidation scenario
   - Node 3: Missed entry / chase warning
   - Add Node 4 if SPY divergence exists

4. OPTIONS SPECIFIC
   - Flag theta risk if action is WATCH
   - confidence > 80 = naked option acceptable
   - confidence 60-80 = spread preferred
   - confidence < 60 = WATCH only, no options

5. VOLUME RULES
   - volume_confirmed: false = action must be WATCH, never ENTER

6. RISK/REWARD
   - If implied R/R < 1:2, flag as poor in options_note
"""

_USER_TEMPLATE = "Analyze this trading signal and return the structured JSON coaching summary:\n{signal_json}"


# ── Signal extraction ────────────────────────────────────────────────────────────

def build_coach_signal(scan_dict: dict[str, Any], risk_state: str = "MEDIUM") -> dict[str, Any]:
    """
    Extract the standardized coaching input signal from a serialised DayTradeScan +
    resolved decision fields.  All values are safe primitives — no None leakage.
    """
    metrics = scan_dict.get("metrics") or {}
    eg      = scan_dict.get("entry_guidance") or {}

    price   = float(metrics.get("last_price") or 0)
    vwap    = float(eg.get("vwap") or metrics.get("vwap") or 0)
    orh     = float(eg.get("opening_range_high") or metrics.get("or_high") or 0)
    orl     = float(eg.get("opening_range_low") or metrics.get("or_low") or 0)
    bias    = str(scan_dict.get("bias") or "neutral").lower()

    # Normalise bias to bullish/bearish/neutral for AI prompt
    if bias == "long":
        bias = "bullish"
    elif bias == "short":
        bias = "bearish"

    conf = int(scan_dict.get("display_confidence") or scan_dict.get("confidence") or 50)

    # OR position
    or_breakout = str(metrics.get("or_breakout") or "inside").lower()
    price_vs_or: str
    if or_breakout in ("above",):
        price_vs_or = "above_orh"
    elif or_breakout in ("below",):
        price_vs_or = "below_orl"
    else:
        price_vs_or = "inside_or"

    vwap_dist = float(metrics.get("vwap_dist_pct") or 0)
    price_vs_vwap = "above" if vwap_dist >= 0 else "below"

    volume_confirmed = bool(metrics.get("volume_spike", False))

    # SPY/QQQ context
    spy_chg = float(metrics.get("spy_change_pct") or 0)
    if spy_chg > 0.25:
        spy_bias = "bullish"
    elif spy_chg < -0.25:
        spy_bias = "bearish"
    else:
        spy_bias = "neutral"

    spy_vs_vwap = "above" if spy_chg >= 0 else "below"
    spy_vs_orh  = "above" if spy_chg > 0.5 else ("below" if spy_chg < -0.2 else "inside")

    verdict = str(scan_dict.get("verdict") or "WATCH")
    action_map = {
        "STRONG GO": "ENTER", "GO": "WATCH",
        "WATCH": "WATCH",     "NO-GO": "AVOID",
        "WAIT": "WATCH",
    }
    action = action_map.get(verdict.upper(), "WATCH")

    return {
        "ticker":            scan_dict.get("ticker", ""),
        "price":             round(price, 2),
        "vwap":              round(vwap, 2),
        "orh":               round(orh, 2),
        "orl":               round(orl, 2),
        "bias":              bias,
        "confidence":        conf,
        "action":            action,
        "risk":              risk_state.upper() or "MEDIUM",
        "volume_confirmed":  volume_confirmed,
        "price_vs_vwap":     price_vs_vwap,
        "price_vs_or":       price_vs_or,
        "spy_bias":          spy_bias,
        "spy_vs_vwap":       spy_vs_vwap,
        "spy_vs_orh":        spy_vs_orh,
        # extra context passed through but not in AI prompt
        "_rs_vs_qqq":        float(metrics.get("rs_vs_qqq_pct") or 0),
        "_scalp_target":     float(eg.get("scalp_target") or 0),
        "_risk_below":       float(eg.get("risk_below") or 0),
    }


# ── JSON validation ─────────────────────────────────────────────────────────────

_REQUIRED_KEYS = {
    "ticker", "timestamp", "setup_type", "bias", "confidence",
    "action", "risk", "market_context", "summary", "entry_condition",
    "invalidation", "states", "decision_tree", "best_next_step", "options_note",
}
_VALID_SETUP_TYPES = {"CALL", "PUT", "SPREAD", "NONE"}
_VALID_BIASES      = {"bullish", "bearish", "neutral"}
_VALID_ACTIONS     = {"WATCH", "ENTER", "EXIT", "HOLD"}
_VALID_RISKS       = {"LOW", "MEDIUM", "HIGH"}


def _validate_coach_result(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce and validate the AI-produced dict. Raises ValueError on fatal failures."""
    missing = _REQUIRED_KEYS - set(raw.keys())
    if missing:
        raise ValueError(f"AI coach response missing keys: {missing}")

    raw["setup_type"] = str(raw.get("setup_type", "NONE")).upper()
    if raw["setup_type"] not in _VALID_SETUP_TYPES:
        raw["setup_type"] = "NONE"

    raw["bias"] = str(raw.get("bias", "neutral")).lower()
    if raw["bias"] not in _VALID_BIASES:
        raw["bias"] = "neutral"

    raw["action"] = str(raw.get("action", "WATCH")).upper()
    if raw["action"] not in _VALID_ACTIONS:
        raw["action"] = "WATCH"

    raw["risk"] = str(raw.get("risk", "MEDIUM")).upper()
    if raw["risk"] not in _VALID_RISKS:
        raw["risk"] = "MEDIUM"

    raw["confidence"] = max(0, min(100, int(raw.get("confidence", 50) or 50)))

    # Ensure states sub-structure
    states = raw.get("states") or {}
    for k in ("setup", "entry", "in_play", "exit"):
        if k not in states:
            states[k] = {}
    raw["states"] = states

    # decision_tree must be a list
    if not isinstance(raw.get("decision_tree"), list):
        raw["decision_tree"] = []

    return raw


# ── LLM callers ─────────────────────────────────────────────────────────────────

def _call_anthropic(signal: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    import anthropic  # type: ignore[import]
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    model  = model or os.getenv("AI_COACH_MODEL") or "claude-haiku-4-5"
    msg    = client.messages.create(
        model=model,
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _USER_TEMPLATE.format(
            signal_json=json.dumps({k: v for k, v in signal.items() if not k.startswith("_")})
        )}],
    )
    text = msg.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return _validate_coach_result(json.loads(text))


def _call_openai(signal: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    import openai  # type: ignore[import]
    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    model  = model or os.getenv("AI_COACH_MODEL") or "gpt-4o-mini"
    resp   = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": _USER_TEMPLATE.format(
                signal_json=json.dumps({k: v for k, v in signal.items() if not k.startswith("_")})
            )},
        ],
        max_tokens=1024,
    )
    return _validate_coach_result(json.loads(resp.choices[0].message.content))


# ── Deterministic fallback ───────────────────────────────────────────────────────

def build_deterministic_coach(signal: dict[str, Any]) -> dict[str, Any]:
    """
    Produce the full AiCoachResult structure using rule-based logic.
    Used when no LLM API key is configured, or as a fallback on API failure.
    Produces the identical JSON shape so the frontend works identically.
    """
    ticker = signal.get("ticker", "")
    price  = float(signal.get("price") or 0)
    vwap   = float(signal.get("vwap") or 0)
    orh    = float(signal.get("orh") or 0)
    orl    = float(signal.get("orl") or 0)
    bias   = str(signal.get("bias") or "neutral")
    conf   = int(signal.get("confidence") or 50)
    risk   = str(signal.get("risk") or "MEDIUM")
    vol_ok = bool(signal.get("volume_confirmed"))
    pvv    = signal.get("price_vs_vwap", "below")
    pvo    = signal.get("price_vs_or",   "inside_or")
    spy_b  = signal.get("spy_bias", "neutral")
    rs     = float(signal.get("_rs_vs_qqq") or 0)
    scalp  = float(signal.get("_scalp_target") or 0)
    stop   = float(signal.get("_risk_below") or 0)

    is_bear   = bias == "bearish"
    is_bull   = bias == "bullish"

    # SPY alignment
    spy_aligns = (is_bear and spy_b == "bearish") or (is_bull and spy_b == "bullish")
    if spy_aligns:
        conf = min(100, conf + 10)
    elif spy_b not in ("neutral",):
        conf = max(0, conf - 15)
    spy_note = (
        f"SPY {spy_b}, aligns with {ticker} {bias} bias"
        if spy_aligns else
        f"SPY {spy_b}, diverges from {ticker} {bias} bias"
    )

    # Setup type
    if conf < 60 or (pvo == "inside_or" and not vol_ok):
        setup_type = "NONE"
    elif is_bear and pvv == "below":
        setup_type = "PUT" if conf >= 70 else "SPREAD"
    elif is_bull and pvv == "above":
        setup_type = "CALL" if conf >= 70 else "SPREAD"
    else:
        setup_type = "SPREAD" if conf >= 60 else "NONE"

    # Action
    if not vol_ok or pvo == "inside_or":
        action = "WATCH"
    elif conf >= 70 and vol_ok:
        action = "ENTER"
    else:
        action = "WATCH"

    # Relative strength
    relative_strength = "strong" if rs > 0.5 else ("weak" if rs < -0.5 else "neutral")

    # Prices
    entry_price  = orl  if is_bear else orh
    entry_price  = entry_price or (vwap or price)
    trail_level  = orl  if is_bear else orh
    trail_level  = trail_level or vwap
    if not scalp:
        scalp = round(price * 0.985, 2) if is_bear else round(price * 1.015, 2)
    if not stop:
        stop  = orh if is_bear else (orl or round(price * 0.985, 2))

    # Summary (≤40 words)
    vwap_str = f"${vwap:.2f}" if vwap else "VWAP"
    orl_str  = f"${orl:.2f}"  if orl  else "ORL"
    orh_str  = f"${orh:.2f}"  if orh  else "ORH"
    vol_txt  = "volume confirmed" if vol_ok else "volume unconfirmed"
    if is_bear:
        summary = (
            f"{ticker} below VWAP {vwap_str} and ORL {orl_str}. Bearish bias, {vol_txt}. "
            + ("Breakdown active." if vol_ok and pvo == "below_orl"
               else "Wait for rejection candle with volume before entering PUT.")
        )
    else:
        summary = (
            f"{ticker} above VWAP {vwap_str} and ORH {orh_str}. Bullish bias, {vol_txt}. "
            + ("Breakout active." if vol_ok and pvo == "above_orh"
               else "Wait for breakout candle with volume before entering CALL.")
        )

    # Entry condition (≤20 words)
    if is_bear:
        entry_condition = (
            f"Bounce to {orl_str} then rejection candle with volume"
            if pvo != "below_orl" else
            f"Close and hold below {orl_str} with expanding volume"
        )
    else:
        entry_condition = (
            f"Break above {orh_str} with volume-confirmed continuation candle"
            if pvo != "above_orh" else
            f"Close and hold above {orh_str} with expanding volume"
        )

    # Invalidation (≤15 words)
    if is_bear:
        invalidation = f"{ticker} reclaims VWAP {vwap_str} on volume" if vwap else f"{ticker} closes above ORL"
    else:
        invalidation = f"{ticker} loses VWAP {vwap_str} on volume" if vwap else f"{ticker} closes below ORH"

    # State labels
    if is_bear:
        setup_lbl    = "SHORT BIAS FORMING"
        setup_detail = "VWAP and ORL acting as resistance — watch for rejection"
        entry_trig   = f"Close & hold <{orl_str}" if orl else f"Close below VWAP {vwap_str}"
        inplay_lbl   = "BREAKDOWN ACTIVE"
        add_cond     = f"Add on weakness below {orl_str}" if orl else "Add on continuation"
        exit_cond    = "VWAP reclaimed above or ORL closed back above → cover"
    else:
        setup_lbl    = "LONG BIAS FORMING"
        setup_detail = "VWAP and ORH acting as support — watch for breakout"
        entry_trig   = f"Close & hold >{orh_str}" if orh else f"Close above VWAP {vwap_str}"
        inplay_lbl   = "BREAKOUT ACTIVE"
        add_cond     = f"Add on strength above {orh_str}" if orh else "Add on continuation"
        exit_cond    = "VWAP lost below or ORH closed back below → exit"

    key_levels = [x for x in [vwap, orh, orl] if x > 0]

    # Decision tree
    dt: list[dict] = []
    if is_bear:
        dt.append({"if": f"{ticker} rejects at {orl_str} with volume", "then": f"Enter PUT, target ${scalp:.2f}", "action": "ENTER", "confidence": "high"})
        dt.append({"if": f"{ticker} reclaims VWAP {vwap_str}", "then": "Short thesis invalidated — no trade", "action": "AVOID", "confidence": "high"})
        dt.append({"if": f"{ticker} drops below ${price * 0.98:.2f} without bounce", "then": "Missed entry — do not chase", "action": "WAIT", "confidence": "high"})
    else:
        dt.append({"if": f"{ticker} breaks above {orh_str} with volume", "then": f"Enter CALL, target ${scalp:.2f}", "action": "ENTER", "confidence": "high"})
        dt.append({"if": f"{ticker} loses VWAP {vwap_str}", "then": "Long thesis invalidated — no trade", "action": "AVOID", "confidence": "high"})
        dt.append({"if": f"{ticker} extends to ${price * 1.02:.2f} without pullback", "then": "Missed entry — do not chase", "action": "WAIT", "confidence": "high"})
    if not spy_aligns and spy_b != "neutral":
        bad_spy = "bearish" if is_bull else "bullish"
        dt.append({"if": f"SPY reverses {bad_spy} while {ticker} holds", "then": "Exit position — market context flipped", "action": "EXIT", "confidence": "medium"})

    # Best next step (≤15 words)
    if not vol_ok:
        best = f"Wait for volume-confirmed {'rejection' if is_bear else 'breakout'} candle before entry"
    elif action == "ENTER":
        best = f"Enter {'PUT' if is_bear else 'CALL'} — stop at ${stop:.2f}"
    else:
        best = f"Watch for {'ORL rejection' if is_bear else 'ORH breakout'} with volume"

    # Options note (≤30 words)
    if conf > 80 and vol_ok:
        opts = f"Confidence {conf} — naked {'PUT' if is_bear else 'CALL'} acceptable. "
    elif conf >= 60:
        opts = f"Confidence {conf} — {'PUT spread' if is_bear else 'CALL spread'} preferred over naked option. "
    else:
        opts = f"Confidence {conf} — WATCH only, no options entry yet. "

    if action == "WATCH":
        opts += "Theta risk rises if setup extends past midday without entry."
    elif action == "ENTER" and setup_type == "SPREAD":
        opts += f"Spread limits risk relative to naked option at this confidence level."

    return {
        "ticker":          ticker,
        "timestamp":       datetime.now(timezone.utc).isoformat(),
        "setup_type":      setup_type,
        "bias":            bias,
        "confidence":      conf,
        "action":          action,
        "risk":            risk,
        "market_context":  {
            "spy_alignment":    spy_aligns,
            "spy_note":         spy_note,
            "volume_confirmed": vol_ok,
            "relative_strength": relative_strength,
        },
        "summary":         summary,
        "entry_condition": entry_condition,
        "invalidation":    invalidation,
        "states": {
            "setup":   {"label": setup_lbl,   "detail": setup_detail, "key_levels": key_levels},
            "entry":   {"label": "EXECUTION GATE", "trigger": entry_trig, "price": entry_price},
            "in_play": {"label": inplay_lbl,  "target": scalp, "trail_level": trail_level, "add_condition": add_cond},
            "exit":    {"label": "COMPLETION / RESET", "stop_loss": stop, "exit_condition": exit_cond},
        },
        "decision_tree":   dt,
        "best_next_step":  best,
        "options_note":    opts,
        "_source":         "deterministic",
    }


# ── Main entry point ─────────────────────────────────────────────────────────────

def get_ai_coach(
    scan_dict:     dict[str, Any],
    risk_state:    str = "MEDIUM",
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Return the structured AI coaching result for a DayTradeScan.

    Pipeline:
    1. Build standardised signal dict from scan
    2. Check in-process cache (15 min TTL)
    3. If AI is enabled and an API key is present, call LLM
    4. Fall back to deterministic coach on any error / missing key
    5. Cache and return

    Parameters
    ----------
    scan_dict     Serialised DayTradeScan + resolved decision fields (plain dict).
    risk_state    Risk level string from resolved decision (LOW/MEDIUM/HIGH).
    force_refresh Bypass cache.
    """
    ticker        = str(scan_dict.get("ticker") or "")
    cache_key     = f"{ticker}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    ai_enabled    = os.getenv("AI_COACH_ENABLED", "true").lower() not in ("false", "0", "no")

    if not force_refresh:
        cached = _coach_cache.get(cache_key)
        if cached and (time.monotonic() - cached[0]) < COACH_CACHE_TTL:
            return cached[1]

    signal = build_coach_signal(scan_dict, risk_state)
    result: dict[str, Any] = {}

    if ai_enabled:
        # Try Anthropic first, then OpenAI, then deterministic
        if os.getenv("ANTHROPIC_API_KEY"):
            try:
                result = _call_anthropic(signal)
                result["_source"] = "anthropic"
                log.debug("AI coach: Anthropic succeeded for %s", ticker)
            except Exception as exc:  # noqa: BLE001
                log.warning("AI coach: Anthropic failed for %s — %s", ticker, exc)

        if not result and os.getenv("OPENAI_API_KEY"):
            try:
                result = _call_openai(signal)
                result["_source"] = "openai"
                log.debug("AI coach: OpenAI succeeded for %s", ticker)
            except Exception as exc:  # noqa: BLE001
                log.warning("AI coach: OpenAI failed for %s — %s", ticker, exc)

    if not result:
        result = build_deterministic_coach(signal)

    _coach_cache[cache_key] = (time.monotonic(), result)
    return result
