"""
SQLite persistence for per-user watchlist and portfolio state.
"""
import json
import math
import os
import sqlite3
import time
import uuid
from datetime import datetime
from typing import Any, Optional
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


DEFAULT_DB_PATH = Path(__file__).with_name("option_advisor.sqlite3")
DB_PATH = Path(os.getenv("OPTION_ADVISOR_DB_PATH", str(DEFAULT_DB_PATH))).expanduser()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _migrate_user_state_role_column(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "role" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"
        )


def _migrate_user_state_auth_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    specs: list[tuple[str, str]] = [
        ("password_hash", "TEXT"),
        ("display_name", "TEXT"),
        ("google_sub", "TEXT"),
        ("email_verified", "INTEGER NOT NULL DEFAULT 0"),
        ("activation_token", "TEXT"),
        ("activation_expires_ms", "INTEGER"),
        ("reset_token", "TEXT"),
        ("reset_expires_ms", "INTEGER"),
    ]
    for name, decl in specs:
        if name not in cols:
            conn.execute(f"ALTER TABLE user_state ADD COLUMN {name} {decl}")
    # Pre-auth SQLite rows: no password / OAuth — treat as verified so JWT login can bind a password once.
    conn.execute(
        """
        UPDATE user_state
        SET email_verified = 1
        WHERE password_hash IS NULL AND google_sub IS NULL AND IFNULL(email_verified, 0) = 0
        """
    )


def _migrate_user_state_advisory_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "advisory_terms_version" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN advisory_terms_version TEXT"
        )
    if "advisory_accepted_at" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN advisory_accepted_at TEXT"
        )


def _migrate_user_state_day_trade_watchlist(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "day_trade_watchlist_json" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN day_trade_watchlist_json TEXT NOT NULL DEFAULT '[]'"
        )


def _migrate_user_state_swing_trade_watchlist(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "swing_trade_watchlist_json" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN swing_trade_watchlist_json TEXT NOT NULL DEFAULT '[]'"
        )


def _migrate_user_state_alert_email_enabled(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "alert_email_enabled" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN alert_email_enabled INTEGER NOT NULL DEFAULT 1"
        )


def _migrate_active_trades_option_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(active_trades)").fetchall()}
    if "strike" not in cols:
        conn.execute("ALTER TABLE active_trades ADD COLUMN strike REAL")
    if "option_expiry" not in cols:
        conn.execute("ALTER TABLE active_trades ADD COLUMN option_expiry TEXT")


