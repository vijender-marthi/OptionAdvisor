# Calculation Vault Architecture

## Status

OptionAdvisor has started migrating toward a Vault-style calculation architecture. The current implementation is incremental: Trade Worksheet calculations are the first workflow using immutable backend snapshots, while the rest of the trading engines still run through their existing APIs.

The rule for new work is:

> Backend owns calculations. Frontend renders completed outputs and metadata only.

## Current Scope

Implemented for:

- Trade Worksheet evaluation
- Calculation run creation
- Immutable calculation snapshot storage
- Metric definitions for Trade Worksheet output
- Day Trade Workspace final decision snapshots
- Owner-scoped read APIs
- Snapshot hash integrity verification
- Snapshot audit-log display

Not yet implemented for:

- Scalp
- Swing Trade
- Position Trading
- Position Center exits
- Trade Scanner / Signal Feed

## Data Flow

```text
Frontend Trade Worksheet input
  -> POST /api/v1/calculation-runs
  -> backend validates run type
  -> TradeWorksheetEvaluateRequest
  -> backend Trade Worksheet calculation
  -> metric definitions attached
  -> calculation_runs row inserted
  -> calculation_snapshots row inserted
  -> calculation_snapshot_audit_log row inserted
  -> response returns run + snapshot + result
  -> frontend renders result and frozen metadata
```

## Core Tables

### calculation_runs

One row per calculation attempt.

Important fields:

- `run_id`
- `run_type`
- `status`
- `engine_version`
- `formula_pack_version`
- `owner_email`
- `input_hash`
- `output_hash`
- `snapshot_id`
- `input_json`
- `error`
- `created_at_ms`
- `completed_at_ms`

Completed runs point to a snapshot. Failed runs do not.

### calculation_snapshots

Immutable frozen output for a completed calculation.

Important fields:

- `snapshot_id`
- `run_id`
- `run_type`
- `engine_version`
- `formula_pack_version`
- `metric_definitions_version`
- `owner_email`
- `input_hash`
- `output_hash`
- `input_json`
- `output_json`
- `metric_definitions_json`
- `created_at_ms`
- `frozen_at_ms`

SQLite triggers block `UPDATE` and `DELETE`.

### calculation_snapshot_audit_log

Append-only provenance events for snapshots.

Current event:

- `SNAPSHOT_FROZEN`

The freeze event stores:

- `runId`
- `ownerEmail`
- `inputHash`
- `outputHash`

### metric_definitions

Backend-owned descriptions and display metadata for metrics.

Metric definition fields:

- `metricId`
- `label`
- `category`
- `unit`
- `formulaId`
- `formulaVersion`
- `shortDescription`
- `longDescription`
- `inputsUsed`
- `displayRules`

## API Contract

Current Vault APIs:

```text
GET  /api/v1/metric-definitions
GET  /api/v1/calculation-run-types
POST /api/v1/calculation-runs
GET  /api/v1/calculation-runs
GET  /api/v1/calculation-runs/{runId}
GET  /api/v1/calculation-snapshots/{snapshotId}
GET  /api/v1/calculation-snapshots/{snapshotId}/integrity
GET  /api/v1/calculation-snapshots/{snapshotId}/audit-log
```

All read APIs are owner-scoped through the authenticated email.

## Calculation Run Registry

Supported run types are explicit in the backend registry.

Current run types:

| Run Type | Engine Version | Snapshot | Status |
| --- | --- | --- | --- |
| `day_trade_workspace` | `day-trade-workspace-engine-2026.07` | Yes | Active |
| `trade_worksheet` | `trade-worksheet-engine-2026.07` | Yes | Active |

Router version:

- `calculation-router-2026.07`

New workflows should be added to the registry before their frontend entrypoint is wired.

## Immutability Guarantees

Current guarantees:

- Snapshot rows are insert-only.
- Snapshot rows cannot be updated.
- Snapshot rows cannot be deleted.
- Snapshot reads are owner-scoped.
- Snapshot input/output hashes are recomputed on demand.
- Snapshot/run hash linkage is verified on demand.
- Snapshot freeze event is recorded in the audit log.
- Audit-log rows are append-only.

Known gaps:

- API schema is typed manually, not generated from OpenAPI.
- Only Trade Worksheet creates Vault snapshots.

## Frontend Rules

The frontend may:

- Submit user intent/input to `POST /api/v1/calculation-runs`.
- Render returned result fields.
- Render backend metric definitions.
- Render snapshot metadata.
- Render integrity and audit-log status.

The frontend must not:

- Recalculate trade score.
- Recalculate option payoff.
- Recalculate max profit/loss.
- Recalculate probability or Greeks.
- Create its own formula descriptions.
- Mutate completed snapshots.

Current guardrail:

```bash
npm --prefix frontend run validate:ui
```

This runs:

```bash
node scripts/check-business-logic-boundary.mjs
tsc --noEmit
```

## Test Coverage

Backend tests cover:

- Stable canonical JSON hashing
- Snapshot insertion
- Snapshot immutability triggers
- Legacy schema migration
- Metric definition seeding
- Owner-scoped reads
- Canonical calculation run creation
- Failed run audit rows
- Calculation run history
- Snapshot integrity verification
- Snapshot audit-log reads
- Golden snapshot outputs for Trade Worksheet
- OpenAPI presence for Vault routes and response models

