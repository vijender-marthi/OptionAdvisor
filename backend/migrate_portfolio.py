"""
Copy portfolio from production to local SQLite database.
Run this on the PRODUCTION server to export, then run locally to import.

Usage (step 1 — on production server):
    ssh into droplet
    cd /opt/optionadvisor/backend
    source .venv/bin/activate
    python3 -c "
import json, sqlite3, os
DB = os.getenv('OPTION_ADVISOR_DB_PATH', './option_advisor.sqlite3')
conn = sqlite3.connect(DB)
rows = conn.execute('SELECT email, portfolio_json FROM user_state WHERE email=?', ('vijender.marthi@gmail.com',)).fetchall()
for email, pj in rows:
    print(f'{email}|{pj}')
conn.close()
" > /tmp/portfolio_export.txt

Usage (step 2 — on local machine):
    scp root@PRODUCTION_IP:/tmp/portfolio_export.txt /tmp/
    python3 migrate_portfolio.py
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

EMAIL = "vijender.marthi@gmail.com"
EXPORT_FILE = "/tmp/portfolio_export.txt"

# ── Local DB path ────────────────────────────────────────────────────────────
DEFAULT_DB = Path(__file__).parent / "option_advisor.sqlite3"
DB_PATH = Path(os.getenv("OPTION_ADVISOR_DB_PATH", str(DEFAULT_DB))).expanduser()


def import_portfolio(export_file: str = EXPORT_FILE) -> int:
    """Read portfolio from export file and write to local SQLite."""
    if not os.path.exists(export_file):
        print(f"Export file not found: {export_file}")
        print("Run step 1 on the production server first (see docstring).")
        return 0

    with open(export_file) as f:
        line = f.read().strip()

    if "|" not in line:
        print(f"Invalid export format: {line[:100]}")
        return 0

    email, portfolio_json = line.split("|", 1)
    portfolio = json.loads(portfolio_json)
    print(f"Loaded {len(portfolio)} positions for {email}")

    # ── Backup local DB ─────────────────────────────────────────────────
    import shutil
    backup = str(DB_PATH) + ".bak"
    shutil.copy2(str(DB_PATH), backup)
    print(f"Backed up local DB to {backup}")

    # ── Get existing state ───────────────────────────────────────────────
    conn = sqlite3.connect(str(DB_PATH))
    existing = conn.execute(
        "SELECT email, watchlist_json, portfolio_json, role, day_trade_watchlist, "
        "swing_trade_watchlist, alert_email_enabled, my_tickers "
        "FROM user_state WHERE email = ?", (EMAIL,)
    ).fetchone()

    if existing:
        # Preserve existing fields, replace portfolio
        conn.execute(
            "UPDATE user_state SET portfolio_json = ? WHERE email = ?",
            (json.dumps(portfolio), EMAIL),
        )
        print(f"Updated portfolio for {EMAIL} ({len(portfolio)} positions)")
    else:
        print(f"User {EMAIL} not found in local DB — create them first via the app.")

    conn.commit()
    conn.close()
    return len(portfolio)


if __name__ == "__main__":
    import_portfolio()
