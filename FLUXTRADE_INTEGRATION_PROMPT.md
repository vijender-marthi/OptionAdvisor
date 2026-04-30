# FluxTrade — Decision Lab → Option Advisory Page
## Full Implementation Prompt

---

## Context

You are building the **Option Advisory** page inside the **Decision Lab** section of the **FluxTrade** application. FluxTrade is a professional trading analytics platform. Decision Lab is its research and analysis workspace, housing tools like backtests, screeners, and strategy builders.

The Option Advisory page is a self-contained feature that lets a trader enter any US stock ticker and receive:
- Live options data ingestion
- Multi-signal market analysis (trend, RSI, MACD, IV rank, PCR, skew)
- Systematic trade recommendations with full risk metrics
- An interactive P&L-at-expiration chart
- A spread width selector ($5 / $10 / Auto)

The existing standalone implementation lives at `/OptionAdvisor/` and is fully functional. Your job is to **lift it into FluxTrade's UI shell** — matching FluxTrade's design system, navigation structure, and data layer conventions — without altering the core analysis logic.

---

## Architecture Overview

```
FluxTrade/
├── frontend/                     ← Main React/TypeScript app (Vite + Tailwind)
│   └── src/
│       ├── app/                  ← App shell, routing, layout
│       ├── pages/
│       │   └── DecisionLab/
│       │       └── OptionAdvisory/   ← NEW: transplant here
│       │           ├── index.tsx            ← Page entry point
│       │           ├── components/
│       │           │   ├── TickerInput.tsx
│       │           │   ├── MarketOverview.tsx
│       │           │   ├── SignalPanel.tsx
│       │           │   ├── RecommendationCard.tsx
│       │           │   ├── OptionsChainTable.tsx
│       │           │   ├── PriceChart.tsx
│       │           │   └── OptionProfitCalculator.tsx
│       │           ├── api/
│       │           │   └── client.ts
│       │           └── types/
│       │               └── index.ts
└── backend/                      ← FastAPI service (Python 3.11+)
    └── option_advisory/          ← NEW: transplant here
        ├── router.py             ← FastAPI router (prefix: /api/decision-lab/options)
        ├── models.py
        ├── engine.py
        └── analysis.py
```

---

## Backend Integration

### 1. Create the router

Move `main.py`'s `/api/analyze` endpoint into a FastAPI `APIRouter` at:
```
GET/POST /api/decision-lab/options/analyze
```

```python
# backend/option_advisory/router.py
from fastapi import APIRouter
router = APIRouter(prefix="/api/decision-lab/options", tags=["Option Advisory"])

@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    ...  # identical logic from existing main.py
```

Register the router in FluxTrade's main FastAPI app:
```python
from option_advisory.router import router as options_router
app.include_router(options_router)
```

### 2. Request model (already implemented)

```python
class AnalyzeRequest(BaseModel):
    ticker: str
    weeks_out: int = 4
    spread_width: Optional[int] = None   # 5, 10, or None (auto)
```

### 3. Dependencies

Add to `requirements.txt`:
```
yfinance>=0.2.40
pandas>=2.0
numpy>=1.26
scipy>=1.11
```

---

## Frontend Integration

### 1. Route

Register the page in FluxTrade's router:
```tsx
// Inside DecisionLab routes
{ path: 'option-advisory', element: <OptionAdvisoryPage /> }
```

Add to the Decision Lab sidebar/nav:
```tsx
{ label: 'Option Advisory', icon: <TrendingUpIcon />, href: '/decision-lab/option-advisory' }
```

### 2. API base URL

Update `api/client.ts` to use FluxTrade's API base URL:
```ts
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL + '/decision-lab/options' })
```

### 3. Design system

Apply FluxTrade's design tokens instead of the standalone app's raw Tailwind:
- Replace `bg-gray-900` / `bg-gray-950` with FluxTrade's surface tokens (e.g. `bg-surface-primary`, `bg-surface-secondary`)
- Replace `text-violet-400` / `border-violet-500` with FluxTrade's brand accent tokens
- Replace `rounded-2xl` with FluxTrade's border-radius scale if different
- Match FluxTrade's font family and weight conventions

If FluxTrade uses a component library (e.g. shadcn/ui, Radix, or a custom DS), replace:
- Raw `<select>` → FluxTrade `<Select>` component
- Raw `<button>` → FluxTrade `<Button>` component
- Card wrappers → FluxTrade `<Card>` / `<Panel>` component

### 4. Page header

The page should render inside FluxTrade's standard page shell with:
```tsx
<PageHeader
  section="Decision Lab"
  title="Option Advisory"
  subtitle="Systematic options analysis with multi-signal scoring"
/>
```

---

## Component Inventory

All components are production-ready and only need styling token substitution.

### TickerInput
- Ticker text input + weeks-out selector + **spread width toggle ($5 / $10 / Auto)**
- Default: `$5` selected
- Hint text updates based on selected width
- Quick-pick buttons: AAPL, TSLA, SPY, QQQ, NVDA, AMZN, MSFT

### MarketOverview
- Company name, sector, market cap
- Price + change badge (green/red)
- Directional bias badge with confidence bar
- IV environment + volatility regime tags

