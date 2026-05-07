"""
JWT auth, password + Google Sign-In, activation and password reset.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from storage import (
    activate_with_token,
    consume_password_reset,
    get_user_auth_row,
    get_user_state,
    normalize_email,
    register_password_account,
    set_password_hash,
    set_password_reset_token,
    upsert_google_user,
)

auth_router = APIRouter(tags=["auth"])

JWT_ALG = "HS256"


def _jwt_secret() -> str:
    s = os.getenv("OPTION_ADVISOR_JWT_SECRET", "").strip()
    if s:
        return s
    if os.getenv("OPTION_ADVISOR_ALLOW_INSECURE_JWT", "").lower() in ("1", "true", "yes"):
        return "dev-insecure-optionadvisor-jwt"
    raise HTTPException(
        status_code=503,
        detail="Server missing OPTION_ADVISOR_JWT_SECRET (set it in .env or OPTION_ADVISOR_ALLOW_INSECURE_JWT=1 for local dev only).",
    )


def _jwt_days() -> int:
    try:
        return max(1, min(365, int(os.getenv("OPTION_ADVISOR_JWT_DAYS", "30"))))
    except ValueError:
        return 30


def _public_app_url() -> str:
    """SPA base for activation / password-reset links (same env resolution as `_option_advisor_public_base(None)`)."""
    from main import _option_advisor_public_base

    return _option_advisor_public_base(None)


def _google_client_id() -> str:
    return os.getenv("OPTION_ADVISOR_GOOGLE_CLIENT_ID", "").strip()


def _legacy_password_bind_allowed() -> bool:
    return os.getenv("OPTION_ADVISOR_LEGACY_PASSWORD_BIND", "true").lower() not in ("0", "false", "no")


def create_access_token(email: str) -> str:
    normalized = normalize_email(email)
    exp = datetime.now(timezone.utc) + timedelta(days=_jwt_days())
    payload = {"sub": normalized, "exp": exp}
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALG)


def decode_access_token(token: str) -> str:
    secret = _jwt_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALG])
        sub = payload.get("sub")
        if not sub or not isinstance(sub, str):
            raise HTTPException(status_code=401, detail="Invalid token")
        return normalize_email(sub)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired") from None
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail="Invalid token") from e


async def require_access_email(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    raw = authorization.split(" ", 1)[1].strip()
    if not raw:
        raise HTTPException(status_code=401, detail="Missing token")
    return decode_access_token(raw)


def ensure_same_user(token_email: str, claimed_email: str) -> None:
    if normalize_email(token_email) != normalize_email(claimed_email):
        raise HTTPException(status_code=403, detail="Forbidden")


def _hash_password(password: str) -> str:
    raw = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
    return raw.decode("utf-8")


def _check_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _password_rules(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")


def _deliver_html_email(to_email: str, to_name: str | None, subject: str, html: str) -> None:
    from main import _deliver_html_email

    _deliver_html_email(to_email, to_name, subject, html)


def _email_configured() -> bool:
    from main import _email_provider

    return _email_provider() != "none"


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=8)


def _login_payload(email: str) -> dict:
    state = get_user_state(email)
    auth = get_user_auth_row(email)
    display = ""
    if auth and auth.get("display_name"):
        display = str(auth["display_name"]).strip()
    if not display:
        display = email.split("@")[0]
    return {
        "access_token": create_access_token(email),
        "token_type": "bearer",
        "email": state["email"],
        "name": display,
        "role": state.get("role", "user"),
    }


@auth_router.post("/register")
def auth_register(req: RegisterRequest):
    _password_rules(req.password)
    normalized = normalize_email(req.email)
    if not normalized:
        raise HTTPException(status_code=400, detail="Valid email is required")
    name = (req.name or "").strip() or normalized.split("@")[0]

    email_ready = not _email_configured()
    activation_token: str | None = None
    activation_expires_ms: int | None = None
    if not email_ready:
        activation_token = secrets.token_urlsafe(32)
        activation_expires_ms = int(datetime.now(timezone.utc).timestamp() * 1000) + 48 * 60 * 60 * 1000

    try:
        register_password_account(
            normalized,
            name,
            _hash_password(req.password),
            email_verified=email_ready,
            activation_token=None if email_ready else activation_token,
            activation_expires_ms=None if email_ready else activation_expires_ms,
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="An account with this email already exists") from None

    if email_ready:
        return {"ok": True, "needs_activation": False, "message": "Account created. You can sign in now."}

    link = f"{_public_app_url()}/#activate?token={activation_token}"
    html = f"""<!DOCTYPE html><html><body style="font-family:system-ui;line-height:1.5;color:#0f172a;">
      <h2>Activate your OptionAdvisor account</h2>
      <p>Thanks for registering. Confirm your email to start using your account.</p>
      <p><a href="{link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Activate account</a></p>
      <p style="font-size:12px;color:#64748b;">If the button does not work, paste this link into your browser:<br/>{link}</p>
    </body></html>"""
    try:
        _deliver_html_email(normalized, name, "Activate your OptionAdvisor account", html)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Account created but confirmation email could not be sent ({e!s}). Configure SendGrid/SMTP or set OPTION_ADVISOR_PUBLIC_URL.",
        ) from e

    return {
        "ok": True,
        "needs_activation": True,
        "message": "Check your inbox for a confirmation link (valid 48 hours).",
    }


@auth_router.post("/login")
def auth_login(req: LoginRequest):
    normalized = normalize_email(req.email)
    if not normalized or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    row = get_user_auth_row(normalized)
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    ph = row.get("password_hash")
    if ph:
        if not _check_password(req.password, str(ph)):
            raise HTTPException(status_code=401, detail="Invalid email or password")
    else:
        if row.get("google_sub"):
            raise HTTPException(
                status_code=401,
                detail="This account uses Google sign-in. Use the Google button.",
            )
        if not _legacy_password_bind_allowed():
            raise HTTPException(
                status_code=403,
                detail="This account has no password yet. Use “Forgot password” or sign in with Google.",
            )
        _password_rules(req.password)
        set_password_hash(normalized, _hash_password(req.password))

    if not int(row.get("email_verified") or 0):
        raise HTTPException(
            status_code=403,
            detail="Email not verified yet. Check your inbox for the activation link.",
        )

    return _login_payload(normalized)


@auth_router.post("/google")
def auth_google(req: GoogleAuthRequest):
    cid = _google_client_id()
    if not cid:
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured (OPTION_ADVISOR_GOOGLE_CLIENT_ID).")

    try:
        payload = google_id_token.verify_oauth2_token(
            req.credential,
            google_requests.Request(),
            cid,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google credential: {e}") from e

    email = normalize_email(str(payload.get("email") or ""))
    if not email:
        raise HTTPException(status_code=401, detail="Google did not return an email address.")
    sub = str(payload.get("sub") or "")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid Google credential.")

    name = str(payload.get("name") or "").strip() or email.split("@")[0]
    try:
        upsert_google_user(email, sub, name)
    except ValueError as e:
        msg = str(e)
        if msg == "google_sub_conflict":
            raise HTTPException(status_code=409, detail="This Google account is already linked to another user.") from None
        raise HTTPException(status_code=409, detail="This email is already registered with a different sign-in method.") from None

    return _login_payload(email)


@auth_router.get("/activate")
def auth_activate(token: str):
    email = activate_with_token(token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired activation link.")
    return {"ok": True, "email": email, "message": "Your account is active. You can sign in."}


@auth_router.post("/forgot-password")
def auth_forgot_password(req: ForgotPasswordRequest):
    normalized = normalize_email(req.email)
    generic = {"ok": True, "message": "If an account exists for that email, you will receive reset instructions."}
    if not normalized:
        return generic

    row = get_user_auth_row(normalized)
    if not row or not row.get("password_hash"):
        return generic

    tok = secrets.token_urlsafe(32)
    exp_ms = int(datetime.now(timezone.utc).timestamp() * 1000) + 60 * 60 * 1000
    set_password_reset_token(normalized, tok, exp_ms)

    if not _email_configured():
        # Dev: allow reset without mail — return token in response (unsafe; only when email disabled)
        return {
            "ok": True,
            "message": "Email is not configured; use this reset token locally only.",
            "dev_reset_token": tok,
        }

    link = f"{_public_app_url()}/#reset-password?token={tok}"
    disp = str(row.get("display_name") or "").strip() or None
    html = f"""<!DOCTYPE html><html><body style="font-family:system-ui;line-height:1.5;color:#0f172a;">
      <h2>Reset your OptionAdvisor password</h2>
      <p>We received a request to reset the password for <strong>{normalized}</strong>.</p>
      <p><a href="{link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Choose a new password</a></p>
      <p style="font-size:12px;color:#64748b;">This link expires in one hour. If you did not ask for this, ignore this email.</p>
    </body></html>"""
    try:
        _deliver_html_email(normalized, disp, "Reset your OptionAdvisor password", html)
    except Exception:
        pass
    return generic


@auth_router.post("/reset-password")
def auth_reset_password(req: ResetPasswordRequest):
    _password_rules(req.password)
    em = consume_password_reset(req.token, _hash_password(req.password))
    if not em:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
    return {"ok": True, "message": "Password updated. You can sign in with your new password."}
