# Cursor Prompt — Options Trade Advisor Frontend (React + TypeScript)

Paste everything below this line into Cursor's AI chat (Cmd+L) after opening the `frontend/` folder.

---

Build the complete React + TypeScript frontend for a Systematic Options Trade Advisor.
The Python FastAPI backend is already running at `http://localhost:8000`.
The main endpoint is `POST /api/analyze` — see the data shapes below.

## Tech Stack
- React 18 + TypeScript + Vite
- Tailwind CSS (dark theme throughout)
- Recharts for all charts
- Axios for API calls
- Lucide React for icons

---

## TypeScript Types (types/index.ts)

```typescript
export interface OptionLeg {
  action: "BUY" | "SELL";
  option_type: "CALL" | "PUT";
  strike: number;
  expiry: string;
  delta: number;
  mid_price: number;
  bid: number;
  ask: number;
  iv: number;
  oi: number;
  volume: number;
  bid_ask_spread_pct: number;
}

export interface ScoreBreakdown {
  signal_score: number;    // 0-40
  structure_score: number; // 0-30
  liquidity_score: number; // 0-20
  iv_fit_score: number;    // 0-10
  total_score: number;     // 0-100
}

export interface Recommendation {
  rank: number;
  strategy: string;
  bias: string;
  legs: OptionLeg[];
  expiry: string;
  dte: number;

  net_credit: number;
  spread_width: number;
  max_profit: number;
  max_loss: number;
  risk_reward_ratio: number;
  credit_pct_of_width: number;

  breakeven_lower: number;
  breakeven_upper: number;
  short_leg_delta: number;
  prob_of_profit: number;
  prob_of_max_loss: number;
  expected_value: number;

  passes_rr_filter: boolean;
  passes_liquidity_filter: boolean;
  passes_credit_filter: boolean;

  scores: ScoreBreakdown;
  rationale: string;
  exit_plan: string;
  warnings: string[];
}

export interface Signals {
  current_price: number;
  prev_close: number;
  price_change: number;
  price_change_pct: number;

  trend: string;
  trend_strength: string;
  ma20: number;
  ma50: number;
  ma200: number;
  above_ma20: boolean;
  above_ma50: boolean;
  above_ma200: boolean;
  ma50_slope: number;
  ma200_slope: number;

  rsi: number;
  rsi_signal: string;
  macd: number;
  macd_signal_line: number;
  macd_histogram: number;
  macd_crossover: string;

  current_iv: number;
  hv_20: number;
  hv_60: number;
  iv_rank: number;
  iv_percentile: number;
  iv_vs_hv: number;
  iv_environment: string;

  put_call_ratio: number;
  pcr_signal: string;
  iv_skew: number;
  skew_signal: string;

  directional_bias: string;
  bias_confidence: number;
  volatility_regime: string;
}

export interface OptionRow {
  strike: number;
  last_price: number;
  bid: number;
  ask: number;
  volume: number;
  open_interest: number;
  implied_volatility: string;
  delta?: number;
}

export interface PricePoint {
  date: string;
  close: number;
  ma20: number;
  ma50: number;
  ma200: number;
}

export interface AnalyzeResponse {
  ticker: string;
  company_name: string;
  sector: string;
  market_cap: string;
  signals: Signals;
  recommendations: Recommendation[];
  calls_chain: OptionRow[];
  puts_chain: OptionRow[];
  price_history: PricePoint[];
  filters_applied: Record<string, any>;
}
```

---

## API Client (api/client.ts)

```typescript
import axios from "axios";
import { AnalyzeResponse } from "../types";

const api = axios.create({ baseURL: "http://localhost:8000" });

export const analyzeOptions = async (
  ticker: string,
  weeksOut: number
): Promise<AnalyzeResponse> => {
  const { data } = await api.post<AnalyzeResponse>("/api/analyze", {
    ticker,
    weeks_out: weeksOut,
  });
  return data;
};
```

---

## App.tsx

Single-page layout with dark theme (bg-gray-950). Structure:
1. Top header bar with app name
2. `<TickerInput>` — always visible at top
3. When data is loaded: full dashboard below
   - `<MarketOverview signals={data.signals} ticker={data.ticker} company={data.company_name} />`
   - `<SignalPanel signals={data.signals} />` — collapsible
   - `<RecommendationList recommendations={data.recommendations} currentPrice={data.signals.current_price} />`
   - Tabs: "Options Chain" → `<OptionsChainTable>` | "Price Chart" → `<PriceChart>`
   - `<FiltersPanel filters={data.filters_applied} />` — collapsible, shows what filters were applied
4. Footer disclaimer

State: `{ data, loading, error }` using useState. No routing needed.

---

## TickerInput Component

