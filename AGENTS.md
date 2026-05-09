# OptionAdvisor — Agent Instructions

## Quick start

```bash
# Backend (port 9000)
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 9000

# Frontend (port 4200, proxies /api → :9000)
cd frontend && npm run dev
```

## Architecture

- **Backend** (`backend/`): FastAPI Python, monolithic `main.py` + routers in sibling files (`command_center_router.py`, `auth_routes.py`). Three independent analysis engines:
  - `day_trade.py` — intraday VWAP/session momentum signals
  - `swing_trade.py` — RSI/MACD/trend signals, multi-day holds
  - `engine.py` — delta selection, Black-Scholes EV, spread construction, Kelly sizing, scoring
  - `trade_aggregator.py` — shared per-ticker engine runner (avoids circular imports with `main.py`)
  - `decision_resolver/` — resolves all three engine outputs into unified decisions
  - `alerts/` — alert normalization + alert-center service
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Tailwind CSS + Recharts. Dark trading dashboard style. 26 pages in `src/pages/`.
- **Auth**: JWT (`PyJWT`) + optional Google Sign-In. `OPTION_ADVISOR_JWT_SECRET` required in production; set `OPTION_ADVISOR_ALLOW_INSECURE_JWT=1` for local dev.
- **Persistence**: SQLite via `backend/storage.py`. DB path from `OPTION_ADVISOR_DB_PATH` env var, defaults to `backend/option_advisor.sqlite3`.
- **Deploy**: GitHub Actions (`.github/workflows/deploy-production.yml`) → DigitalOcean Droplet over SSH. Trigger: workflow_dispatch or `v*` tag. See `DEPLOY_DIGITALOCEAN.md`.

## Commands

| Action | Command |
|--------|---------|
| Backend syntax check | `python3 -m py_compile backend/main.py backend/models.py backend/storage.py` |
| Run all backend tests | `cd backend && python3 -m unittest discover -s tests -t .` |
| Single backend test | `cd backend && python3 -m unittest tests.test_trade_engine_strategies` |
| Frontend typecheck | `cd frontend && tsc --noEmit` |
| Frontend build | `npm --prefix frontend run build` (runs backend tests → tsc → vite build) |
| Full test | `npm --prefix frontend test` (runs backend tests + tsc) |

## Conventions

- **Frontend owns display, backend owns all calculations.** No client-side signal computation. Frontend reads `final_decision` from backend cache — pure display.
- **`.cursorrules`**: preserve API compatibility, use TypeScript types + FastAPI response models, never auto-execute trades.
- **`main.py`** is the only FastAPI app; import routers with `app.include_router()`. Don't create a second app instance.
- **`trade_aggregator.py`** must never import from `main.py` (circular import risk).
- **Strategy dedup in `engine.py`**: in `all` mode, Bull Put Spread prevents Short Put/Covered Call; Bear Call Spread prevents Short Call/Covered Put.
- **Env files**: `backend/.env` (gitignored), `frontend/.env.local` (gitignored). Copy from `.env.example` files.
- **Mock flag**: `frontend/.env.local` `VITE_USE_MOCK=` (unset = dormant). All mock branches dead code.
- No linter/formatter config present. No pre-commit hooks.

## Theme system

- Theme tokens live as CSS custom properties in `frontend/src/index.css`. Two block scopes: `:root, html.dark` and `html.light`.
- All Tailwind gray classes (`bg-gray-900`, `text-gray-100`, `border-gray-700`) auto-adapt via `html.light .className` overrides using CSS variables + `color-mix()` for alpha variants. **No per-page scope duplication** — a single global override covers all pages.
- `tailwind.config.js` extends `colors` with semantic aliases: `surface-{canvas,page,card,elevated}`, `text-{primary,secondary,tertiary}`, `border-{subtle,default,strong}`, `semantic-{bullish,bearish,warning,accent,...}`.
- The `AppContext` uses `oa_theme` localStorage key. System `prefers-color-scheme` fallback + live listener when no saved preference.
- Adding a new color variant (e.g. `bg-gray-700/30`): add an `html.light .bg-gray-700\/30` override in index.css with `color-mix(in srgb, var(--surface-raised) 70%, transparent)`.
- Charts (Recharts): theme-aware via `--sw-chart-*` tokens cascading from `--chart-*` variables. No per-chart updates needed.

## Testing quirks

- Backend tests use `unittest` (not pytest). Test files in `backend/tests/`, named `test_*.py`.
- `frontend/package.json` `test` script runs `backend/test.sh` then `tsc --noEmit`. The frontend has no JS test framework — typecheck is the only frontend verification.
- `backend/test.sh` activates `.venv/bin/python` if available, falls back to `python3`.
