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
You are an expert intraday options trading signal engine embedded in a professional platform.
Your strategy is Confluence Zone Trading. Analyze the signal and return structured JSON only.

CORE STRATEGY:
━━━━━━━━━━━━━━
CONFLUENCE DETECTION: Zone exists when ANY 2+ levels within $0.10 of each other:
  - VWAP, ORL (Opening Range Low), ORH (Opening Range High), prev_close
  - Strength: 2 levels = STRONG, 3+ levels = EXTREME, VWAP+ORL specifically = EXTREME

DIRECTIONAL BIAS:
  - Price BELOW confluence = zone is RESISTANCE → PUT bias
  - Price ABOVE confluence = zone is SUPPORT → CALL bias
  - Price AT confluence = CHOP → no trade

ENTRY TRIGGER (ALL THREE required):
  1. Price within $0.50 of confluence zone
  2. Rejection candle (PUT) or Bounce candle (CALL)
  3. RVOL > 1.2x at moment of candle
  (RVOL < 0.8x = no trade; 0.8-1.2x = watch; >1.2x = valid; >1.5x = high conviction)

BROKEN LEVEL RULE: ORL broken → ORL becomes resistance. VWAP declining below ORL = double resistance.

NO TRADE WHEN: daily_range_used_pct > 60 | RVOL < 0.8 | price in chop zone | R/R < 1:2 | entry missed

SPY ALIGNMENT: ticker bias matches SPY = +10 confidence; conflicts SPY = -15 confidence

OPTIONS RULES: confidence > 80 = naked ok; 60-80 = spread preferred; < 60 = watch only; R/R < 1:2 = AVOID

STRICT OUTPUT RULES:
- Return valid JSON only, no markdown, no explanation
- All price levels must be numbers
- Confidence: 0-100 integer
- bias: "bullish" | "bearish" | "neutral"
- action: "WATCH" | "ENTER" | "EXIT" | "HOLD" | "AVOID"
- setup_type: "CALL" | "PUT" | "SPREAD" | "NONE"
- risk: "LOW" | "MEDIUM" | "HIGH"

INPUT signal JSON fields:
  ticker, price, vwap, orh, orl, rvol, bias, confidence, action, risk,
  volume_confirmed, price_vs_vwap, price_vs_or, price_vs_orl, price_vs_orh,
  spy_bias, spy_vs_vwap, spy_vs_orh, session_phase, daily_range_used_pct,
  option_expiry_days, _bounce_scenario, _scalp_target, _risk_below