def _normalize_option_expiry(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()[:10]
    if not s:
        return None
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        raise ValueError("expiry must be YYYY-MM-DD")
    y_str, m_str, d_str = s.split("-")
    if not (y_str.isdigit() and m_str.isdigit() and d_str.isdigit()):
        raise ValueError("expiry must be YYYY-MM-DD")
    y, mo, d = int(y_str), int(m_str), int(d_str)
    if y < 1990 or y > 2100 or mo < 1 or mo > 12 or d < 1 or d > 31:
        raise ValueError("expiry must be a valid calendar date")
    return s


def _normalize_strike(raw: Optional[float]) -> Optional[float]:
    if raw is None:
        return None
    v = float(raw)
    if not math.isfinite(v) or v <= 0:
        raise ValueError("strike must be a positive number")
    return v


def effective_user_role(email: str, stored_role: Optional[str]) -> str:
    """
    Resolve role from SQLite user_state.role (admin | finance | user).

    Admin is database-only: set user_state.role = 'admin' for that user's email
    (Auto Trade / Execute Paper Trade require admin).

    OPTION_ADVISOR_FINANCE_EMAILS (comma-separated) may promote accounts from
    default user → finance when DB role is still user (optional org-wide policy).
    Finance env never overrides admin.
    """
    load_dotenv(Path(__file__).with_name(".env"), override=False)
    r = (stored_role or "user").strip().lower()
    if r == "admin":
        return "admin"
    if r == "finance":
        return "finance"
    if r not in ("user", ""):
        return "user"
    n = normalize_email(email)
    finance = {
        normalize_email(x.strip())
        for x in os.getenv("OPTION_ADVISOR_FINANCE_EMAILS", "").split(",")
        if x.strip()
    }
    if n in finance:
        return "finance"
    return "user"


def watchlist_limit_for_role(role: str) -> int:
    """
    Max watchlist tickers per account. Configurable via .env:

    OPTION_ADVISOR_WATCHLIST_MAX_USER — default users and finance role (default 15)
    OPTION_ADVISOR_WATCHLIST_MAX_ADMIN — administrators only (default 30)

    Minimum enforced value is 1.
    """
    try:
        user_max = int(os.getenv("OPTION_ADVISOR_WATCHLIST_MAX_USER", "15"))
    except ValueError:
        user_max = 15
    try:
        admin_max = int(os.getenv("OPTION_ADVISOR_WATCHLIST_MAX_ADMIN", "30"))
    except ValueError:
        admin_max = 30
    user_max = max(1, user_max)
    admin_max = max(1, admin_max)
    if (role or "").strip().lower() == "admin":
        return admin_max
    return user_max


def _state_with_watchlist_max(state: dict[str, Any]) -> dict[str, Any]:
    out = dict(state)
    out["watchlist_max"] = watchlist_limit_for_role(str(out.get("role") or "user"))
    return out


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_state (
                email TEXT PRIMARY KEY,
                watchlist_json TEXT NOT NULL DEFAULT '[]',
                portfolio_json TEXT NOT NULL DEFAULT '[]',
                role TEXT NOT NULL DEFAULT 'user',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _migrate_user_state_role_column(conn)
        _migrate_user_state_auth_columns(conn)
        _migrate_user_state_advisory_columns(conn)
        _migrate_user_state_day_trade_watchlist(conn)
        _migrate_user_state_swing_trade_watchlist(conn)
        _migrate_user_state_alert_email_enabled(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_alerts (
                email TEXT NOT NULL,
                alert_id TEXT NOT NULL,
                alert_json TEXT NOT NULL,
                detected_at INTEGER NOT NULL,
                dismissed INTEGER NOT NULL DEFAULT 0,
                email_sent INTEGER NOT NULL DEFAULT 0,
                email_message TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (email, alert_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS iv_atm_snapshots (
                ticker TEXT NOT NULL,
                session_date TEXT NOT NULL,
                iv_pct REAL NOT NULL,
                recorded_at INTEGER NOT NULL,
                PRIMARY KEY (ticker, session_date)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS day_trade_watchlist_last (
                email TEXT NOT NULL,
                ticker TEXT NOT NULL,
                verdict TEXT NOT NULL,
                session_date TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (email, ticker)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS day_trade_alert_events (
                email TEXT NOT NULL,
                alert_id TEXT NOT NULL,
                alert_json TEXT NOT NULL,
                detected_at INTEGER NOT NULL,
                email_sent INTEGER NOT NULL DEFAULT 0,
                email_message TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (email, alert_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS active_trades (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                ticker TEXT NOT NULL,
                side TEXT NOT NULL,
                entry_price REAL NOT NULL,
                entry_underlying_px REAL,
                contracts REAL,
                strike REAL,
                option_expiry TEXT,
                notes TEXT,
                opened_at_ms INTEGER NOT NULL,
                exited_at_ms INTEGER,
                raw_json TEXT
            )
            """
        )
        _migrate_active_trades_option_columns(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_active_trades_email_exit ON active_trades(email, exited_at_ms)"
        )


def upsert_iv_atm_snapshot(ticker: str, session_date: str, iv_pct: float) -> None:
    """Store one ATM-implied-vol snapshot per ticker per US session date (for IV Rank)."""
    t = ticker.upper().strip()
    if not t:
        return
    d = session_date.strip()[:10]
    now_ms = int(time.time() * 1000)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO iv_atm_snapshots (ticker, session_date, iv_pct, recorded_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(ticker, session_date) DO UPDATE SET
              iv_pct = excluded.iv_pct,
              recorded_at = excluded.recorded_at
            """,
            (t, d, float(iv_pct), now_ms),
        )


def fetch_iv_atm_history_strict_before(ticker: str, before_session_date: str, limit: int = 380) -> list[float]:
    """
    Past ATM IV readings strictly before calendar date ``before_session_date`` (YYYY-MM-DD).
    Used for broker-style IV Rank (52-week implied vol range). Newest sessions first.
    """
    t = ticker.upper().strip()
    if not t:
        return []
    bd = before_session_date.strip()[:10]
    lim = max(1, min(int(limit), 500))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT iv_pct FROM iv_atm_snapshots
            WHERE ticker = ? AND session_date < ?
            ORDER BY session_date DESC
            LIMIT ?
            """,
            (t, bd, lim),
        ).fetchall()
    return [float(row[0]) for row in rows]


def _normalize_day_trade_tickers(raw: object) -> list[str]:
    """Up to 10 unique US-style tickers."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for x in raw:
        t = str(x).strip().upper()
        if not t or len(t) > 12 or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 10:
            break
    return out


def get_user_state(email: str) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not normalized:
        return _state_with_watchlist_max(
            {
                "email": "",
                "role": "user",
                "watchlist": [],
                "portfolio": [],
                "day_trade_watchlist": [],
                "swing_trade_watchlist": [],
                "advisory_terms_version": None,
                "advisory_accepted_at": None,
                "alert_email_enabled": True,
            }
        )

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json, role,
                   advisory_terms_version, advisory_accepted_at,
                   day_trade_watchlist_json, swing_trade_watchlist_json, alert_email_enabled
            FROM user_state
            WHERE email = ?
            """,
            (normalized,),
        ).fetchone()

    if row is None:
        return _state_with_watchlist_max(
            {
                "email": normalized,
                "role": effective_user_role(normalized, None),
                "watchlist": [],
                "portfolio": [],
                "day_trade_watchlist": [],
                "swing_trade_watchlist": [],
                "advisory_terms_version": None,
                "advisory_accepted_at": None,
                "alert_email_enabled": True,
            }
        )

    stored_role = str(row["role"]) if row["role"] is not None else "user"
    try:
        dt_json = row["day_trade_watchlist_json"]
    except (KeyError, IndexError):
        dt_json = "[]"
    dt_list = _normalize_day_trade_tickers(json.loads(dt_json) if dt_json else [])
    try:
        sw_json = row["swing_trade_watchlist_json"]
    except (KeyError, IndexError):
        sw_json = "[]"
    sw_list = _normalize_day_trade_tickers(json.loads(sw_json) if sw_json else [])
    try:
        ae_raw = row["alert_email_enabled"]
        alert_email_enabled = bool(int(ae_raw)) if ae_raw is not None else True
    except (KeyError, IndexError, TypeError, ValueError):
        alert_email_enabled = True
    return _state_with_watchlist_max(
        {
            "email": row["email"],
            "role": effective_user_role(normalized, stored_role),
            "watchlist": json.loads(row["watchlist_json"]),
            "portfolio": json.loads(row["portfolio_json"]),
            "day_trade_watchlist": dt_list,
            "swing_trade_watchlist": sw_list,
            "advisory_terms_version": row["advisory_terms_version"],
            "advisory_accepted_at": row["advisory_accepted_at"],
            "alert_email_enabled": alert_email_enabled,
        }
    )


def list_user_states() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json, role,
                   day_trade_watchlist_json, swing_trade_watchlist_json, alert_email_enabled
            FROM user_state
            ORDER BY updated_at DESC
            """
        ).fetchall()

    def _alert_email_cell(r: sqlite3.Row) -> bool:
        try:
            v = r["alert_email_enabled"]
            return bool(int(v)) if v is not None else True
        except (KeyError, IndexError, TypeError, ValueError):
            return True

    return [
        {
            "email": row["email"],
            "role": effective_user_role(row["email"], str(row["role"]) if row["role"] is not None else None),
            "watchlist": json.loads(row["watchlist_json"]),
            "portfolio": json.loads(row["portfolio_json"]),
            "day_trade_watchlist": _normalize_day_trade_tickers(
                json.loads(row["day_trade_watchlist_json"] or "[]"),
            ),
            "swing_trade_watchlist": _normalize_day_trade_tickers(
                json.loads(row["swing_trade_watchlist_json"] or "[]"),
            ),
            "alert_email_enabled": _alert_email_cell(row),
        }
        for row in rows
    ]


def save_user_state(
    email: str,
    watchlist: list[dict[str, Any]],
    portfolio: list[dict[str, Any]],
    *,
    advisory_terms_version: Optional[str] = None,
    advisory_accepted_at: Optional[str] = None,
    day_trade_watchlist: Optional[list[str]] = None,
    swing_trade_watchlist: Optional[list[str]] = None,
    alert_email_enabled: Optional[bool] = None,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    preview = get_user_state(normalized)
    lim = watchlist_limit_for_role(str(preview.get("role") or "user"))
    if len(watchlist) > lim:
        raise ValueError(f"watchlist_limit:{lim}")
    if day_trade_watchlist is not None:
        dt_normalized = _normalize_day_trade_tickers(day_trade_watchlist)
    else:
        dt_normalized = _normalize_day_trade_tickers(preview.get("day_trade_watchlist"))
    if swing_trade_watchlist is not None:
        sw_normalized = _normalize_day_trade_tickers(swing_trade_watchlist)
    else:
        sw_normalized = _normalize_day_trade_tickers(preview.get("swing_trade_watchlist"))
    ae = bool(preview.get("alert_email_enabled", True))
    if alert_email_enabled is not None:
        ae = bool(alert_email_enabled)

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_state (
                email, watchlist_json, portfolio_json, role,
                advisory_terms_version, advisory_accepted_at,
                day_trade_watchlist_json, swing_trade_watchlist_json, alert_email_enabled, updated_at
            )
            VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
                watchlist_json = excluded.watchlist_json,
                portfolio_json = excluded.portfolio_json,
                advisory_terms_version = COALESCE(
                    excluded.advisory_terms_version,
                    user_state.advisory_terms_version
                ),
                advisory_accepted_at = COALESCE(
                    excluded.advisory_accepted_at,
                    user_state.advisory_accepted_at
                ),
                day_trade_watchlist_json = excluded.day_trade_watchlist_json,
                swing_trade_watchlist_json = excluded.swing_trade_watchlist_json,
                alert_email_enabled = excluded.alert_email_enabled,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                normalized,
                json.dumps(watchlist),
                json.dumps(portfolio),
                advisory_terms_version,
                advisory_accepted_at,
                json.dumps(dt_normalized),
                json.dumps(sw_normalized),
                1 if ae else 0,
            ),
        )

    return get_user_state(normalized)


DAY_TRADE_ALERT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000


def upsert_day_trade_watchlist_last(
    email: str,
    ticker: str,
    verdict: str,
    session_date: str,
) -> None:
    normalized = normalize_email(email)
    t = ticker.upper().strip()
    if not normalized or not t:
        return
    now_ms = int(time.time() * 1000)
    sd = (session_date or "").strip()[:10]
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO day_trade_watchlist_last (email, ticker, verdict, session_date, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(email, ticker) DO UPDATE SET
                verdict = excluded.verdict,
                session_date = excluded.session_date,
                updated_at = excluded.updated_at
            """,
            (normalized, t, verdict.strip().upper(), sd, now_ms),
        )


def get_day_trade_watchlist_last(email: str, ticker: str) -> Optional[dict[str, Any]]:
    normalized = normalize_email(email)
    t = ticker.upper().strip()
    if not normalized or not t:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT verdict, session_date, updated_at
            FROM day_trade_watchlist_last
            WHERE email = ? AND ticker = ?
            """,
            (normalized, t),
        ).fetchone()
    if not row:
        return None
    return {
        "verdict": row["verdict"],
        "session_date": row["session_date"] or "",
        "updated_at": int(row["updated_at"]),
    }


def add_day_trade_alert_event(email: str, alert: dict[str, Any]) -> None:
    """Insert or replace one day-trade escalation event (audit + UI)."""
    normalized = normalize_email(email)
    aid = str(alert["id"])
    detected = int(alert["detectedAt"])
    sent = bool(alert.get("emailSent"))
    msg = str(alert.get("emailMessage", "") or "")
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO day_trade_alert_events (
                email, alert_id, alert_json, detected_at, email_sent, email_message
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email, alert_id) DO UPDATE SET
                alert_json = excluded.alert_json,
                email_sent = excluded.email_sent,
                email_message = excluded.email_message
            """,
            (normalized, aid, json.dumps(alert), detected, 1 if sent else 0, msg),
        )


def list_day_trade_alert_events(email: str, retention_ms: int, now_ms: int) -> list[dict[str, Any]]:
    normalized = normalize_email(email)
    cutoff = now_ms - retention_ms
    with _connect() as conn:
        conn.execute(
            "DELETE FROM day_trade_alert_events WHERE email = ? AND detected_at < ?",
            (normalized, cutoff),
        )
        rows = conn.execute(
            """
            SELECT alert_json, email_sent, email_message
            FROM day_trade_alert_events
            WHERE email = ?
            ORDER BY detected_at DESC
            LIMIT 500
            """,
            (normalized,),
        ).fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        d = json.loads(row["alert_json"])
        d["emailSent"] = bool(row["email_sent"])
        d["emailMessage"] = row["email_message"]
        out.append(d)
    return out


def add_user_alert(email: str, alert: dict[str, Any], email_sent: bool, email_message: str = "") -> bool:
    normalized = normalize_email(email)
    alert_id = str(alert["id"])
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO user_alerts (
                email, alert_id, alert_json, detected_at, dismissed, email_sent, email_message
            )
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """,
            (
                normalized,
                alert_id,
                json.dumps(alert),
                int(alert["detectedAt"]),
                1 if email_sent else 0,
                email_message,
            ),
        )
        return cur.rowcount > 0


def update_user_alert_email(email: str, alert_id: str, email_sent: bool, email_message: str = "") -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            """
            UPDATE user_alerts
            SET email_sent = ?, email_message = ?
            WHERE email = ? AND alert_id = ?
            """,
            (1 if email_sent else 0, email_message, normalized, alert_id),
        )


def get_user_alerts(email: str, retention_ms: int, now_ms: int) -> list[dict[str, Any]]:
    normalized = normalize_email(email)
    cutoff = now_ms - retention_ms
    with _connect() as conn:
        conn.execute(
            "DELETE FROM user_alerts WHERE email = ? AND detected_at < ?",
            (normalized, cutoff),
        )
        rows = conn.execute(
            """
            SELECT alert_json, dismissed, email_sent, email_message
            FROM user_alerts
            WHERE email = ?
            ORDER BY detected_at DESC
            """,
            (normalized,),
        ).fetchall()

    alerts: list[dict[str, Any]] = []
    for row in rows:
        alert = json.loads(row["alert_json"])
        alert["dismissed"] = bool(row["dismissed"])
        alert["emailSent"] = bool(row["email_sent"])
        alert["emailMessage"] = row["email_message"]
        alerts.append(alert)
    return alerts


def dismiss_user_alert(email: str, alert_id: str) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            "UPDATE user_alerts SET dismissed = 1 WHERE email = ? AND alert_id = ?",
            (normalized, alert_id),
        )


def clear_user_alerts(email: str) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute("DELETE FROM user_alerts WHERE email = ?", (normalized,))


# ─────────────────────────────────────────────────────────────
# AUTH (password hash, Google sub, activation / reset tokens)
# ─────────────────────────────────────────────────────────────


def get_user_auth_row(email: str) -> dict[str, Any] | None:
    normalized = normalize_email(email)
    if not normalized:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email, password_hash, display_name, google_sub, email_verified,
                   activation_token, activation_expires_ms, reset_token, reset_expires_ms
            FROM user_state
            WHERE email = ?
            """,
            (normalized,),
        ).fetchone()
    return dict(row) if row else None


def register_password_account(
    email: str,
    display_name: str,
    password_hash: str,
    *,
    email_verified: bool,
    activation_token: str | None,
    activation_expires_ms: int | None,
) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        row = conn.execute(
            "SELECT password_hash FROM user_state WHERE email = ?",
            (normalized,),
        ).fetchone()
        if row and row["password_hash"]:
            raise ValueError("already_registered")
        ev = 1 if email_verified else 0
        if row:
            conn.execute(
                """
                UPDATE user_state SET
                    password_hash = ?,
                    display_name = ?,
                    email_verified = ?,
                    activation_token = ?,
                    activation_expires_ms = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE email = ?
                """,
                (password_hash, display_name, ev, activation_token, activation_expires_ms, normalized),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_state (
                    email, watchlist_json, portfolio_json, role,
                    password_hash, display_name, email_verified,
                    activation_token, activation_expires_ms, updated_at
                ) VALUES (?, '[]', '[]', 'user', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (normalized, password_hash, display_name, ev, activation_token, activation_expires_ms),
            )


def set_password_hash(email: str, password_hash: str) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            """
            UPDATE user_state SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
            """,
            (password_hash, normalized),
        )


def activate_with_token(token: str) -> str | None:
    if not token.strip():
        return None
    now = int(time.time() * 1000)
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email FROM user_state
            WHERE activation_token = ?
              AND (activation_expires_ms IS NULL OR activation_expires_ms > ?)
            """,
            (token.strip(), now),
        ).fetchone()
        if not row:
            return None
        em = str(row["email"])
        conn.execute(
            """
            UPDATE user_state SET
                email_verified = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
            """,
            (em,),
        )
        return em


def upsert_google_user(email: str, google_sub: str, display_name: str) -> None:
    normalized = normalize_email(email)
    sub = google_sub.strip()
    if not normalized or not sub:
        raise ValueError("invalid_google_identity")
    with _connect() as conn:
        clash = conn.execute(
            "SELECT email FROM user_state WHERE google_sub = ? AND email <> ?",
            (sub, normalized),
        ).fetchone()
        if clash:
            raise ValueError("google_sub_conflict")
        row = conn.execute(
            "SELECT google_sub FROM user_state WHERE email = ?",
            (normalized,),
        ).fetchone()
        disp = display_name.strip() or None
        if row:
            existing_sub = row["google_sub"]
            if existing_sub and existing_sub != sub:
                raise ValueError("email_login_conflict")
            conn.execute(
                """
                UPDATE user_state SET
                    google_sub = ?,
                    display_name = COALESCE(?, display_name),
                    email_verified = 1,
                    activation_token = NULL,
                    activation_expires_ms = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE email = ?
                """,
                (sub, disp, normalized),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_state (
                    email, watchlist_json, portfolio_json, role,
                    google_sub, display_name, email_verified, updated_at
                ) VALUES (?, '[]', '[]', 'user', ?, ?, 1, CURRENT_TIMESTAMP)
                """,
                (normalized, sub, (disp or "").strip() or normalized.split("@")[0]),
            )


def set_password_reset_token(email: str, token: str, expires_ms: int) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            """
            UPDATE user_state SET
                reset_token = ?, reset_expires_ms = ?, updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
            """,
            (token, expires_ms, normalized),
        )


def consume_password_reset(token: str, new_password_hash: str) -> str | None:
    tok = token.strip()
    if not tok:
        return None
    now = int(time.time() * 1000)
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email FROM user_state
            WHERE reset_token = ? AND reset_expires_ms IS NOT NULL AND reset_expires_ms > ?
            """,
            (tok, now),
        ).fetchone()
        if not row:
            return None
        em = str(row["email"])
        conn.execute(
            """
            UPDATE user_state SET
                password_hash = ?,
                reset_token = NULL,
                reset_expires_ms = NULL,
                email_verified = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
            """,
            (new_password_hash, em),
        )
        return em


# ─────────────────────────────────────────────────────────────
# TRADE JOURNAL
# ─────────────────────────────────────────────────────────────

def init_journal_db() -> None:
    """Create the trade_journal table (idempotent)."""
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trade_journal (
                id              TEXT NOT NULL,
                email           TEXT NOT NULL,
                ticker          TEXT NOT NULL,
                company_name    TEXT NOT NULL DEFAULT '',
                strategy        TEXT NOT NULL,
                bias            TEXT NOT NULL DEFAULT '',
                legs_json       TEXT NOT NULL DEFAULT '[]',
                expiry          TEXT NOT NULL,
                entry_date      TEXT NOT NULL,
                dte_at_entry    INTEGER NOT NULL DEFAULT 0,
                net_credit      REAL NOT NULL DEFAULT 0,
                max_profit      REAL NOT NULL DEFAULT 0,
                max_loss        REAL NOT NULL DEFAULT 0,
                underlying_entry REAL NOT NULL DEFAULT 0,
                prob_of_profit  REAL NOT NULL DEFAULT 0,
                expected_value  REAL NOT NULL DEFAULT 0,
                total_score     INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'OPEN',
                exit_date       TEXT NOT NULL DEFAULT '',
                underlying_exit REAL NOT NULL DEFAULT 0,
                realized_pnl    REAL NOT NULL DEFAULT 0,
                exit_reason     TEXT NOT NULL DEFAULT '',
                outcome         TEXT NOT NULL DEFAULT '',
                current_price   REAL NOT NULL DEFAULT 0,
                current_pnl     REAL NOT NULL DEFAULT 0,
                last_refreshed  INTEGER NOT NULL DEFAULT 0,
                notes           TEXT NOT NULL DEFAULT '',
                created_at      INTEGER NOT NULL,
                PRIMARY KEY (email, id)
            )
            """
        )


def save_journal_entry(email: str, entry: dict[str, Any]) -> str:
    """Insert a new journal entry. Returns the entry id."""
    import uuid, time
    normalized = normalize_email(email)
    entry_id = str(uuid.uuid4())[:8]
    now_ms = int(time.time() * 1000)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO trade_journal (
                id, email, ticker, company_name, strategy, bias,
                legs_json, expiry, entry_date, dte_at_entry,
                net_credit, max_profit, max_loss, underlying_entry,
                prob_of_profit, expected_value, total_score,
                status, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
            """,
            (
                entry_id, normalized,
                entry.get("ticker", ""),
                entry.get("company_name", ""),
                entry.get("strategy", ""),
                entry.get("bias", ""),
                json.dumps(entry.get("legs", [])),
                entry.get("expiry", ""),
                entry.get("entry_date", ""),
                int(entry.get("dte_at_entry", 0)),
                float(entry.get("net_credit", 0)),
                float(entry.get("max_profit", 0)),
                float(entry.get("max_loss", 0)),
                float(entry.get("underlying_entry", 0)),
                float(entry.get("prob_of_profit", 0)),
                float(entry.get("expected_value", 0)),
                int(entry.get("total_score", 0)),
                entry.get("notes", ""),
                now_ms,
            ),
        )
    return entry_id


def get_journal_entries(email: str, status: str | None = None) -> list[dict[str, Any]]:
    """Return all journal entries for a user, newest first."""
    normalized = normalize_email(email)
    with _connect() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM trade_journal WHERE email = ? AND status = ? ORDER BY created_at DESC",
                (normalized, status),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM trade_journal WHERE email = ? ORDER BY created_at DESC",
                (normalized,),
            ).fetchall()
    return [_row_to_entry(r) for r in rows]


