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

- **Dark-first design**: All components default to dark mode colors (`bg-gray-900`, `text-gray-100`, `border-gray-700`, etc.). Light mode is handled via CSS overrides in `frontend/src/index.css` scoped under `html.light`.
- **Two approaches for light theme**:
  - **Preferred**: Use Tailwind's `dark:` variant for paired classes (e.g. `text-slate-700 dark:text-gray-200`, `bg-white dark:bg-slate-900`, `border-slate-200 dark:border-white/[0.07]`). This is the cleanest pattern and matches the rest of the app.
  - **Fallback** (for components with many dark-only classes like `DayTradeEnginePanel`): Add `html.light .scope-class .class-name { property: value !important; }` rules in `index.css`. Always scope to the page or component container (`.day-trade-page`, `.day-trade-engine-panel`) to avoid leaking.
- **DO NOT use `text-gray-100/200/300/400/500` without a `dark:` variant or CSS override** — these are invisible on white backgrounds in light mode.
- **DO NOT use `bg-black/*`, `bg-gray-900/*`, `bg-*-950/*` without a light-mode counterpart** — these render as very dark overlays on light pages.
- **Semantic color tokens** in `tailwind.config.js`: `surface-{canvas,page,card,elevated}`, `text-{primary,secondary,tertiary}`, `border-{subtle,default,strong}`, `semantic-{bullish,bearish,warning,accent,conflict,info}`. Use these for theme-consistent styling.
- Theme tokens live as CSS custom properties in `frontend/src/index.css`. Two block scopes: `:root, html.dark` and `html.light`.
- The `AppContext` uses `oa_theme` localStorage key. System `prefers-color-scheme` fallback + live listener when no saved preference.
- Charts (Recharts): theme-aware via `--sw-chart-*` tokens cascading from `--chart-*` variables. No per-chart updates needed.

## Font / Text conventions

- **Monospace prices**: Always use `font-mono` for prices, P&L values, strikes, and any numeric financial data.
- **Small text**: `text-[10px]` and `text-[11px]` are common for secondary labels, badges, and timestamps. Ensure these have sufficient contrast in light mode — test with `text-slate-700 dark:text-gray-300` or similar.
- **Badges / pills**: Use `rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider` pattern for state/type badges.
- **Tabular numbers**: Use `tabular-nums` for any columnar numeric data to prevent layout shift.
- **Link vs plain**: Navigation links use the ticker as a clickable `<button>` with `hover:text-violet-600`; the down chevron indicates expandability, so don't add separate arrow icons for "open" actions.
- **Card pattern**: Use `rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden` for cards matching the rest of the app. Avoid dark-only classes like `bg-gray-900 border-gray-800`.
- **Light mode contrast check**: Any text that is `text-gray-*` below `text-gray-700` or `text-*-200/300` must have a dark background behind it, OR a light-mode override. If in doubt, add a `dark:` variant pair.

## Testing quirks

- Backend tests use `unittest` (not pytest). Test files in `backend/tests/`, named `test_*.py`.
- `frontend/package.json` `test` script runs `backend/test.sh` then `tsc --noEmit`. The frontend has no JS test framework — typecheck is the only frontend verification.
- `backend/test.sh` activates `.venv/bin/python` if available, falls back to `python3`.