OUTPUT exactly this JSON structure:
{
  "ticker": string,
  "timestamp": ISO8601,
  "setup_type": "CALL" | "PUT" | "SPREAD" | "NONE",
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": number,
  "action": "WATCH" | "ENTER" | "EXIT" | "HOLD" | "AVOID",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "market_context": {
    "spy_alignment": boolean, "spy_note": string,
    "volume_confirmed": boolean, "relative_strength": "strong" | "weak" | "neutral"
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
  "confluence": {
    "detected": boolean,
    "zone_price": number,
    "levels_converging": [string],
    "strength": "EXTREME" | "STRONG" | "NONE",
    "zone_role": "RESISTANCE" | "SUPPORT" | "CHOP" | "NONE"
  },
  "entry_gate": {
    "valid": boolean,
    "trigger_price": number,
    "trigger_condition": string,
    "rvol_required": number,
    "candle_required": "rejection" | "bounce" | "breakout" | "none"
  },
  "trade": {
    "direction": "PUT" | "CALL" | "NONE",
    "entry_price": number,
    "target": number,
    "stop": number,
    "risk_reward": number,
    "r_r_valid": boolean
  },
  "no_trade_reason": string | null,
  "decision_tree": [
    { "if": string, "then": string, "action": "ENTER"|"WAIT"|"EXIT"|"AVOID", "confidence": "high"|"medium"|"low" }
  ],
  "best_next_step": string,
  "options_note": string
}
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

    # RVOL direct value
    rvol = float(metrics.get("rvol") or 1.0)

    # price_vs_orl / price_vs_orh (granular, separate from price_vs_or)
    _orl = float(eg.get("opening_range_low") or metrics.get("or_low") or 0)
    _orh = float(eg.get("opening_range_high") or metrics.get("or_high") or 0)
    _price = float(metrics.get("last_price") or 0)
    if _orl > 0 and abs(_price - _orl) / _orl * 100 <= 0.1:
        price_vs_orl = "at"
    elif _price < _orl:
        price_vs_orl = "below"
    else:
        price_vs_orl = "above"
    if _orh > 0 and abs(_price - _orh) / _orh * 100 <= 0.1:
        price_vs_orh = "at"
    elif _price > _orh:
        price_vs_orh = "above"
    else:
        price_vs_orh = "below"

    # session_phase (lowercase for prompt clarity)
    session_phase = str(metrics.get("session_phase") or "").lower()

    # daily_range_used_pct — use the ATR-based value already computed in day_trade.py.
    # The old formula (price - day_low) / (day_high - day_low) measured where price
    # sat within the session range, NOT how much of the typical daily range was consumed.
    # On any up-trending day it returned ~95-100% (price near session high) regardless
    # of actual range exhaustion — causing the AI coach to incorrectly warn "98% used"
    # while the banner correctly showed 54% of ATR.
    daily_range_used_pct = float(metrics.get("daily_range_used_pct") or 50.0)

    # option_expiry_days — days until next Friday (standard weekly)
    _now = datetime.now(timezone.utc)
    _dow = _now.weekday()   # 0=Mon, 4=Fri
    _days_to_fri = (4 - _dow) % 7
    option_expiry_days = max(1, _days_to_fri if _days_to_fri > 0 else 7)

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
        "_bounce_scenario":  str(metrics.get("bounce_scenario") or ""),
        "rvol":                  round(rvol, 2),
        "price_vs_orl":          price_vs_orl,
        "price_vs_orh":          price_vs_orh,
        "session_phase":         session_phase,
        "daily_range_used_pct":  daily_range_used_pct,
        "option_expiry_days":    option_expiry_days,
    }


# ── JSON validation ─────────────────────────────────────────────────────────────

_REQUIRED_KEYS = {
    "ticker", "timestamp", "setup_type", "bias", "confidence",
    "action", "risk", "market_context", "summary", "entry_condition",
    "invalidation", "states", "decision_tree", "best_next_step", "options_note",
}
_VALID_SETUP_TYPES = {"CALL", "PUT", "SPREAD", "NONE"}
_VALID_BIASES      = {"bullish", "bearish", "neutral"}
_VALID_ACTIONS     = {"WATCH", "ENTER", "EXIT", "HOLD", "AVOID"}
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

    # New confluence fields — optional, default to safe values if absent
    if "confluence" not in raw or not isinstance(raw.get("confluence"), dict):
        raw["confluence"] = {"detected": False, "zone_price": 0.0, "levels_converging": [],
                             "strength": "NONE", "zone_role": "NONE"}
    if "entry_gate" not in raw or not isinstance(raw.get("entry_gate"), dict):
        raw["entry_gate"] = {"valid": False, "trigger_price": 0.0,
                             "trigger_condition": "", "rvol_required": 1.2, "candle_required": "none"}
    if "trade" not in raw or not isinstance(raw.get("trade"), dict):
        raw["trade"] = {"direction": "NONE", "entry_price": 0.0, "target": 0.0,
                        "stop": 0.0, "risk_reward": 0.0, "r_r_valid": False}
    raw.setdefault("no_trade_reason", None)
    raw.setdefault("confluence_note", "")

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


# ── Confluence Zone helpers ──────────────────────────────────────────────────────

