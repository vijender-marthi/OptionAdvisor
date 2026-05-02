"""
SQLite persistence for per-user watchlist and portfolio state.
"""
import json
import os
import sqlite3
from pathlib import Path
from typing import Any


DEFAULT_DB_PATH = Path(__file__).with_name("option_advisor.sqlite3")
DB_PATH = Path(os.getenv("OPTION_ADVISOR_DB_PATH", str(DEFAULT_DB_PATH))).expanduser()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def normalize_email(email: str) -> str:
    return email.strip().lower()


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_state (
                email TEXT PRIMARY KEY,
                watchlist_json TEXT NOT NULL DEFAULT '[]',
                portfolio_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
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


def get_user_state(email: str) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not normalized:
        return {"email": "", "watchlist": [], "portfolio": []}

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json
            FROM user_state
            WHERE email = ?
            """,
            (normalized,),
        ).fetchone()

    if row is None:
        return {"email": normalized, "watchlist": [], "portfolio": []}

    return {
        "email": row["email"],
        "watchlist": json.loads(row["watchlist_json"]),
        "portfolio": json.loads(row["portfolio_json"]),
    }


def list_user_states() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT email, watchlist_json, portfolio_json
            FROM user_state
            ORDER BY updated_at DESC
            """
        ).fetchall()

    return [
        {
            "email": row["email"],
            "watchlist": json.loads(row["watchlist_json"]),
            "portfolio": json.loads(row["portfolio_json"]),
        }
        for row in rows
    ]


def save_user_state(email: str, watchlist: list[dict[str, Any]], portfolio: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = normalize_email(email)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_state (email, watchlist_json, portfolio_json, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
                watchlist_json = excluded.watchlist_json,
                portfolio_json = excluded.portfolio_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (normalized, json.dumps(watchlist), json.dumps(portfolio)),
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