Props: `onAnalyze: (ticker: string, weeksOut: number) => void`, `loading: boolean`

Layout: horizontal row with:
- Text input (uppercase, auto-trim) — placeholder "AAPL, TSLA, SPY..."
- Dropdown: "2 weeks / 3 weeks / 4 weeks / 6 weeks / 8 weeks" (value = number)
- "Analyze" button — violet/purple primary, shows spinner when loading
- Keyboard shortcut: Enter key triggers analyze

Style: bg-gray-900 card, rounded-xl, p-4

---

## MarketOverview Component

Props: `signals: Signals`, `ticker: string`, `company: string`, `sector: string`, `marketCap: string`

**Price header:**
- Large ticker + company name
- Current price in large bold text
- Price change colored: green if positive, red if negative, with ▲/▼ arrow

**Metrics grid (6 columns):**
Each metric is a small card (bg-gray-800, rounded-lg):

| Metric | Value | Color Logic |
|---|---|---|
| Trend | signals.trend | green=Bullish, red=Bearish, amber=Neutral |
| Trend Strength | signals.trend_strength | green=Strong, amber=Moderate, gray=Weak |
| RSI | signals.rsi | red if ≥70, green if ≤30, gray otherwise |
| IV Rank | signals.iv_rank + "%" | red if ≥65, amber if ≥50, green if <35 |
| IV vs HV | signals.iv_vs_hv + "%" | red if positive (IV > HV), green if negative |
| Directional Bias | signals.directional_bias | with confidence badge: "Bullish (72%)" |

**Volatility regime banner** below metrics:
- "Sell Premium" → amber warning banner with text explaining high IV environment
- "Buy Premium" → green success banner explaining low IV
- "Neutral" → blue info banner

**Moving Average summary** (small pill badges):
- "Above MA20" / "Below MA20" (green/red)
- "Above MA50" / "Below MA50"
- "Above MA200" / "Below MA200"
- MA50 slope: "Rising +0.3%" / "Falling -0.2%"

---

## SignalPanel Component (collapsible)

Props: `signals: Signals`

Title: "📡 Full Signal Breakdown" with expand/collapse toggle

When expanded, show 4 sections in a 2-column grid:

**Trend Signals:**
- MA20: $xxx, MA50: $xxx, MA200: $xxx
- MA50 slope: +0.3% (↑ rising) colored
- MACD: value, Signal line: value, Histogram: value
- MACD crossover badge: "Bullish Crossover" (green) / "Bearish Crossover" (red) / "None" (gray)

**Momentum:**
- RSI gauge (0-100 horizontal bar) colored:
  - 0-30: green zone (oversold)
  - 30-70: gray zone (neutral)
  - 70-100: red zone (overbought)
  - current RSI shown as a dot on the bar
- RSI signal badge
- MACD histogram bar (positive = green, negative = red)

**Volatility:**
- Current IV: xx%
- HV 20-day: xx%, HV 60-day: xx%
- IV vs HV: +x.x% (red) — this is the premium/discount of implied over realized
- IV Rank: xx% — horizontal progress bar (green=low, amber=mid, red=high)
- IV Percentile: xx%
- IV Environment badge

**Sentiment:**
- Put/Call Ratio with colored badge (>1.2 = bearish, <0.8 = bullish)
- PCR signal explanation
- IV Skew: x.xx% — explanation (positive = fear, negative = greed)
- Skew signal badge

---

## RecommendationList Component

Props: `recommendations: Recommendation[]`, `currentPrice: number`

Header: "🎯 Trade Recommendations" + subtitle showing how many passed filters.

Map each recommendation to `<RecommendationCard>`.

If empty: show "No trades passed all filters" with explanation.

---

## RecommendationCard Component

Props: `rec: Recommendation`, `currentPrice: number`

This is the most important component. Make it comprehensive.

**Left border color:** green=Bullish, red=Bearish, amber=Neutral
**Background:** bg-gray-900, rounded-xl

