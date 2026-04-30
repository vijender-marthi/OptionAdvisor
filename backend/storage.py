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
