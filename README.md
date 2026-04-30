# OptionAdvisor

OptionAdvisor is a systematic options analysis app for scanning tickers, building options trade candidates, reviewing pre-trade checklist verdicts, tracking watchlist/portfolio state, and surfacing GO-trade alerts.

## Features

- Option analysis for calls, puts, debit spreads, credit spreads, iron condors, and straddles.
- Trade recommendations scored by signal fit, structure, liquidity, and IV fit.
- Pre-trade checklist with GO / CAUTION / NO GO verdicts.
- Watchlist with sorting, industry grouping, refresh, and cached analysis data.
- Trade Signals page with multi-week DTE windows: 2w, 3w, 4w, 6w, and 8w.
- Alerts page for GO trades, retained for 24 hours, with optional email alerts.
- Portfolio tracker for open and closed positions.
- Light and dark themes.
- SQLite persistence for per-user watchlist and portfolio data.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, Recharts
- Backend: FastAPI, Python, yfinance, pandas, NumPy
- Persistence: SQLite

## Project Structure

```text
backend/                 FastAPI API, options engine, SQLite storage
frontend/                React/Vite application
DEPLOY_DIGITALOCEAN.md   Production deployment guide
```

## Local Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000
```

The API runs at:

```text
http://localhost:9000
```

## Local Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on the Vite dev URL shown in the terminal.

## Configuration

Copy the backend example environment file and adjust values:

```bash
cp backend/.env.example backend/.env
```

Important values:

```env
OPTION_ADVISOR_DB_PATH=/path/to/option_advisor.sqlite3
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM=your-gmail@gmail.com
```

Email is optional. If SMTP values are empty, alerts still appear in the app, but email delivery is skipped.

## SQLite Storage

By default, SQLite is stored in `backend/option_advisor.sqlite3`.

For production, set `OPTION_ADVISOR_DB_PATH` to an external mounted volume path, for example:

```env
OPTION_ADVISOR_DB_PATH=/mnt/optionadvisor-data/option_advisor.sqlite3
```

This keeps user data outside the application directory during redeploys.

## Build

Frontend:

```bash
npm --prefix frontend run build
```

Backend syntax check:

```bash
python3 -m py_compile backend/main.py backend/models.py backend/storage.py
```

## Deployment

See `DEPLOY_DIGITALOCEAN.md` for the full DigitalOcean setup, including:

- Droplet setup
- External volume for SQLite
- systemd backend service
- Nginx frontend/API proxy
- SSL with Certbot
- Redeploy steps

## Disclaimer

OptionAdvisor is for educational and informational use only. It is not financial advice. Options trading involves substantial risk of loss.
