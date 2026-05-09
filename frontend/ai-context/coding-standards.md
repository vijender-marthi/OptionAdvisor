# Coding Standards

- Backend owns all financial calculations.
- React components should never calculate P/L, max profit, or risk; these are provided by the backend.
- Keep response models typed; reuse existing Pydantic schemas.
- Avoid duplicate schemas across services.
- Reuse existing cache and service layers whenever possible.
- Do not break existing API routes.
- Use mock data only when a backend endpoint does not yet exist.
- Prefer small, modular files.
- Add comments only when the code’s intent is not obvious.
