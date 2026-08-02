"""User AI Coach — per-user, user-supplied-key LLM coaching over the user's own trades.

Distinct from ai_coach.py (which uses a single global env-var key for the Day Trade
engine's deterministic summary). Here each user brings their own API key for one of
three providers (Anthropic Claude, OpenAI, or Google Gemini). The key is stored
per-user, write-only from the API's perspective (never returned to the client, never
logged), and used server-side to generate educational coaching for a given context
(open positions, closed-week review, a regular recommendation, or a day/swing setup).

This is an educational tool, not financial advice — the system prompt and the
returned copy make that explicit.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import storage
from auth_routes import require_access_email

user_ai_coach_router = APIRouter(tags=["user-ai-coach"])

PROVIDERS = {"claude", "openai", "gemini"}

# Sensible, capable defaults per provider. Users may override the model in
# settings — the exact ID that works depends on their own account/tier.
DEFAULT_MODELS = {
    "claude": "claude-opus-5",
    "openai": "gpt-5",
    "gemini": "gemini-2.5-pro",
}

PROVIDER_LABELS = {"claude": "Claude (Anthropic)", "openai": "OpenAI", "gemini": "Google Gemini"}

_MAX_TOKENS = 1600

SYSTEM_PROMPT = (
    "You are an experienced options-trading coach reviewing THIS trader's own trades and setups. "
    "Your job is education and process improvement, not stock tips. Be direct, specific, and concise. "
    "Focus on risk management, position sizing, discipline, entry/exit quality, and recurring mistakes. "
    "Ground every point in the data provided; do not invent numbers. "
    "Format your answer as tight Markdown: a one-line takeaway, then short bulleted sections. "
    "Keep it under ~250 words unless the data clearly warrants more. "
    "Close with a one-line reminder that this is educational analysis, not financial advice."
)

# Mode → task instruction prepended to the serialized context.
MODE_INSTRUCTIONS = {
    "positions_open": (
        "Review these OPEN positions. Flag the ones that need attention now (assignment, expiry/theta, "
        "stop breached, oversized). For each flagged position give a concrete management action "
        "(hold / roll / close / hedge / trim) and why. Lead with the single most urgent item."
    ),
    "positions_closed_week": (
        "Review these CLOSED trades for the week. Identify what went well, the recurring leaks/mistakes, "
        "and the 2-3 highest-leverage process changes for next week. Reference specific tickers/outcomes."
    ),
    "recommendation": (
        "Coach me on this options trade idea BEFORE I place it. Assess setup quality, risk/reward, "
        "position sizing vs. my buying power, and the top ways it can go wrong. End with a clear "
        "GO / WAIT / PASS and the single condition that would change your answer."
    ),
    "day_trade": (
        "Coach me on this day-trade setup. Judge the entry, stop, and target; state the real risk; and say "
        "whether to TAKE, WAIT, or PASS right now, with the trigger/invalidator that decides it."
    ),
    "swing_trade": (
        "Coach me on this swing-trade setup. Judge the thesis, entry, stop, and targets; state the risk and "
        "time horizon; and say whether to TAKE, WAIT, or PASS, with the condition that would change it."
    ),
}
_DEFAULT_INSTRUCTION = (
    "Review the following trading context and give focused, actionable coaching."
)


def _ensure_table() -> None:
    with storage._connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_ai_coach_settings (
                email      TEXT PRIMARY KEY,
                provider   TEXT NOT NULL,
                api_key    TEXT NOT NULL,
                model      TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


_ensure_table()


def _norm_email(email: str) -> str:
    return storage.normalize_email(email)


def _get_settings_row(email: str) -> Optional[dict[str, Any]]:
    with storage._connect() as conn:
        row = conn.execute(
            "SELECT provider, api_key, model FROM user_ai_coach_settings WHERE email = ?",
            (_norm_email(email),),
        ).fetchone()
    if row is None:
        return None
    return {"provider": row["provider"], "api_key": row["api_key"], "model": row["model"]}


# ── request/response models ──────────────────────────────────────────────────

class AICoachSettingsIn(BaseModel):
    provider: str
    apiKey: str
    model: Optional[str] = None


class AICoachAnalyzeIn(BaseModel):
    mode: str
    title: Optional[str] = None
    context: Any = None


# ── settings endpoints ───────────────────────────────────────────────────────

@user_ai_coach_router.get("/ai-coach/settings")
def get_ai_coach_settings(email: str = Depends(require_access_email)) -> dict[str, Any]:
    row = _get_settings_row(email)
    if not row:
        return {"configured": False, "provider": None, "model": None, "defaultModels": DEFAULT_MODELS}
    return {
        "configured": True,
        "provider": row["provider"],
        "model": row["model"] or DEFAULT_MODELS.get(row["provider"], ""),
        "hasKey": True,
        "defaultModels": DEFAULT_MODELS,
    }


@user_ai_coach_router.post("/ai-coach/settings")
def save_ai_coach_settings(body: AICoachSettingsIn, email: str = Depends(require_access_email)) -> dict[str, Any]:
    provider = (body.provider or "").strip().lower()
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider. Choose one of: {', '.join(sorted(PROVIDERS))}.")
    api_key = (body.apiKey or "").strip()
    if len(api_key) < 8:
        raise HTTPException(status_code=400, detail="Enter a valid API key.")
    model = (body.model or "").strip() or None
    with storage._connect() as conn:
        conn.execute(
            """
            INSERT INTO user_ai_coach_settings (email, provider, api_key, model, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
                provider = excluded.provider,
                api_key = excluded.api_key,
                model = excluded.model,
                updated_at = CURRENT_TIMESTAMP
            """,
            (_norm_email(email), provider, api_key, model),
        )
        conn.commit()
    return {"configured": True, "provider": provider, "model": model or DEFAULT_MODELS.get(provider, "")}


@user_ai_coach_router.delete("/ai-coach/settings")
def delete_ai_coach_settings(email: str = Depends(require_access_email)) -> dict[str, Any]:
    with storage._connect() as conn:
        conn.execute("DELETE FROM user_ai_coach_settings WHERE email = ?", (_norm_email(email),))
        conn.commit()
    return {"configured": False}


# ── provider callers ─────────────────────────────────────────────────────────

def _call_claude(api_key: str, model: str, user_prompt: str) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    parts = [block.text for block in resp.content if getattr(block, "type", None) == "text"]
    return "\n".join(p for p in parts if p).strip()


def _call_openai(api_key: str, model: str, user_prompt: str) -> str:
    import openai

    client = openai.OpenAI(api_key=api_key)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    try:
        resp = client.chat.completions.create(
            model=model, messages=messages, max_completion_tokens=_MAX_TOKENS,
        )
    except openai.BadRequestError:
        # Older models reject max_completion_tokens; fall back to max_tokens.
        resp = client.chat.completions.create(
            model=model, messages=messages, max_tokens=_MAX_TOKENS,
        )
    return (resp.choices[0].message.content or "").strip()


def _call_gemini(api_key: str, model: str, user_prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"maxOutputTokens": _MAX_TOKENS},
    }
    r = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
    if r.status_code >= 400:
        detail = ""
        try:
            detail = (r.json().get("error", {}) or {}).get("message", "")
        except Exception:
            detail = r.text[:200]
        raise RuntimeError(detail or f"Gemini returned HTTP {r.status_code}")
    data = r.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no content (possibly blocked by safety filters).")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "\n".join(str(p.get("text", "")) for p in parts).strip()


_CALLERS = {"claude": _call_claude, "openai": _call_openai, "gemini": _call_gemini}


def _build_prompt(body: AICoachAnalyzeIn) -> str:
    instruction = MODE_INSTRUCTIONS.get(body.mode, _DEFAULT_INSTRUCTION)
    try:
        ctx_json = json.dumps(body.context, indent=2, default=str)[:24000]
    except (TypeError, ValueError):
        ctx_json = str(body.context)[:24000]
    header = f"Context: {body.title}\n" if body.title else ""
    return f"{instruction}\n\n{header}Data (JSON):\n```json\n{ctx_json}\n```"


# ── analyze endpoint ─────────────────────────────────────────────────────────

@user_ai_coach_router.post("/ai-coach/analyze")
def analyze(body: AICoachAnalyzeIn, email: str = Depends(require_access_email)) -> dict[str, Any]:
    row = _get_settings_row(email)
    if not row:
        raise HTTPException(status_code=409, detail="AI Coach is not configured. Add an API key in Settings.")
    provider = row["provider"]
    model = (row["model"] or DEFAULT_MODELS.get(provider) or "").strip()
    if provider not in _CALLERS or not model:
        raise HTTPException(status_code=409, detail="AI Coach provider is misconfigured. Re-save it in Settings.")

    prompt = _build_prompt(body)
    try:
        text = _CALLERS[provider](row["api_key"], model, prompt)
    except HTTPException:
        raise
    except Exception as exc:  # provider/network/auth errors → surface a clean message
        msg = str(exc) or exc.__class__.__name__
        # Never echo the API key back, even if a library embeds it in the message.
        msg = msg.replace(row["api_key"], "***")
        raise HTTPException(status_code=502, detail=f"{PROVIDER_LABELS.get(provider, provider)} error: {msg[:400]}")

    if not text:
        raise HTTPException(status_code=502, detail="The AI Coach returned an empty response. Try again.")
    return {"markdown": text, "provider": provider, "model": model}