def get_journal_entry(email: str, entry_id: str) -> dict[str, Any] | None:
    normalized = normalize_email(email)
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM trade_journal WHERE email = ? AND id = ?",
            (normalized, entry_id),
        ).fetchone()
    return _row_to_entry(row) if row else None


def update_journal_entry(email: str, entry_id: str, **fields) -> None:
    """Update arbitrary fields on a journal entry."""
    normalized = normalize_email(email)
    allowed = {
        "status", "exit_date", "underlying_exit", "realized_pnl",
        "exit_reason", "outcome", "current_price", "current_pnl",
        "last_refreshed", "notes",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with _connect() as conn:
        conn.execute(
            f"UPDATE trade_journal SET {set_clause} WHERE email = ? AND id = ?",
            (*updates.values(), normalized, entry_id),
        )


def delete_journal_entry(email: str, entry_id: str) -> None:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            "DELETE FROM trade_journal WHERE email = ? AND id = ?",
            (normalized, entry_id),
        )


def _row_active_trade(row: sqlite3.Row) -> dict[str, Any]:
    raw = row["raw_json"]
    extra: dict[str, Any] = json.loads(raw) if raw else {}
    rk = set(row.keys())
    core: dict[str, Any] = {
        "id": row["id"],
        "email": row["email"],
        "ticker": str(row["ticker"]).upper().strip(),
        "side": str(row["side"]).upper().strip(),
        "entry_price": float(row["entry_price"]),
        "entry_underlying_px": float(row["entry_underlying_px"])
        if row["entry_underlying_px"] is not None
        else None,
        "contracts": float(row["contracts"]) if row["contracts"] is not None else None,
        "notes": row["notes"] or "",
        "opened_at_ms": int(row["opened_at_ms"]),
        "exited_at_ms": int(row["exited_at_ms"]) if row["exited_at_ms"] is not None else None,
    }
    strike_col: Optional[float] = None
    if "strike" in rk and row["strike"] is not None:
        strike_col = float(row["strike"])
    expiry_col: Optional[str] = None
    if "option_expiry" in rk and row["option_expiry"]:
        expiry_col = str(row["option_expiry"]).strip()[:10] or None
    reserved = set(core.keys()) | {"strike", "expiry", "option_expiry"}
    for k, v in extra.items():
        if k not in reserved:
            core[k] = v
    if strike_col is not None:
        core["strike"] = strike_col
    elif extra.get("strike") is not None:
        try:
            core["strike"] = float(extra["strike"])
        except (TypeError, ValueError):
            pass
    if expiry_col:
        core["expiry"] = expiry_col
        core["option_expiry"] = expiry_col
    elif extra.get("option_expiry"):
        ex = str(extra["option_expiry"]).strip()[:10]
        if ex:
            core["expiry"] = ex
            core["option_expiry"] = ex
    elif extra.get("expiry"):
        ex = str(extra["expiry"]).strip()[:10]
        if ex:
            core["expiry"] = ex
            core["option_expiry"] = ex
    return core


