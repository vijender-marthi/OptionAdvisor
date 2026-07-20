# Position Trading Page Redesign — Implementation Plan

## Overview

Rewrite the existing Position Trading page (`TickerPage.tsx`) into a three-region desktop trading workspace:
- **Left:** Ticker navigation + filters (250–280px)
- **Center:** Chart + recommendations (flexible)
- **Right:** Selected-recommendation detail panel (330–380px)

Reuse existing backend APIs — no new backend endpoints needed. All calculations remain server-side.

---

## Files to Create

### 1. `frontend/src/types/positionTrading.ts`
Extended types for the position trading page:
- `PositionTradingViewState` — all UI state (selectedTicker, selectedRec, tabs, filters, etc.)
- `PositionTradingFilterState` — filter parameters (strategy, horizon, bias, state, activeOnly)
- `PositionTradingTickerData` — enriched ticker entry with recommendation summary
- `PositionTradingRecommendationDetail` — full recommendation display model

### 2. `frontend/src/hooks/usePositionTrading.ts`
Custom hook encapsulating all state management:
- Ticker list loading from `fetchMyTickers()`
- Ticker search (debounced, filters my tickers + search API)
- Ticker selection → triggers `analyzeOptions` + `fetchPositionSessionChart`
- Recommendation selection and auto-select best valid
- Filter state management
- Chart interval state
- Tab state (center tabs: Overview/Chart/Key Levels/Flow/News)
- Cache integration with existing `tickerCache`
- Loading, error, empty states per section

---

## Files to Rewrite

### 3. `frontend/src/pages/TickerPage.tsx` (complete rewrite)
The main page component (~1500-2000 lines). Contains:

**Page Shell:**
- Three-column layout: left sidebar (260px) + center (flex) + right detail (360px)
- Full-height desktop with independent scrolling per region
- At <1280px: right panel collapses into drawer
- Uses AppLayout's main area, fixed workstation mode for full height

**Page Header (center top):**
- "Position Trading" title + subtitle
- Segmented buttons: Pre-Trade Analysis | Active Positions | Strategy Guide

**Left Sidebar Components (inline):**
- Tab bar: "My Tickers" | "Markets" (defaults to My Tickers)
- Search input with debounce, clear, keyboard nav
- Quick filters: Strategy dropdown, Time Horizon, Bias, Recommendation State, Active Only toggle
- Ticker list: scrollable cards showing symbol, price, change%, strategy, state badge, confidence
- "Add Ticker" button at bottom
- Selected state (purple outline) on active ticker

**Center Components (inline):**
- **Summary Bar**: symbol, company name, price, change, volume, avg vol, IV rank, PCR, bias
- **Tabs**: Overview (default) | Chart | Key Levels | Flow | News
- **Overview → Chart Card**: 
  - Backend-provided chart via existing `DayTradeWorkspaceChart` 
  - Controls: 1m/5m/15m/1h/Daily, indicators toggle, VWAP, OR Levels, refresh, zoom controls
  - Responsive height 380–520px
- **Overview → Recommendations Section**:
  - Sub-tabs: List (default) | Performance | History
  - **List tab**: Compact table of recommendations
    - Columns: Rank, Strategy, Legs, Bias, Confidence, EV, R:R, Expiry/DTE, State
    - Row selection → updates right panel
    - Purple outline on selected row
    - Expandable "View all recommendations" toggle
    - Auto-selects GO/preferred recommendation
  - **Performance tab**: Strategy-level metrics from backend (win rate, avg P&L, trades, drawdown)
  - **History tab**: Previous decisions (date, strategy, state, outcome)

**Right Detail Panel (inline):**
- Empty state: "Select a recommendation to view trade details."
- **Selected Recommendation**: strategy name, state, index (1 of N), prev/next controls
- **Key Rationale**: 3–5 backend-provided reasons with pass icons, main risk, invalidation
- **Trade Details**: compact metric cards (strike, premium, expiry, DTE, collateral, breakeven, max profit/loss, POP, EV, R:R, delta, IV, OI, volume)
- **Risk Profile**: backend-provided payoff chart via existing `OptionProfitCalculator`
- **Recent Performance**: win rate, avg P&L, trade count, best trade
- **Actions**: View Full Analysis, Add to Watchlist, Create Alert
- **Advanced Signals** (collapsed by default): Greeks, volatility, liquidity, S/R, trend, market regime

---

## Files to Modify

### 4. `frontend/src/App.tsx`
- Add `fixedWorkstation` condition for `/position-trading` path in `AppLayout` (to enable full-height layout)

### 5. `frontend/src/layouts/AppLayout.tsx`
- Already handles `fixedWorkstation` — just need the path added in App.tsx

---

## Key Architecture Decisions

1. **No new backend endpoints** — reuse `analyzeOptions`, `fetchMyTickers`, `fetchPositionSessionChart`, `searchTickers`
2. **Single authoritative state** — `selectedRecommendationId` drives both center row highlight and right panel
3. **No frontend calculations** — all scores, confidence, eligibility, POP, EV, payoff come from backend
4. **Theme reuse** — use Tailwind semantic tokens (`bg-surface-card`, `text-primary`, `border-border`, `semantic-bullish`, etc.)
5. **Cache reuse** — use existing `tickerCache` from AppContext
6. **Format utilities** — reuse inline formatting from existing pages (font-mono for prices, tabular-nums for data)

---

## Testing

### Backend tests (existing, unchanged):
- `cd backend && python3 -m unittest discover -s tests -t .`

### Frontend typecheck:
- `cd frontend && tsc --noEmit`

### Manual verification at 1440px and 1920px

---

## Verification Steps

1. `cd backend && python3 -m py_compile backend/main.py backend/models.py backend/storage.py`
2. `cd frontend && tsc --noEmit`
3. `npm --prefix frontend run build` (runs backend tests + tsc + vite build)
4. Start backend: `cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 9000`
5. Start frontend: `cd frontend && npm run dev`
6. Navigate to `/position-trading`
7. Verify three-column layout renders
8. Verify ticker list loads from My Tickers
9. Select a ticker → verify summary bar, chart, recommendations load
10. Click a recommendation → verify right panel updates
11. Verify filters work
12. Verify responsive behavior at 1280px

---

## Implementation Order

1. Create `positionTrading.ts` types
2. Create `usePositionTrading.ts` hook
3. Add `fixedWorkstation` for `/position-trading` in App.tsx
4. Rewrite `TickerPage.tsx` with three-region layout
5. Run typecheck and fix errors
6. Run build
