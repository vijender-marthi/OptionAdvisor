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

DAY_TRADE_WATCHLIST_MAX_TICKERS = 10
SWING_TRADE_WATCHLIST_MAX_TICKERS = 20
LEGACY_USER_ALERT_RETENTION_MS = 24 * 60 * 60 * 1000
ALERT_CENTER_RETENTION_MS = 4 * 24 * 60 * 60 * 1000


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


def _migrate_user_state_my_tickers(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    if "my_tickers_json" not in cols:
        conn.execute(
            "ALTER TABLE user_state ADD COLUMN my_tickers_json TEXT NOT NULL DEFAULT '[]'"
        )


def _migrate_user_state_backfill_my_tickers(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT email, watchlist_json, day_trade_watchlist_json, swing_trade_watchlist_json, my_tickers_json FROM user_state"
    ).fetchall()
    for row in rows:
        existing = json.loads(row["my_tickers_json"] or "[]")
        if existing:
            continue
        merged: dict[str, dict[str, Any]] = {}
        for raw in json.loads(row["watchlist_json"] or "[]"):
            if isinstance(raw, dict):
                sym = str(raw.get("ticker", "") or "").strip().upper()
                if sym:
                    if sym not in merged:
                        merged[sym] = {"symbol": sym, "trade_types": [], "is_active": True, "company_name": str(raw.get("companyName", "") or ""), "added_date": str(raw.get("addedAt", "") or "")[:10]}
                    if "regular" not in merged[sym]["trade_types"]:
                        merged[sym]["trade_types"].append("regular")
        for t in json.loads(row["day_trade_watchlist_json"] or "[]"):
            sym = str(t or "").strip().upper()
            if sym:
                if sym not in merged:
                    merged[sym] = {"symbol": sym, "trade_types": [], "is_active": True, "company_name": "", "added_date": ""}
                if "day" not in merged[sym]["trade_types"]:
                    merged[sym]["trade_types"].append("day")
        for t in json.loads(row["swing_trade_watchlist_json"] or "[]"):
            sym = str(t or "").strip().upper()
            if sym:
                if sym not in merged:
                    merged[sym] = {"symbol": sym, "trade_types": [], "is_active": True, "company_name": "", "added_date": ""}
                if "swing" not in merged[sym]["trade_types"]:
                    merged[sym]["trade_types"].append("swing")
        if merged:
            conn.execute(
                "UPDATE user_state SET my_tickers_json = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?",
                (json.dumps(list(merged.values())), row["email"]),
            )


def _migrate_user_state_clear_old_watchlist(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(user_state)").fetchall()}
    has_wl = "watchlist_json" in cols
    has_dt = "day_trade_watchlist_json" in cols
    has_sw = "swing_trade_watchlist_json" in cols
    if has_wl:
        conn.execute("UPDATE user_state SET watchlist_json = '[]'")
    if has_dt:
        conn.execute("UPDATE user_state SET day_trade_watchlist_json = '[]'")
    if has_sw:
        conn.execute("UPDATE user_state SET swing_trade_watchlist_json = '[]'")


def _migrate_active_trades_option_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(active_trades)").fetchall()}
    if "strike" not in cols:
        conn.execute("ALTER TABLE active_trades ADD COLUMN strike REAL")
    if "option_expiry" not in cols:
        conn.execute("ALTER TABLE active_trades ADD COLUMN option_expiry TEXT")


def _migrate_alert_center_items(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(alert_center_items)").fetchall()}
    if "updated_at_ms" not in cols:
        conn.execute("ALTER TABLE alert_center_items ADD COLUMN updated_at_ms INTEGER")
    conn.execute(
        """
        UPDATE alert_center_items
        SET
            severity = UPPER(COALESCE(severity, 'INFO')),
            engine = UPPER(COALESCE(engine, 'REGULAR')),
            signal = UPPER(COALESCE(signal, 'WATCH')),
            status = CASE UPPER(COALESCE(status, 'ACTIVE'))
                WHEN 'ACTIVE' THEN 'ACTIVE'
                WHEN 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED'
                WHEN 'RESOLVED' THEN 'RESOLVED'
                ELSE 'ACTIVE'
            END,
            updated_at_ms = COALESCE(updated_at_ms, created_at_ms)
        """
    )


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
    Unified WatchlistX no longer enforces practical item limits.

    We still return a large integer for backwards-compatible payloads / older UI
    that expects a numeric ``watchlist_max`` field.
    """
    return 9999


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
        _migrate_user_state_my_tickers(conn)
        _migrate_user_state_backfill_my_tickers(conn)
        _migrate_user_state_clear_old_watchlist(conn)
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alert_center_items (
                id TEXT NOT NULL,
                email TEXT NOT NULL,
                alert_group TEXT NOT NULL,
                severity TEXT NOT NULL,
                engine TEXT NOT NULL,
                signal TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                notes TEXT NOT NULL DEFAULT '',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER,
                meta_json TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (email, id)
            )
            """
        )
        _migrate_alert_center_items(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_alert_center_email_created ON alert_center_items(email, created_at_ms DESC)"
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


def _normalize_trade_watchlist_tickers(raw: object, max_symbols: int) -> list[str]:
    """Up to max_symbols unique US-style tickers."""
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
        if len(out) >= max_symbols:
            break
    return out


def _normalize_day_trade_tickers(raw: object) -> list[str]:
    return _normalize_trade_watchlist_tickers(raw, DAY_TRADE_WATCHLIST_MAX_TICKERS)


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
                "my_tickers": [],
            }
        )

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json, role,
                   advisory_terms_version, advisory_accepted_at,
                   day_trade_watchlist_json, swing_trade_watchlist_json, alert_email_enabled,
                   my_tickers_json
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
                "my_tickers": [],
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
    sw_list = _normalize_trade_watchlist_tickers(
        json.loads(sw_json) if sw_json else [], SWING_TRADE_WATCHLIST_MAX_TICKERS,
    )
    try:
        ae_raw = row["alert_email_enabled"]
        alert_email_enabled = bool(int(ae_raw)) if ae_raw is not None else True
    except (KeyError, IndexError, TypeError, ValueError):
        alert_email_enabled = True
    try:
        mt_raw = row["my_tickers_json"]
    except (KeyError, IndexError):
        mt_raw = "[]"
    mt_list = json.loads(mt_raw) if mt_raw else []
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
            "my_tickers": mt_list,
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
            "swing_trade_watchlist": _normalize_trade_watchlist_tickers(
                json.loads(row["swing_trade_watchlist_json"] or "[]"),
                SWING_TRADE_WATCHLIST_MAX_TICKERS,
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
    my_tickers: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    preview = get_user_state(normalized)
    if day_trade_watchlist is not None:
        dt_normalized = _normalize_day_trade_tickers(day_trade_watchlist)
    else:
        dt_normalized = _normalize_day_trade_tickers(preview.get("day_trade_watchlist"))
    if swing_trade_watchlist is not None:
        sw_normalized = _normalize_trade_watchlist_tickers(
            swing_trade_watchlist, SWING_TRADE_WATCHLIST_MAX_TICKERS,
        )
    else:
        sw_normalized = _normalize_trade_watchlist_tickers(
            preview.get("swing_trade_watchlist"),
            SWING_TRADE_WATCHLIST_MAX_TICKERS,
        )
    ae = bool(preview.get("alert_email_enabled", True))
    if alert_email_enabled is not None:
        ae = bool(alert_email_enabled)
    if my_tickers is not None:
        mt_normalized = my_tickers
    else:
        mt_normalized = preview.get("my_tickers") or []

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_state (
                email, watchlist_json, portfolio_json, role,
                advisory_terms_version, advisory_accepted_at,
                day_trade_watchlist_json, swing_trade_watchlist_json, alert_email_enabled,
                my_tickers_json, updated_at
            )
            VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                my_tickers_json = excluded.my_tickers_json,
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
                json.dumps(mt_normalized),
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


def _legacy_user_alert_to_alert_center_record(
    email: str,
    alert: dict[str, Any],
) -> tuple[
    str, str, str, str, str, str, str, str, str, str, int, int, str,
]:
    normalized = normalize_email(email)
    legacy_id = str(alert.get("id") or "").strip()
    aid = f"legacy-watchlist:{legacy_id}" if legacy_id else f"legacy-watchlist:{uuid.uuid4()}"
    ticker = str(alert.get("ticker") or "").strip().upper()
    strategy = str(alert.get("strategy") or "Trade setup").strip()
    bias = str(alert.get("bias") or "").strip()
    score = alert.get("score")
    ev = alert.get("ev")
    pop = alert.get("pop")
    expiry = str(alert.get("expiry") or "").strip()
    dismissed = bool(alert.get("dismissed"))
    created_ms = int(alert.get("detectedAt") or int(time.time() * 1000))
    updated_ms = created_ms

    score_txt = f"Score {int(score)}" if isinstance(score, (int, float)) and math.isfinite(score) else None
    ev_txt = f"EV {float(ev):.2f}" if isinstance(ev, (int, float)) and math.isfinite(ev) else None
    pop_txt = f"PoP {float(pop) * 100:.0f}%" if isinstance(pop, (int, float)) and math.isfinite(pop) else None
    facts = " · ".join(part for part in [bias or None, score_txt, ev_txt, pop_txt, expiry or None] if part)

    title = f"{ticker} {strategy} alert is active." if ticker else f"{strategy} alert is active."
    body = facts or "Legacy watchlist scanner alert promoted into Alert Center."
    meta = {
        "ticker": ticker,
        "alert_type": "REGULAR_TRADE",
        "engine_type": "REGULAR",
        "recommended_action": "Open Strategy Finder to review the setup and decide whether to add it to positions.",
        "reason": facts or "Legacy watchlist scanner alert.",
        "legacy_alert_id": legacy_id,
        "source": "legacy_user_alerts",
    }
    status = "RESOLVED" if dismissed else "ACTIVE"
    return (
        aid,
        normalized,
        "regular_trade",
        "INFO",
        "REGULAR",
        "GO",
        title,
        body,
        status,
        "",
        created_ms,
        updated_ms,
        json.dumps(meta),
    )


def sync_user_alerts_to_alert_center(
    email: str,
    retention_ms: int,
    now_ms: int,
) -> int:
    normalized = normalize_email(email)
    if not normalized:
        return 0
    alerts = get_user_alerts(normalized, retention_ms, now_ms)
    if not alerts:
        return 0
    rows = [_legacy_user_alert_to_alert_center_record(normalized, alert) for alert in alerts]
    with _connect() as conn:
        before = conn.total_changes
        conn.executemany(
            """
            INSERT INTO alert_center_items (
                id, email, alert_group, severity, engine, signal, title, body,
                status, notes, created_at_ms, updated_at_ms, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email, id) DO UPDATE SET
                status = excluded.status,
                updated_at_ms = excluded.updated_at_ms,
                title = excluded.title,
                body = excluded.body,
                meta_json = excluded.meta_json
            """,
            rows,
        )
        return conn.total_changes - before


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


def ensure_demo_alert_center_rows(email: str) -> None:
    """Insert normalized sample alerts once per user if the table is empty."""
    normalized = normalize_email(email)
    if not normalized:
        return
    from alerts.alert_service import demo_alerts

    with _connect() as conn:
        n = conn.execute(
            "SELECT COUNT(*) AS c FROM alert_center_items WHERE email = ?",
            (normalized,),
        ).fetchone()
        if n and int(n["c"]) > 0:
            return
        demo = []
        for alert in demo_alerts():
            created_ms = int(datetime.fromisoformat(alert.created_at).timestamp() * 1000)
            updated_ms = int(datetime.fromisoformat(alert.updated_at).timestamp() * 1000) if alert.updated_at else created_ms
            section = {
                "DAY": "day_trade",
                "SWING": "swing_trade",
                "REGULAR": "regular_trade",
                "PORTFOLIO": "portfolio",
                "MARKET": "market",
            }.get(alert.engine_type, "regular_trade")
            meta = {
                "ticker": alert.ticker,
                "alert_type": alert.alert_type,
                "engine_type": alert.engine_type,
                "recommended_action": alert.recommended_action,
                "reason": alert.reason,
                "related_trade_id": alert.related_trade_id,
                "related_watchlist_id": alert.related_watchlist_id,
            }
            demo.append(
                (
                    alert.id,
                    normalized,
                    section,
                    alert.severity,
                    alert.engine_type,
                    alert.signal,
                    alert.message,
                    alert.reason,
                    alert.status,
                    "",
                    created_ms,
                    updated_ms,
                    json.dumps(meta),
                )
            )
        conn.executemany(
            """
            INSERT INTO alert_center_items (
                id, email, alert_group, severity, engine, signal, title, body,
                status, notes, created_at_ms, updated_at_ms, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            demo,
        )


def alert_center_create(
    email: str,
    *,
    alert_group: str,
    severity: str,
    engine: str,
    signal: str,
    title: str,
    body: str,
    status: str = "ACTIVE",
    meta: Optional[dict[str, Any]] = None,
    notes: str = "",
    alert_id: Optional[str] = None,
) -> str:
    normalized = normalize_email(email)
    if not normalized:
        raise ValueError("email is required")
    now_ms = int(time.time() * 1000)
    aid = (alert_id or str(uuid.uuid4())).strip()
    payload = json.dumps(meta or {})
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO alert_center_items (
                id, email, alert_group, severity, engine, signal, title, body,
                status, notes, created_at_ms, updated_at_ms, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                aid,
                normalized,
                alert_group.strip().lower(),
                severity.strip().upper(),
                engine.strip().upper(),
                signal.strip().upper(),
                title.strip(),
                body.strip(),
                status.strip().upper(),
                notes.strip(),
                now_ms,
                now_ms,
                payload,
            ),
        )
    return aid


def alert_center_list(
    email: str,
    *,
    group: Optional[str] = None,
    engine: Optional[str] = None,
    signal: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    ticker: Optional[str] = None,
    active_only: bool = False,
    today_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    normalized = normalize_email(email)
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    clauses = ["email = ?"]
    params: list[Any] = [normalized]
    if group:
        clauses.append("alert_group = ?")
        params.append(group.strip().lower())
    if engine:
        clauses.append("UPPER(engine) = ?")
        params.append(engine.strip().upper())
    if signal:
        clauses.append("UPPER(signal) = ?")
        params.append(signal.strip().upper())
    if severity:
        clauses.append("UPPER(severity) = ?")
        params.append(severity.strip().upper())
    if status:
        clauses.append("UPPER(status) = ?")
        params.append(status.strip().upper())
    if ticker:
        t = ticker.strip().upper()
        clauses.append(
            "upper(trim(COALESCE(json_extract(meta_json, '$.ticker'), ''))) = ?"
        )
        params.append(t)
    if active_only:
        clauses.append("status = ?")
        params.append("ACTIVE")
    if today_only:
        today_start = int(datetime.now(ZoneInfo("America/New_York")).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        clauses.append("created_at_ms >= ?")
        params.append(today_start)
    where_sql = " AND ".join(clauses)
    with _connect() as conn:
        total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM alert_center_items WHERE {where_sql}",
            params,
        ).fetchone()
        total = int(total_row["c"]) if total_row else 0
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"""
            SELECT id, alert_group, severity, engine, signal, title, body,
                   status, notes, created_at_ms, updated_at_ms, meta_json
            FROM alert_center_items
            WHERE {where_sql}
            ORDER BY created_at_ms DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        meta: dict[str, Any]
        try:
            meta = json.loads(row["meta_json"] or "{}")
        except json.JSONDecodeError:
            meta = {}
        out.append(
            {
                "id": row["id"],
                "ticker": str(meta.get("ticker") or "").upper(),
                "alert_type": str(meta.get("alert_type") or "GENERAL").upper(),
                "engine_type": str(meta.get("engine_type") or row["engine"] or "REGULAR").upper(),
                "severity": str(row["severity"] or "INFO").upper(),
                "signal": str(row["signal"] or "WATCH").upper(),
                "message": str(row["title"] or ""),
                "reason": str(meta.get("reason") or row["body"] or ""),
                "recommended_action": str(meta.get("recommended_action") or "Review the setup."),
                "related_trade_id": meta.get("related_trade_id"),
                "related_watchlist_id": meta.get("related_watchlist_id"),
                "status": str(row["status"] or "ACTIVE").upper(),
                "created_at": datetime.fromtimestamp(int(row["created_at_ms"]) / 1000.0, tz=ZoneInfo("UTC")).isoformat(),
                "updated_at": datetime.fromtimestamp(int(row["updated_at_ms"] or row["created_at_ms"]) / 1000.0, tz=ZoneInfo("UTC")).isoformat(),
                "notes": row["notes"],
                "section": row["alert_group"],
            }
        )
    return out, total


def alert_center_active_counts_by_ticker(
    email: str,
    tickers: Optional[list[str]] = None,
) -> dict[str, int]:
    normalized = normalize_email(email)
    clauses = ["email = ?", "status = ?"]
    params: list[Any] = [normalized, "ACTIVE"]

    cleaned: list[str] = []
    if tickers:
        seen: set[str] = set()
        for raw in tickers:
            ticker = str(raw or "").strip().upper()
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            cleaned.append(ticker)
        if cleaned:
            placeholders = ",".join("?" for _ in cleaned)
            clauses.append(
                f"upper(trim(COALESCE(json_extract(meta_json, '$.ticker'), ''))) IN ({placeholders})"
            )
            params.extend(cleaned)

    where_sql = " AND ".join(clauses)
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT upper(trim(COALESCE(json_extract(meta_json, '$.ticker'), ''))) AS ticker,
                   COUNT(*) AS count
            FROM alert_center_items
            WHERE {where_sql}
            GROUP BY upper(trim(COALESCE(json_extract(meta_json, '$.ticker'), '')))
            """,
            params,
        ).fetchall()

    counts: dict[str, int] = {}
    for row in rows:
        ticker = str(row["ticker"] or "").strip().upper()
        if ticker:
            counts[ticker] = int(row["count"] or 0)
    return counts


def alert_center_active_count(email: str) -> int:
    normalized = normalize_email(email)
    if not normalized:
        return 0
    sync_user_alerts_to_alert_center(normalized, LEGACY_USER_ALERT_RETENTION_MS, int(time.time() * 1000))
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM alert_center_items
            WHERE email = ? AND status = 'ACTIVE'
            """,
            (normalized,),
        ).fetchone()
        return int(row["c"]) if row else 0


def alert_center_critical_count(email: str) -> int:
    """Count active alerts with severity = 'critical'."""
    normalized = normalize_email(email)
    if not normalized:
        return 0
    sync_user_alerts_to_alert_center(normalized, LEGACY_USER_ALERT_RETENTION_MS, int(time.time() * 1000))
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM alert_center_items
            WHERE email = ? AND status = 'ACTIVE' AND UPPER(severity) = 'CRITICAL'
            """,
            (normalized,),
        ).fetchone()
        return int(row["c"]) if row else 0


def alert_center_acknowledge(email: str, alert_id: str) -> bool:
    normalized = normalize_email(email)
    aid = str(alert_id).strip()
    if not aid:
        return False
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE alert_center_items
            SET status = 'ACKNOWLEDGED', updated_at_ms = ?
            WHERE email = ? AND id = ? AND status = 'ACTIVE'
            """,
            (int(time.time() * 1000), normalized, aid),
        )
        return cur.rowcount > 0


def alert_center_resolve(email: str, alert_id: str) -> bool:
    normalized = normalize_email(email)
    aid = str(alert_id).strip()
    if not aid:
        return False
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE alert_center_items
            SET status = 'RESOLVED', updated_at_ms = ?
            WHERE email = ? AND id = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
            """,
            (int(time.time() * 1000), normalized, aid),
        )
        return cur.rowcount > 0


def alert_center_append_note(email: str, alert_id: str, text: str) -> bool:
    normalized = normalize_email(email)
    aid = str(alert_id).strip()
    note = (text or "").strip()
    if not aid or not note:
        return False
    line = f"[{datetime.now(ZoneInfo('UTC')).isoformat(timespec='seconds')}] {note}\n"
    with _connect() as conn:
        row = conn.execute(
            "SELECT notes FROM alert_center_items WHERE email = ? AND id = ?",
            (normalized, aid),
        ).fetchone()
        if not row:
            return False
        prev = str(row["notes"] or "")
        conn.execute(
            "UPDATE alert_center_items SET notes = ?, updated_at_ms = ? WHERE email = ? AND id = ?",
            (prev + line, int(time.time() * 1000), normalized, aid),
        )
        return True


def get_alert_center_summary(
    email: str,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not normalized:
        return {"active_count": 0, "items": [], "by_engine": {}, "by_severity": {}, "rules_count": 0}

    sync_user_alerts_to_alert_center(normalized, LEGACY_USER_ALERT_RETENTION_MS, int(time.time() * 1000))

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT status, engine, severity, id, alert_group, signal, title, body,
                   notes, created_at_ms, updated_at_ms, meta_json
            FROM alert_center_items
            WHERE email = ?
            ORDER BY created_at_ms DESC
            """,
            (normalized,),
        ).fetchall()

    active_count = 0
    by_engine: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    items: list[dict[str, Any]] = []

    for row in rows:
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(row["meta_json"] or "{}")
        except json.JSONDecodeError:
            meta = {}

        status = str(row["status"] or "ACTIVE").upper()
        engine = str(meta.get("engine_type") or row["engine"] or "REGULAR").upper()
        section = str(row["alert_group"] or "regular_trade").lower()
        severity = str(row["severity"] or "INFO").upper()

        mapped_engine = {
            "DAY": "day",
            "SWING": "swing",
            "REGULAR": "regular",
            "PORTFOLIO": "portfolio",
        }.get(engine, "general")

        if status == "ACTIVE":
            active_count += 1
            by_engine[mapped_engine] = by_engine.get(mapped_engine, 0) + 1
            by_severity[severity.lower()] = by_severity.get(severity.lower(), 0) + 1

        items.append({
            "id": row["id"],
            "ticker": str(meta.get("ticker") or "").upper(),
            "alert_type": str(meta.get("alert_type") or "GENERAL").upper(),
            "engine_type": engine,
            "section": section,
            "severity": severity,
            "signal": str(row["signal"] or "WATCH").upper(),
            "message": str(row["title"] or ""),
            "reason": str(meta.get("reason") or row["body"] or ""),
            "recommended_action": str(meta.get("recommended_action") or "Review the setup."),
            "status": status,
            "created_at": datetime.fromtimestamp(int(row["created_at_ms"]) / 1000.0, tz=ZoneInfo("UTC")).isoformat(),
            "updated_at": datetime.fromtimestamp(int(row["updated_at_ms"] or row["created_at_ms"]) / 1000.0, tz=ZoneInfo("UTC")).isoformat(),
        })

    return {
        "active_count": active_count,
        "items": items,
        "by_engine": {
            "day": by_engine.get("day", 0),
            "swing": by_engine.get("swing", 0),
            "regular": by_engine.get("regular", 0),
            "portfolio": by_engine.get("portfolio", 0),
            "general": by_engine.get("general", 0),
        },
        "by_severity": {
            "critical": by_severity.get("critical", 0),
            "warning": by_severity.get("warning", 0),
            "info": by_severity.get("info", 0),
        },
        "rules_count": 0,
    }


def prune_alert_center_items(email: str) -> int:
    normalized = normalize_email(email)
    if not normalized:
        return 0
    cutoff = int(time.time() * 1000) - ALERT_CENTER_RETENTION_MS
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM alert_center_items WHERE email = ? AND created_at_ms < ?",
            (normalized, cutoff),
        )
        return cur.rowcount


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
        "strategy", "bias", "underlying_entry", "net_credit",
        "max_profit", "max_loss", "prob_of_profit", "expected_value",
        "total_score", "expiry", "entry_date", "company_name",
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