def insert_active_trade(
    email: str,
    *,
    ticker: str,
    side: str,
    entry_price: float,
    entry_underlying_px: Optional[float] = None,
    contracts: Optional[float] = None,
    strike: Optional[float] = None,
    option_expiry: Optional[str] = None,
    notes: Optional[str] = None,
    raw_json_extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    t = ticker.upper().strip()
    if not t or len(t) > 12:
        raise ValueError("Invalid ticker")
    sd = side.upper().strip()
    if sd not in ("CALL", "PUT"):
        raise ValueError("side must be CALL or PUT")
    ep = float(entry_price)
    if ep < 0 or not math.isfinite(ep):
        raise ValueError("Invalid entry_price")
    strike_store = _normalize_strike(strike)
    expiry_store = _normalize_option_expiry(option_expiry)
    tid = str(uuid.uuid4())
    now_ms = int(time.time() * 1000)
    raw_store: dict[str, Any] = dict(raw_json_extra or {})
    raw_text = json.dumps(raw_store) if raw_store else None
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO active_trades (
                id, email, ticker, side, entry_price, entry_underlying_px,
                contracts, strike, option_expiry, notes, opened_at_ms, exited_at_ms, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                tid,
                normalized,
                t,
                sd,
                ep,
                entry_underlying_px,
                contracts,
                strike_store,
                expiry_store,
                (notes or "").strip() or None,
                now_ms,
                raw_text,
            ),
        )
    return get_active_trade(normalized, tid)  # type: ignore[return-value]