Frontend validation covers:

- TypeScript API/client usage
- Business-logic boundary scan

## Migration Plan

### Phase 1: Harden Current Vault

- Continue documenting run types and engine versions as new workflows are added.

### Phase 2: Move More Calculation Outputs Into Vault

Candidate order:

1. Pre-Trade Analysis / Trade Worksheet complete.
2. Day Trade Workspace V2 page-ready backend model complete.
3. Day Trade final decision snapshot complete.
4. Swing Trade final decision snapshot.
5. Position Center exit snapshot.
6. Signal Feed / Trade Scanner cached decision snapshot.

### Queued: Day Trade Workspace V2

The next major Day Trade item is a backend-driven, presentation-only workspace redesign for the existing Day Trade route.

Standards check:

- Pass: backend owns trade permission, workspace mode, state precedence, setup/trigger/risk calculations, chart-level relevance, labels, copy, evidence, and actions.
- Pass: frontend is limited to rendering, layout, route/query state, drawers/tabs, chart viewport interaction, and pixel conversion.
- Pass: the prompt explicitly forbids frontend fallback business logic and domain derivation hooks.
- Pass: one page-ready versioned response is required.
- Pass: review/live/planning mode copy and action authorization stay backend-owned.

Implementation status:

- Done: `/day-trade` renders the backend-driven `DayTradeWorkspacePage`.
- Done: My Tickers integration is connected to the existing command-center ticker APIs.
- Done: ticker selection is URL-backed with `?symbol=...`, while the old `?ticker=...` query is still accepted.
- Done: Day Trade, Position, Swing, and All ticker lists render in the workspace drawer from persisted My Tickers data.
- Done: Add Ticker and membership changes reuse the existing backend persistence APIs.
- Done: `POST /api/v1/calculation-runs` supports `day_trade_workspace` and freezes the backend workspace output.
- Pending: richer management interactions such as drag reorder and bulk edit should remain in the dedicated Manage My Tickers surface unless promoted later.
- Pass: tests are split correctly between backend domain behavior, API contract, frontend presentation, chart interaction, and integration behavior.
- Adjustment: implement as multiple PRs, not one large PR.

Recommended PR split:

1. Backend Day Trade workspace DTO and endpoint returning a minimal page-ready model. Started with typed `GET /api/day-trade/workspace`.
2. Backend state precedence tests and API contract tests. Started with response-model, OpenAPI coverage, and management/risk/wait precedence coverage.
3. Frontend typed client and thin `useDayTradeWorkspace` data-fetching hook. Started with `fetchDayTradeWorkspace`, a transport-only hook, and runtime schema/version validation.
4. Presentation-only Day Trade workspace shell using backend labels/actions exactly. Started with isolated `DayTradeWorkspaceShell`.
5. Opt-in Day Trade route preview for the backend workspace. Started with `/day-trade?ticker=AAPL&workspace=v2`.
6. Primary chart migration to one chart with backend-provided candles, levels, events, defaults, and scale permissions. Started with `DayTradeWorkspaceChart`; chart viewport controls are now local presentation state, and interval changes reload the backend workspace query.
7. Move existing side panels into Plan, Options, Events, Alerts, Position, and Journal detail tabs. Started with backend page-ready tab payloads and collapsed-by-default single-open UI.
8. Remove/deprecate duplicate frontend decision calculations and old conflicting Day Trade panels. Started by routing `/day-trade` to `DayTradeWorkspacePage`, leaving the legacy long-form page disconnected from the active route.
9. Add responsive/accessibility/chart interaction tests where the repo test tooling supports them.

Do not start this queue item until the current Vault hardening/documentation PR is complete.

### Phase 3: Metric Registry Expansion

Move remaining tooltips and formula explanations into backend metric definitions.

Examples:

- Day Trade verdict fields
- Direction/bias fields
- DTE fields
- Exit-signal fields
- Swing timing fields

### Phase 4: Generated API Client

Generate frontend types from FastAPI OpenAPI instead of maintaining hand-written TypeScript interfaces.

### Phase 5: Design Vault

Create shared frontend primitives:

- `MetricCard`
- `RiskBadge`
- `StrategyCard`
- `OptionChainTable`
- `Tooltip`
- `PayoffChart`
- `ScenarioTable`
- `LoadingState`
- `EmptyState`
- `ErrorState`

## First Files To Touch For Future PRs

Backend:

- `backend/calculation_vault.py`
- `backend/main.py`
- `backend/storage.py`
- `backend/tests/test_calculation_vault.py`
- `backend/tests/test_calculation_vault_api_contract.py`
- `backend/tests/test_trade_worksheet_vault.py`
- `backend/tests/test_trade_worksheet_golden_snapshots.py`

Frontend:

- `frontend/src/api/client.ts`
- `frontend/src/pages/TradeWorksheetPage.tsx`
- `frontend/scripts/check-business-logic-boundary.mjs`

## Review Checklist

Before merging a Vault PR:

- Does backend own the calculation?
- Is the output stored as a snapshot if it is a completed calculation?
- Does the snapshot include engine/formula/metric versions?
- Are hashes stable and verified?
- Is the API owner-scoped?
- Does frontend only render returned values?
- Did `npm --prefix frontend run validate:ui` pass?
- Did backend Vault tests pass?