def _detect_confluence_zone(
    price: float, vwap: float, orh: float, orl: float,
    band: float = 0.10,
) -> dict:
    """Detect whether key intraday levels cluster within `band` dollars of each other."""
    named = {"VWAP": vwap, "ORL": orl, "ORH": orh}
    named = {k: v for k, v in named.items() if v > 0}
    if len(named) < 2:
        return {"detected": False, "zone_price": 0.0, "levels_converging": [],
                "strength": "NONE", "zone_role": "NONE"}

    converging: list[str] = []
    zone_prices: list[float] = []
    level_names = list(named.keys())
    for i in range(len(level_names)):
        for j in range(i + 1, len(level_names)):
            n1, n2 = level_names[i], level_names[j]
            if abs(named[n1] - named[n2]) <= band:
                if n1 not in converging:
                    converging.append(n1)
                if n2 not in converging:
                    converging.append(n2)
                zone_prices.append((named[n1] + named[n2]) / 2)

    if not converging:
        return {"detected": False, "zone_price": 0.0, "levels_converging": [],
                "strength": "NONE", "zone_role": "NONE"}

    zone_price = round(sum(zone_prices) / len(zone_prices), 2)

    # Strength: VWAP+ORL together = always EXTREME (highest conviction)
    if "VWAP" in converging and "ORL" in converging:
        strength = "EXTREME"
    elif len(converging) >= 3:
        strength = "EXTREME"
    else:
        strength = "STRONG"

    # Zone role based on price vs zone
    if price < zone_price * 0.9995:
        zone_role = "RESISTANCE"
    elif price > zone_price * 1.0005:
        zone_role = "SUPPORT"
    else:
        zone_role = "CHOP"

    return {
        "detected":          True,
        "zone_price":        zone_price,
        "levels_converging": converging,
        "strength":          strength,
        "zone_role":         zone_role,
    }


def _build_entry_gate(
    price: float, confluence: dict, rvol: float, vol_ok: bool,
) -> dict:
    """Validate whether entry conditions are currently met at the confluence zone."""
    if not confluence["detected"]:
        return {"valid": False, "trigger_price": 0.0,
                "trigger_condition": "No confluence zone — wait for level alignment",
                "rvol_required": 1.2, "candle_required": "none"}

    zone = confluence["zone_price"]
    zone_role = confluence["zone_role"]
    within_zone = abs(price - zone) <= 0.50
    rvol_ok = rvol >= 1.2

    if zone_role == "RESISTANCE":
        candle = "rejection"
        cond = f"Bounce to ${zone:.2f} rejection candle with RVOL > 1.2x"
    elif zone_role == "SUPPORT":
        candle = "bounce"
        cond = f"Pullback to ${zone:.2f} bounce candle with RVOL > 1.2x"
    else:
        candle = "none"
        cond = f"Price at chop zone ${zone:.2f} — wait for clear directional move"

    valid = within_zone and rvol_ok and vol_ok and zone_role != "CHOP"
    return {
        "valid":             valid,
        "trigger_price":     zone,
        "trigger_condition": cond,
        "rvol_required":     1.2,
        "candle_required":   candle,
    }


def _build_trade_levels(
    direction: str, entry_price: float, scalp_target: float,
    risk_below: float, orl: float, orh: float,
) -> dict:
    """Build trade entry/target/stop and compute R/R ratio."""
    if direction == "PUT":
        stop = round(risk_below, 2) if risk_below > entry_price else round(entry_price * 1.003, 2)
        target = round(scalp_target, 2) if scalp_target < entry_price else round(entry_price * 0.975, 2)
    elif direction == "CALL":
        stop = round(risk_below, 2) if risk_below < entry_price else round(entry_price * 0.997, 2)
        target = round(scalp_target, 2) if scalp_target > entry_price else round(entry_price * 1.025, 2)
    else:
        return {"direction": "NONE", "entry_price": 0.0, "target": 0.0,
                "stop": 0.0, "risk_reward": 0.0, "r_r_valid": False}

    risk   = abs(entry_price - stop)
    reward = abs(entry_price - target)
    rr     = round(reward / risk, 1) if risk > 0 else 0.0
    return {
        "direction":   direction,
        "entry_price": round(entry_price, 2),
        "target":      target,
        "stop":        stop,
        "risk_reward": rr,
        "r_r_valid":   rr >= 2.0,
    }


def _build_no_trade_reason(
    daily_range_used_pct: float, rvol: float, confluence: dict,
    trade: dict, price: float,
) -> "str | None":
    """Return a concise no-trade reason string, or None if conditions are met."""
    reasons: list[str] = []
    if daily_range_used_pct > 60:
        reasons.append(f"Daily range {daily_range_used_pct:.0f}% used")
    if rvol < 0.8:
        reasons.append(f"RVOL {rvol:.1f}x below threshold")
    if not confluence["detected"]:
        reasons.append("No confluence zone detected")
    elif confluence["zone_role"] == "CHOP":
        reasons.append("Price in chop zone")
    zone = confluence.get("zone_price") or 0
    if zone and abs(price - zone) > 2.0:
        reasons.append(f"Price ${abs(price - zone):.2f} away from entry zone")
    if trade.get("direction") != "NONE" and not trade.get("r_r_valid"):
        reasons.append(f"R/R {trade.get('risk_reward', 0):.1f}:1 below 2:1 minimum")
    return ". ".join(reasons) if reasons else None


