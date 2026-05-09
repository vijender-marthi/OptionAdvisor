# System Architecture

## Frontend
- React + TypeScript
- Tailwind CSS
- Dark trading dashboard style
- Thin UI; all calculations live in the backend.

## Backend
- FastAPI (Python)
- SQLite database
- All financial calculations are performed server‑side.

## Market Data
- Yahoo Finance / yfinance with a cache layer.

## Auth
- Firebase authentication.

## Hosting
- Frontend deployed on Firebase Hosting.
- Backend API deployed separately.

## Folder Structure
- **engines/day_trade_engine**
- **engines/swing_trade_engine**
- **engines/regular_trade_engine**
- **market_intelligence**
- **risk_guardrails**
- **trade_agent**
- **api/routes**
- **services**
- **models**
