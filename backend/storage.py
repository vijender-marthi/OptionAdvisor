"""
SQLite persistence for per-user watchlist and portfolio state.
"""
import json
import os
import sqlite3
import time
from typing import Any, Optional
from pathlib import Path

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


def get_user_state(email: str) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not normalized:
        return _state_with_watchlist_max(
            {
                "email": "",
                "role": "user",
                "watchlist": [],
                "portfolio": [],
                "advisory_terms_version": None,
                "advisory_accepted_at": None,
            }
        )

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json, role,
                   advisory_terms_version, advisory_accepted_at
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
                "advisory_terms_version": None,
                "advisory_accepted_at": None,
            }
        )

    stored_role = str(row["role"]) if row["role"] is not None else "user"
    return _state_with_watchlist_max(
        {
            "email": row["email"],
            "role": effective_user_role(normalized, stored_role),
            "watchlist": json.loads(row["watchlist_json"]),
            "portfolio": json.loads(row["portfolio_json"]),
            "advisory_terms_version": row["advisory_terms_version"],
            "advisory_accepted_at": row["advisory_accepted_at"],
        }
    )


def list_user_states() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json, role
            FROM user_state
            ORDER BY updated_at DESC
            """
        ).fetchall()

    return [
        {
            "email": row["email"],
            "role": effective_user_role(row["email"], str(row["role"]) if row["role"] is not None else None),
            "watchlist": json.loads(row["watchlist_json"]),
            "portfolio": json.loads(row["portfolio_json"]),
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
) -> dict[str, Any]:
    normalized = normalize_email(email)
    preview = get_user_state(normalized)
    lim = watchlist_limit_for_role(str(preview.get("role") or "user"))
    if len(watchlist) > lim:
        raise ValueError(f"watchlist_limit:{lim}")
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_state (
                email, watchlist_json, portfolio_json, role,
                advisory_terms_version, advisory_accepted_at, updated_at
            )
            VALUES (?, ?, ?, 'user', ?, ?, CURRENT_TIMESTAMP)
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
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                normalized,
                json.dumps(watchlist),
                json.dumps(portfolio),
                advisory_terms_version,
                advisory_accepted_at,
            ),
        )

    return get_user_state(normalized)


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


def _row_to_entry(row) -> dict[str, Any]:
    d = dict(row)
    d["legs"] = json.loads(d.pop("legs_json", "[]"))
    return d