# ── Deterministic fallback ───────────────────────────────────────────────────────

def build_deterministic_coach(signal: dict[str, Any]) -> dict[str, Any]:
    """
    Produce the full AiCoachResult structure using rule-based logic.
    Used when no LLM API key is configured, or as a fallback on API failure.
    Produces the identical JSON shape so the frontend works identically.
    """
    ticker           = signal.get("ticker", "")
    price            = float(signal.get("price") or 0)
    vwap             = float(signal.get("vwap") or 0)
    orh              = float(signal.get("orh") or 0)
    orl              = float(signal.get("orl") or 0)
    bias             = str(signal.get("bias") or "neutral")
    conf             = int(signal.get("confidence") or 50)
    risk             = str(signal.get("risk") or "MEDIUM")
    # Honour the engine verdict forwarded via signal["action"]:
    # NO-GO → "AVOID", WATCH/WAIT → "WATCH", GO/STRONG GO → "ENTER"
    engine_action    = str(signal.get("action") or "WATCH").upper()
    vol_ok = bool(signal.get("volume_confirmed"))
    pvv    = signal.get("price_vs_vwap", "below")
    pvo    = signal.get("price_vs_or",   "inside_or")
    spy_b  = signal.get("spy_bias", "neutral")
    rs     = float(signal.get("_rs_vs_qqq") or 0)
    scalp  = float(signal.get("_scalp_target") or 0)
    stop   = float(signal.get("_risk_below") or 0)
    bounce = str(signal.get("_bounce_scenario") or "")

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

    # Action — respect the engine's NO-GO verdict first, then derive locally
    if engine_action == "AVOID":
        action = "WATCH"   # surface as WATCH (no entry), summary will say NO TRADE
    elif not vol_ok or pvo == "inside_or":
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
    if engine_action == "AVOID" or bias == "neutral":
        # NO-GO verdict: entry trigger not met, market context contradicts bias
        or_range = f"{orl_str}–{orh_str}" if (orl and orh) else (orh_str if orh else orl_str)
        summary = (
            f"{ticker} VWAP {vwap_str}, OR range {or_range}. "
            f"No valid entry — OR not broken, {vol_txt}, market context unfavourable. "
            "No trade today."
        )
    elif is_bear:
        if bounce == "vwap_rejection" and pvo == "below_orl":
            # Price bounced after breakdown but sellers rejected it AT VWAP (never reached ORL)
            summary = (
                f"{ticker} bounce rejected at VWAP {vwap_str} after ORL breakdown — "
                f"sellers stepped in early. {vol_txt.capitalize()}. "
                f"PUT entry at {vwap_str}, stop above {vwap_str}, target ORL {orl_str}."
            )
        elif bounce == "orl_rejection_retest" and pvo == "below_orl":
            # Bounce reached ORL, got rejected — highest-conviction re-entry
            summary = (
                f"{ticker} bounce rejected at ORL {orl_str} — full retest complete, sellers hold. "
                f"{vol_txt.capitalize()}. "
                f"Strongest PUT re-entry: stop above {orl_str}, target below day low."
            )
        elif bounce == "no_mans_land" and pvo == "below_orl":
            summary = (
                f"{ticker} broke below ORL {orl_str} but price is churning between "
                f"VWAP {vwap_str} and ORL {orl_str}. No clean rejection level — wait."
            )
        elif bounce == "vwap_test" and pvo == "below_orl":
            summary = (
                f"{ticker} bouncing into VWAP {vwap_str} after ORL breakdown — "
                f"rejection not confirmed yet. {vol_txt.capitalize()}. "
                f"Wait for volume at VWAP before entering PUT."
            )
        elif vol_ok and pvo == "below_orl":
            summary = (
                f"{ticker} below VWAP {vwap_str} and ORL {orl_str}. Bearish bias, {vol_txt}. "
                "Breakdown active."
            )
        elif pvo == "below_orl":
            summary = (
                f"{ticker} broke below ORL {orl_str} — VWAP {vwap_str} now resistance. "
                f"Bearish bias, {vol_txt}. Wait for volume confirmation before entering PUT."
            )
        else:
            summary = (
                f"{ticker} below VWAP {vwap_str}, watching ORL {orl_str} breakdown. "
                f"Bearish bias, {vol_txt}. Wait for ORL break and hold to enter PUT."
            )
    else:  # bullish
        if vol_ok and pvo == "above_orh":
            summary = (
                f"{ticker} above VWAP {vwap_str} and ORH {orh_str}. Bullish bias, {vol_txt}. "
                "Breakout active."
            )
        elif pvo == "above_orh":
            summary = (
                f"{ticker} broke above ORH {orh_str} — VWAP {vwap_str} now support. "
                f"Bullish bias, {vol_txt}. Wait for volume confirmation before entering CALL."
            )
        else:
            # Price is inside OR (above VWAP but ORH not yet broken)
            summary = (
                f"{ticker} above VWAP {vwap_str}, watching ORH {orh_str} breakout. "
                f"Bullish bias, {vol_txt}. Wait for ORH break and hold to enter CALL."
            )

    # Entry condition (≤20 words) — bounce-scenario-aware
    if is_bear:
        if bounce == "vwap_rejection" and pvo == "below_orl":
            entry_condition = f"Rejection candle at VWAP {vwap_str} with volume spike — enter PUT"
        elif bounce == "orl_rejection_retest" and pvo == "below_orl":
            entry_condition = f"Rejection candle at ORL {orl_str} — highest conviction PUT entry"
        elif bounce == "no_mans_land" and pvo == "below_orl":
            entry_condition = f"Wait — price must reach VWAP {vwap_str} or ORL {orl_str} and reject"
        elif bounce == "vwap_test" and pvo == "below_orl":
            entry_condition = f"VWAP {vwap_str} failure + volume spike to confirm rejection"
        elif pvo != "below_orl":
            entry_condition = f"Bounce to {orl_str} then rejection candle with volume"
        else:
            entry_condition = f"Close and hold below {orl_str} with expanding volume"
    else:
        entry_condition = (
            f"Break above {orh_str} with volume-confirmed continuation candle"
            if pvo != "above_orh" else
            f"Close and hold above {orh_str} with expanding volume"
        )

    # Invalidation (≤15 words)
    if engine_action == "AVOID" or bias == "neutral":
        invalidation = f"Entry trigger not met — OR intact, low RVOL, unfavourable market"
    elif is_bear:
        if bounce == "vwap_rejection":
            invalidation = f"{ticker} reclaims VWAP {vwap_str} and holds — rejection failed"
        elif bounce == "orl_rejection_retest":
            invalidation = f"{ticker} reclaims ORL {orl_str} — setup invalidated"
        elif bounce == "no_mans_land":
            invalidation = f"No entry yet — wait for VWAP or ORL rejection"
        else:
            invalidation = f"{ticker} reclaims VWAP {vwap_str} on volume" if vwap else f"{ticker} closes above ORL"
    else:
        invalidation = f"{ticker} loses VWAP {vwap_str} on volume" if vwap else f"{ticker} closes below ORH"

    # State labels — bounce-scenario-aware
    if engine_action == "AVOID" or bias == "neutral":
        setup_lbl    = "NO TRADE — CONDITIONS NOT MET"
        setup_detail = f"OR not broken, volume absent, market context unfavourable — stand aside"
        entry_trig   = f"ORH {orh_str} break + volume + market tailwind required"
        inplay_lbl   = "NO ACTIVE TRADE"
        add_cond     = "No position to add — entry trigger never fired"
        exit_cond    = "N/A — no position"
    elif is_bear:
        if bounce == "vwap_rejection":
            setup_lbl    = "VWAP REJECTION SHORT"
            setup_detail = f"Bounce capped at VWAP {vwap_str} — sellers stepped in before ORL"
            entry_trig   = f"Rejection candle at VWAP {vwap_str} + volume spike"
            inplay_lbl   = "VWAP FADE ACTIVE"
            add_cond     = f"Add on break below {orl_str}" if orl else "Add on continuation below VWAP"
            exit_cond    = f"VWAP {vwap_str} reclaimed and held → cover immediately"
        elif bounce == "orl_rejection_retest":
            setup_lbl    = "ORL RETEST REJECTION"
            setup_detail = f"Full bounce to ORL {orl_str} rejected — strongest short re-entry"
            entry_trig   = f"Rejection candle at ORL {orl_str} + volume"
            inplay_lbl   = "RETEST SHORT ACTIVE"
            add_cond     = f"Add on new lows below session low"
            exit_cond    = f"ORL {orl_str} reclaimed → cover"
        elif bounce == "no_mans_land":
            setup_lbl    = "WAIT — NO CLEAN LEVEL"
            setup_detail = f"Price between VWAP {vwap_str} and ORL {orl_str} — no rejection yet"
            entry_trig   = f"Reach VWAP {vwap_str} or ORL {orl_str} with rejection candle + volume"
            inplay_lbl   = "NO ACTIVE TRADE"
            add_cond     = "No position — waiting for clean rejection level"
            exit_cond    = "N/A — no position"
        else:
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
    if engine_action == "AVOID" or bias == "neutral":
        # NO-GO tree: show what conditions would need to change to reconsider
        dt.append({"if": f"{ticker} breaks {orh_str} with 2× volume + market turns bullish",
                   "then": "Reconsider long setup — conditions still require confirmation",
                   "action": "WAIT", "confidence": "low"})
        dt.append({"if": f"RVOL stays below 0.75× through midday",
                   "then": "No trade — institutional participation absent all session",
                   "action": "AVOID", "confidence": "high"})
        dt.append({"if": f"Market (SPY/QQQ) remains bearish",
                   "then": "Stand aside — market context overrides bullish VWAP lean",
                   "action": "AVOID", "confidence": "high"})
    elif is_bear:
        if bounce == "vwap_rejection":
            dt.append({"if": f"{ticker} rejection candle at VWAP {vwap_str} with volume spike",
                       "then": f"Enter PUT — stop above {vwap_str}, target ORL {orl_str}",
                       "action": "ENTER", "confidence": "high"})
            dt.append({"if": f"{ticker} reclaims VWAP {vwap_str} and holds 1 bar",
                       "then": "Rejection failed — exit any position immediately",
                       "action": "AVOID", "confidence": "high"})
            dt.append({"if": f"{ticker} fades below ${scalp:.2f} without VWAP reclaim",
                       "then": "Breakdown continuation — hold and trail stop", "action": "WAIT", "confidence": "medium"})
        elif bounce == "orl_rejection_retest":
            dt.append({"if": f"{ticker} rejection candle at ORL {orl_str} with volume",
                       "then": f"Enter PUT — stop above {orl_str}, target new session low",
                       "action": "ENTER", "confidence": "high"})
            dt.append({"if": f"{ticker} reclaims ORL {orl_str}",
                       "then": "Setup invalidated — no trade", "action": "AVOID", "confidence": "high"})
            dt.append({"if": f"{ticker} immediately breaks to new lows without retest",
                       "then": "Missed the entry — do not chase", "action": "WAIT", "confidence": "high"})
        elif bounce == "no_mans_land":
            dt.append({"if": f"{ticker} reaches VWAP {vwap_str} with rejection candle + volume",
                       "then": f"Enter PUT at VWAP — stop above {vwap_str}, target {orl_str}",
                       "action": "ENTER", "confidence": "medium"})
            dt.append({"if": f"{ticker} reaches ORL {orl_str} with rejection candle + volume",
                       "then": f"Enter PUT at ORL — strongest entry, stop above {orl_str}",
                       "action": "ENTER", "confidence": "high"})
            dt.append({"if": f"Price chops in no-man's land without reaching either level",
                       "then": "Stand aside — no clean stop available in the middle",
                       "action": "WAIT", "confidence": "high"})
        else:
            dt.append({"if": f"{ticker} rejects at {orl_str} with volume", "then": f"Enter PUT, target ${scalp:.2f}", "action": "ENTER", "confidence": "high"})
            dt.append({"if": f"{ticker} reclaims VWAP {vwap_str}", "then": "Short thesis invalidated — no trade", "action": "AVOID", "confidence": "high"})
            dt.append({"if": f"{ticker} drops below ${price * 0.98:.2f} without bounce", "then": "Missed entry — do not chase", "action": "WAIT", "confidence": "high"})
    else:
        dt.append({"if": f"{ticker} breaks above {orh_str} with volume", "then": f"Enter CALL, target ${scalp:.2f}", "action": "ENTER", "confidence": "high"})
        dt.append({"if": f"{ticker} loses VWAP {vwap_str}", "then": "Long thesis invalidated — no trade", "action": "AVOID", "confidence": "high"})
        dt.append({"if": f"{ticker} extends to ${price * 1.02:.2f} without pullback", "then": "Missed entry — do not chase", "action": "WAIT", "confidence": "high"})
    if not (engine_action == "AVOID" or bias == "neutral") and not spy_aligns and spy_b != "neutral":
        bad_spy = "bearish" if is_bull else "bullish"
        dt.append({"if": f"SPY reverses {bad_spy} while {ticker} holds", "then": "Exit position — market context flipped", "action": "EXIT", "confidence": "medium"})

    # Best next step (≤15 words)
    if engine_action == "AVOID" or bias == "neutral":
        best = "No trade — OR not broken, RVOL weak, market unfavourable. Stand aside."
    elif is_bear and bounce == "vwap_rejection":
        best = f"VWAP rejection confirmed — enter PUT, stop above {vwap_str}, target ORL {orl_str}"
    elif is_bear and bounce == "orl_rejection_retest":
        best = f"ORL retest rejection — enter PUT, tight stop above {orl_str}, bigger target"
    elif is_bear and bounce == "no_mans_land":
        best = f"Wait — price below both VWAP and ORL. No trade until bounce reaches a key level."
    elif is_bear and bounce == "vwap_test":
        best = f"Bouncing toward VWAP {vwap_str} — wait for rejection candle + volume spike"
    elif not vol_ok:
        best = f"Wait for volume-confirmed {'rejection' if is_bear else 'breakout'} candle before entry"
    elif action == "ENTER":
        best = f"Enter {'PUT' if is_bear else 'CALL'} — stop at ${stop:.2f}"
    else:
        best = f"Watch for {'ORL rejection' if is_bear else 'ORH breakout'} with volume"

    # Options note (≤30 words)
    if engine_action == "AVOID" or bias == "neutral":
        opts = "No options position — entry conditions not met. Preserve capital, no theta risk to manage."
    elif conf > 80 and vol_ok:
        opts = f"Confidence {conf} — naked {'PUT' if is_bear else 'CALL'} acceptable. "
    elif conf >= 60:
        opts = f"Confidence {conf} — {'PUT spread' if is_bear else 'CALL spread'} preferred over naked option. "
    else:
        opts = f"Confidence {conf} — WATCH only, no options entry yet. "

    if action == "WATCH" and not (engine_action == "AVOID" or bias == "neutral"):
        opts += "Theta risk rises if setup extends past midday without entry."
    elif action == "ENTER" and setup_type == "SPREAD":
        opts += f"Spread limits risk relative to naked option at this confidence level."

    # ── Confluence Zone extensions ───────────────────────────────────────────
    _rvol          = float(signal.get("rvol") or 1.0)
    _drp           = float(signal.get("daily_range_used_pct") or 50.0)
    _confluence    = _detect_confluence_zone(price, vwap, orh, orl)
    _entry_gate    = _build_entry_gate(price, _confluence, _rvol, vol_ok)
    _trade_dir     = "PUT" if is_bear else ("CALL" if is_bull else "NONE")
    _entry_px      = price  # use current price as entry reference
    _trade         = _build_trade_levels(_trade_dir, _entry_px, scalp, stop, orl, orh)
    _no_trade      = _build_no_trade_reason(_drp, _rvol, _confluence, _trade, price)

    # Confluence note (≤20 words)
    if _confluence["detected"]:
        lvls = " + ".join(_confluence["levels_converging"])
        _conf_note = (
            f"{lvls} within $0.10 at ${_confluence['zone_price']:.2f} — "
            f"{_confluence['strength'].lower()} {_confluence['zone_role'].lower()} zone"
        )
    else:
        _conf_note = "No confluence zone detected — levels spread apart"

    # Boost confidence if confluence at entry zone
    if _confluence["detected"] and _entry_gate["valid"]:
        conf = min(100, conf + 8)

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
        "confluence":      _confluence,
        "entry_gate":      _entry_gate,
        "trade":           _trade,
        "no_trade_reason": _no_trade,
        "confluence_note": _conf_note,
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