**Header row:**
- Rank badge (#1, #2...) in violet
- Strategy name (large, bold)
- Bias badge (colored pill: ↑ BULLISH / ↓ BEARISH / ↔ NEUTRAL)
- DTE badge ("37 DTE")
- Total score badge (e.g. "Score: 84/100") — color: green ≥75, amber ≥55, red <55

**Filter badges row** (show pass/fail with icons):
- ✅ / ❌ R:R Filter
- ✅ / ❌ Credit ≥ 25% (only for credit spreads)
- ✅ / ❌ Liquidity OK
If any warnings exist, show them in a subtle amber warning box below.

**Legs table** — monospace font, each leg on its own row:
```
BUY  CALL  $185.00  exp 2025-05-16  Δ 0.45  mid $3.20  IV 28.5%  OI 1,205  BA-spread 4.2%
SELL CALL  $195.00  exp 2025-05-16  Δ 0.22  mid $1.40  IV 26.1%  OI 890    BA-spread 5.1%
```
BUY = green text, SELL = red text

**Risk Metrics grid** (4 columns):

| Max Profit | Max Loss | Breakeven | Expiry |
|---|---|---|---|
| $xxx/share ($xxx/contract) | $xxx/share | $xxx – $xxx | 2025-05-16 |

**Probability & EV grid** (3 columns):

| Prob of Profit | Prob Max Loss | Expected Value |
|---|---|---|
| 72% | 3.2% | +$0.18/share |

Expected Value colored: green if positive, red if negative.

**Risk/Reward display:**
- For credit spreads: "Credit: $1.45 = 29% of $5 width ✅" or "⚠️ Only 18% of width"
- Visual R:R bar: horizontal bar showing profit zone vs loss zone proportionally
- Text: "Risk $3.55 to make $1.45 (1:2.4)" — color the ratio (≤2.5 green, ≤4 amber, >4 red)

**Score Breakdown** — small horizontal bar chart (4 colored segments):
- Signal fit: xx/40 (violet)
- Structure: xx/30 (blue)
- Liquidity: xx/20 (green)
- IV fit: xx/10 (amber)
- Total: xx/100

**Rationale box** (bg-gray-800, rounded-lg):
- 💡 icon + rationale text in muted color

**Exit Plan box** (bg-indigo-950, rounded-lg):
- 🚪 icon + exit plan text — collapsible, collapsed by default

---

## OptionsChainTable Component

Props: `calls: OptionRow[]`, `puts: OptionRow[]`, `currentPrice: number`

Two tabs: Calls / Puts

For each tab, render a table with columns:
`Strike | Last | Bid | Ask | Volume | Open Interest | IV | Delta`

Highlight the ATM row (closest strike to currentPrice) with a subtle violet background.
Color the Strike column: calls > currentPrice = OTM (muted), calls ≤ currentPrice = ITM (slightly highlighted)

---

## PriceChart Component

Props: `history: PricePoint[]`

Use recharts `ComposedChart`:
- Area chart for Close price (fill with subtle gradient, stroke violet)
- Line for MA20 (dashed, blue, thin)
- Line for MA50 (dashed, amber, thin)
- Line for MA200 (dashed, red, thin)
- Legend showing all 4
- Tooltip on hover showing date + all 4 values
- X-axis: show dates every ~30 days, formatted as "Jan 25"
- Y-axis: auto-formatted, dollar prefix
- Dark background (bg-gray-900), white text for labels

---

## FiltersPanel Component (collapsible)

Props: `filters: Record<string, any>`

Show a small collapsed panel at the bottom titled "⚙️ Engine Filters Applied".
When expanded, display each filter as a labeled row:
- Min credit % of width: 25%
- Short leg delta target: 0.20 – 0.32
- Credit DTE range: 21 – 50 days
- Max bid-ask spread: 15%
- Min open interest: 50

---

## Styling Rules
- Background: bg-gray-950 (page), bg-gray-900 (cards), bg-gray-800 (inner sections)
- Text: text-gray-100 (primary), text-gray-400 (muted), text-gray-500 (very muted)
- Green: #22c55e (bullish, profit, buy, pass)
- Red: #ef4444 (bearish, loss, sell, fail)
- Amber: #f59e0b (neutral, warning, moderate)
- Violet: #7c3aed / #8b5cf6 (accent, rank badge, score)
- Blue: #3b82f6 (info, MA20)
- All cards: rounded-xl border border-gray-800
- Recommendation card left border: 4px solid — green/red/amber based on bias
- Monospace font (font-mono) for all strike prices, premiums, and financial figures
- Smooth transitions on hover: hover:bg-gray-800 transition-colors duration-150

---

## Error & Loading States
- Loading: full-page centered spinner (animate-spin) with "Analyzing {ticker}..." text
- Error: red bordered card with error message and retry button
- Empty recommendations: amber card explaining no trades passed filters with the filter thresholds listed

---

## package.json dependencies
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "axios": "^1.7.0",
    "recharts": "^2.12.0",
    "lucide-react": "^0.383.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

---

## Important Notes
- All components in separate files under src/components/
- Use TypeScript strict mode — no `any` types except where genuinely needed
- All financial values display 2 decimal places minimum
- "Per contract" = per share × 100 — always show both
- Never show "Infinity" — cap at 999 or "Unlimited" string
- Mobile responsive — stack columns on small screens
- Add a sticky disclaimer footer: "For educational purposes only. Not financial advice."
