# Context
The new feature introduces a fully‑functional exit engine that evaluates all open positions for profit‑based, stop‑loss, and time‑based exits.  It extends the Position model with exit‑related fields, adds a backend module that encapsulates exit logic, exposes new API routes for automatic exit evaluation, and updates the Positions Center UI to display exit status, action, lock, trim, runner, and coach information.

## Implementation plan
1. **Model extension** – add optional `exit*` fields to `PortfolioPosition` in `frontend/src/types/index.ts` and propagate them through serialization in `backend/command_center_router.py`.
2. **Exit engine** – create a new `backend/exit_engine/` package with `__init__.py`, `exit_rules.py`, engine‑specific files (day_trade_exit.py, swing_trade_exit.py, regular_trade_exit.py) and helpers (`profit_protection.py`, `trailing_stop.py`).
   * `evaluate_exit(position, market) -> dict` returns an exit plan object with `exit_status`, `exit_action`, `exit_reason`, etc.
3. **Persist exit data** – modify `backend/storage.py` to store the new fields in the JSON payload, ensuring migrations handle existing portfolios.
4. **API routes** – add `/api/positions/auto‑exit` (POST) to trigger evaluation for all open positions, `/api/positions/{id}/refresh‑exit‑plan` and `/api/positions/refresh‑all‑exit‑plans` for targeted refreshes.
5. **Front‑end UI** – update `PositionsCenter.tsx` to add the new columns and badges; add an “Exit” button in `PortfolioPage.tsx` that calls the new API. Ensure `ClosePositionPayload` accepts a `reason`.
6. **Verification** – run unit tests, perform manual API calls, and use the existing MCP tools to render the updated Positions Center.

## Verification steps
- Run `pytest` to ensure existing tests pass.
- Spin up the dev server and confirm the Positions Center shows the new exit columns.
- Execute `/api/positions/auto‑exit` on a sample portfolio and verify exit data is persisted and displayed.
- Validate that no real trades are placed; the engine should only suggest actions.

## Files to edit
- `frontend/src/types/index.ts`
- `backend/command_center_router.py`
- `backend/storage.py`
- `backend/exit_engine/__init__.py`
- `backend/exit_engine/exit_rules.py`
- `backend/exit_engine/day_trade_exit.py`
- `backend/exit_engine/swing_trade_exit.py`
- `backend/exit_engine/regular_trade_exit.py`
- `backend/exit_engine/profit_protection.py`
- `backend/exit_engine/trailing_stop.py`
- `frontend/src/pages/PositionsCenter.tsx`
- `frontend/src/pages/PortfolioPage.tsx`

---

**Next recommended command:** `git status` to review the files scheduled for change.