### SignalPanel
- Trend + strength
- MA20/50/200 above/below indicators
- RSI gauge with signal label
- MACD crossover signal
- IV rank/percentile bar
- Put/call ratio + skew

### RecommendationCard
- Strategy name + bias badge + rank
- Key metrics: Net Credit, Max Profit, Max Loss, R:R, PoP, EV
- Score breakdown (signal / structure / liquidity / IV fit)
- Leg-by-leg breakdown (strike, expiry, delta, mid, bid/ask)
- Rationale + exit plan expandable section
- Warning tags

### PriceChart (Recharts)
- 1-year OHLC close area chart
- MA20 (blue dashed), MA50 (amber dashed), MA200 (red dashed)
- Sampled to every 3rd point for performance

### OptionsChainTable
- Calls / Puts tabs
- Columns: Strike, Last, Bid, Ask, Volume, OI, IV, Delta
- Current-price row highlighted

### OptionProfitCalculator ← NEW (built in this session)
- Trade selector buttons (one per recommendation)
- P&L-at-expiration Recharts line chart
  - X-axis: stock price (±35% from current)
  - Y-axis: P&L in dollars
  - Green line for profit zones, red for loss
  - Dashed purple reference line: current price
  - Amber reference lines: breakevens
- Key stats strip: Max Profit / Max Loss / Net Credit / PoP
- Leg breakdown table

---

## Spread Width Feature

The spread width selector is wired end-to-end:

**Frontend → TickerInput state → `onAnalyze(ticker, weeks, spreadWidth)` → `analyzeOptions(ticker, weeks, spreadWidth)` → POST body `{ spread_width: 5 | 10 | null }`**

**Backend → `AnalyzeRequest.spread_width` → `run_engine(..., spread_width_override)` → `_build_credit_spread(..., spread_width_override)` / `_build_iron_condor(..., spread_width_override)`**

When `spread_width_override` is set, the buy leg is pinned exactly N dollars from the short leg. When `null`, the engine uses the dynamic OTM-distance heuristic.

The active setting is echoed back in `filters_applied.spread_width` in the response.

---

## Engine Constants (do not change)

| Constant | Value | Meaning |
|---|---|---|
| `MIN_CREDIT_PCT_OF_WIDTH` | 25% | Minimum credit collected as % of spread width |
| `TARGET_SHORT_DELTA_CREDIT` | (0.25, 0.40) | Delta range for short leg of credit spreads |
| `DTE_CREDIT_MIN` | 21 | Min days to expiry for credit trades |
| `DTE_CREDIT_MAX` | 45 | Max days to expiry for credit trades |
| `DTE_DEBIT_MIN` | 30 | Min DTE for debit trades |
| `DTE_DEBIT_MAX` | 60 | Max DTE for debit trades |

---

## Scoring System

Each trade candidate receives a composite score (0–40) across four dimensions:

| Dimension | Max | What it measures |
|---|---|---|
| Signal score | 10 | Direction alignment (RSI, MACD, MA trend) |
| Structure score | 10 | R:R, credit %, EV |
| Liquidity score | 10 | OI, volume, bid-ask spread |
| IV fit score | 10 | IV rank vs strategy type (credit favors high IV, debit favors low) |

Trades are ranked by total score descending.

---

## P&L Calculation Logic

For each leg at expiration price S:

```
BUY  CALL: P&L = max(S - strike, 0) - premium
SELL CALL: P&L = premium - max(S - strike, 0)
BUY  PUT:  P&L = max(strike - S, 0) - premium
SELL PUT:  P&L = premium - max(strike - S, 0)
```

`premium = leg.mid_price` (mid of bid/ask at time of analysis)

Net P&L = sum of all legs. Chart plots this across S ∈ [currentPrice × 0.65, currentPrice × 1.35] in 120 steps.

---

## Testing Checklist

- [ ] `/api/decision-lab/options/analyze` responds with valid JSON for SPY, AAPL, TSLA
- [ ] Spread width $5: buy leg is ≤$5 from short leg on credit spreads
- [ ] Spread width $10: buy leg is ≤$10 from short leg on credit spreads
- [ ] Spread width Auto: buy leg uses OTM-distance heuristic
- [ ] P&L chart: profit at max-profit zone matches `rec.max_profit`
- [ ] P&L chart: loss at max-loss zone matches `-rec.max_loss`
- [ ] Breakeven reference lines land where P&L ≈ 0
- [ ] Page renders within FluxTrade's Decision Lab nav
- [ ] All tokens/components match FluxTrade design system
- [ ] TypeScript compiles with `tsc --noEmit`

---

## Files to Copy from `/OptionAdvisor/`

```
backend/analysis.py       → FluxTrade/backend/option_advisory/analysis.py
backend/engine.py         → FluxTrade/backend/option_advisory/engine.py
backend/models.py         → FluxTrade/backend/option_advisory/models.py
# backend/main.py         → convert to router.py (see above)

frontend/src/components/  → all 7 .tsx files
frontend/src/api/         → client.ts
frontend/src/types/       → index.ts
```

---

*Generated by Claude for FluxTrade Option Advisory integration — 2026-04-29*