def get_active_trade(email: str, trade_id: str) -> dict[str, Any] | None:
    normalized = normalize_email(email)
    tid = trade_id.strip()
    if not normalized or not tid:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM active_trades WHERE email = ? AND id = ?
            """,
            (normalized, tid),
        ).fetchone()
    return _row_active_trade(row) if row else None


def list_active_trades_open(email: str) -> list[dict[str, Any]]:
    normalized = normalize_email(email)
    if not normalized:
        return []
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM active_trades
            WHERE email = ? AND exited_at_ms IS NULL
            ORDER BY opened_at_ms DESC
            """,
            (normalized,),
        ).fetchall()
    return [_row_active_trade(r) for r in rows]


_ET = ZoneInfo("America/New_York")


def _epoch_ms_to_et_date_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=_ET).date().isoformat()


def list_active_trades_open_opened_today_et(
    email: str, *, ref_epoch_ms: int | None = None
) -> list[dict[str, Any]]:
    """Non-exited trades whose ``opened_at_ms`` falls on the America/New_York calendar date of ref (default: now)."""
    ref = int(time.time() * 1000) if ref_epoch_ms is None else ref_epoch_ms
    today_et = _epoch_ms_to_et_date_iso(ref)
    return [
        r
        for r in list_active_trades_open(email)
        if _epoch_ms_to_et_date_iso(int(r["opened_at_ms"])) == today_et
    ]


def exit_active_trade(email: str, trade_id: str) -> bool:
    normalized = normalize_email(email)
    tid = trade_id.strip()
    if not normalized or not tid:
        return False
    now_ms = int(time.time() * 1000)
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE active_trades SET exited_at_ms = ?
            WHERE email = ? AND id = ? AND exited_at_ms IS NULL
            """,
            (now_ms, normalized, tid),
        )
    return cur.rowcount > 0


def _row_to_entry(row) -> dict[str, Any]:
    d = dict(row)
    d["legs"] = json.loads(d.pop("legs_json", "[]"))
    return d
