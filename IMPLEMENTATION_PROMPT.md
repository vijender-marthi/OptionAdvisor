# Systematic Options Trade Advisor — Full Implementation Prompt

Use this prompt to implement the complete Options Trade Advisor system (API + UI) in any tech stack.
The logic, data flows, filtering rules, and scoring system are fully described below.

---

## What This System Does

A user enters a stock ticker (e.g. AAPL, TSLA, SPY). The system:
1. Fetches live price history and options chain from Yahoo Finance
2. Computes 15+ market signals across trend, momentum, volatility, and sentiment
3. Builds trade candidates for up to 8 options strategies
4. Filters each candidate through hard quality gates (delta, R:R, credit %, liquidity)
5. Scores surviving trades on a 0–100 scale across 4 dimensions
6. Returns ranked recommendations with exact strikes, expiry, P&L, probability, and exit plan

No trading execution. No broker integration. Advisory/suggestion only.

---

## API Specification

### Endpoint
```
POST /api/analyze
Content-Type: application/json
```

### Request Body
```json
{
  "ticker": "AAPL",
  "weeks_out": 4
}
```

### Response Shape
```json
{
  "ticker": "AAPL",
  "company_name": "Apple Inc.",
  "sector": "Technology",
  "market_cap": "$2.8T",
  "signals": { ...see Signals object below... },
  "recommendations": [ ...see Recommendation object below... ],
  "calls_chain": [ ...see OptionRow below... ],
  "puts_chain":  [ ...see OptionRow below... ],
  "price_history": [ ...see PricePoint below... ],
  "filters_applied": {
    "min_credit_pct_of_width": 25,
    "short_delta_range": [0.20, 0.32],
    "credit_dte_range": [21, 50],
    "max_bid_ask_spread_pct": 15,
    "min_open_interest": 50
  }
}
```

---

## Data Objects

### Signals Object
All signals computed from 1-year daily price history + live options chain.

```
Signals {
  // Price
  current_price: float
  prev_close: float
  price_change: float
  price_change_pct: float

  // Trend (from moving averages)
  trend: "Bullish" | "Bearish" | "Neutral" | "Mildly Bullish" | "Mildly Bearish"
  trend_strength: "Strong" | "Moderate" | "Weak"
  ma20: float           // 20-day simple moving average
  ma50: float           // 50-day SMA
  ma200: float          // 200-day SMA
  above_ma20: bool
  above_ma50: bool
  above_ma200: bool
  ma50_slope: float     // % change in MA50 over last 10 days
  ma200_slope: float

  // Momentum
  rsi: float            // 14-period RSI (0–100)
  rsi_signal: "Overbought" | "Mildly Overbought" | "Neutral" | "Mildly Oversold" | "Oversold"
  macd: float           // MACD line (EMA12 - EMA26)
  macd_signal_line: float  // 9-period EMA of MACD
  macd_histogram: float
  macd_crossover: "Bullish" | "Bearish" | "None"

  // Volatility
  current_iv: float     // Median implied vol of near-the-money options (%)
  hv_20: float          // 20-day historical/realized volatility (annualized %)
  hv_60: float          // 60-day historical volatility
  iv_rank: float        // 0–100: where IV sits within its 52-week range
  iv_percentile: float  // % of past year days where IV was lower than today
  iv_vs_hv: float       // current_iv - hv_20 (positive = IV premium over realized)
  iv_environment: "High" | "Elevated" | "Moderate" | "Low" | "Very Low"

  // Sentiment
  put_call_ratio: float   // total put volume / total call volume
  pcr_signal: "Bullish" | "Neutral" | "Bearish"
  iv_skew: float          // avg IV of 10% OTM puts minus avg IV of 10% OTM calls
  skew_signal: "High Fear" | "Normal" | "Low Fear"

  // Composite
  directional_bias: "Bullish" | "Bearish" | "Neutral"
  bias_confidence: int    // 0–100
  volatility_regime: "Sell Premium" | "Buy Premium" | "Neutral"
}
```

### Recommendation Object
```
Recommendation {
  rank: int
  strategy: string        // e.g. "Iron Condor", "Bull Call Spread"
  bias: string            // "Bullish" | "Bearish" | "Neutral" | "Bullish/Neutral" etc.
  legs: OptionLeg[]
  expiry: string          // "YYYY-MM-DD"
  dte: int                // days to expiry

  // Financials (all per share; multiply by 100 for per contract)
  net_credit: float       // positive = credit received, negative = debit paid
  spread_width: float     // for spreads: distance between strikes
  max_profit: float
  max_loss: float
  risk_reward_ratio: float  // max_loss / max_profit
  credit_pct_of_width: float  // for credit spreads: net_credit / spread_width * 100

  breakeven_lower: float
  breakeven_upper: float    // 999 = unlimited (for directional strategies)

  short_leg_delta: float    // delta of the short/primary strike
  prob_of_profit: float     // 0–1 (1 - short_leg_delta for credit strategies)
  prob_of_max_loss: float   // 0–1
  expected_value: float     // (PoP * max_profit) - (PoL * max_loss)

  passes_rr_filter: bool
  passes_liquidity_filter: bool
  passes_credit_filter: bool

  scores: {
    signal_score: int    // 0–40
    structure_score: int // 0–30
    liquidity_score: int // 0–20
    iv_fit_score: int    // 0–10
    total_score: int     // 0–100
  }

  rationale: string       // plain English explanation of why this trade fits
  exit_plan: string       // when to take profit / stop loss / time exit
  warnings: string[]      // any quality concerns (wide spreads, low OI, etc.)
}
```

### OptionLeg Object
```
OptionLeg {
  action: "BUY" | "SELL"
  option_type: "CALL" | "PUT"
  strike: float
  expiry: string
  delta: float
  mid_price: float
  bid: float
  ask: float
  iv: float               // implied volatility in %
  oi: int                 // open interest
  volume: int
  bid_ask_spread_pct: float  // (ask - bid) / mid * 100
}
```

### OptionRow Object (for chain display)
```
OptionRow {
  strike: float
  last_price: float
  bid: float
  ask: float
  volume: int
  open_interest: int
  implied_volatility: string   // e.g. "32.5%"
  delta?: float
}
```

### PricePoint Object
```
PricePoint {
  date: string     // "YYYY-MM-DD"
  close: float
  ma20: float
  ma50: float
  ma200: float
}
```

---

## Signal Computation Logic

### Trend Classification
```
if price > MA50 > MA200 AND ma50_slope > 0  → "Bullish", "Strong"
if price > MA50 > MA200                      → "Bullish", "Moderate"
if price > MA50 AND price > MA200            → "Mildly Bullish", "Moderate"
if price > MA50                              → "Mildly Bullish", "Weak"
if price < MA50 < MA200 AND ma50_slope < 0  → "Bearish", "Strong"
if price < MA50 < MA200                      → "Bearish", "Moderate"
if price < MA50 AND price < MA200            → "Mildly Bearish", "Moderate"
if price < MA50                              → "Mildly Bearish", "Weak"
else                                         → "Neutral", "Weak"
```

### RSI (14-period)
```
delta = daily price changes
avg_gain = rolling 14-period mean of positive deltas
avg_loss = rolling 14-period mean of absolute negative deltas
RS = avg_gain / avg_loss
RSI = 100 - (100 / (1 + RS))

RSI signal:
≥ 75 → "Overbought"
≥ 65 → "Mildly Overbought"
≤ 25 → "Oversold"
≤ 35 → "Mildly Oversold"
else → "Neutral"
```

### MACD
```
EMA12 = 12-period exponential moving average of close
EMA26 = 26-period EMA
MACD line = EMA12 - EMA26
Signal line = 9-period EMA of MACD line
Histogram = MACD - Signal

Crossover detection:
  histogram crosses above 0 → "Bullish"
  histogram crosses below 0 → "Bearish"
  else → "None"
```

### IV Rank (52-week)
```
Use 20-day rolling historical volatility as IV proxy:
  daily_returns = pct_change(close)
  hv_series = rolling(20).std(daily_returns) * sqrt(252) * 100

iv_rank = (current_iv - min(hv_series)) / (max(hv_series) - min(hv_series)) * 100
iv_rank is clamped to [0, 100]
```

### IV Percentile
```
iv_percentile = (count of days where hv < current_iv) / total_days * 100
```

### Current IV from Options Chain
```
Take all near-the-money options (within 5% of current price, both calls and puts)
current_iv = median(implied_volatility) * 100
```

### IV Skew
```
Put skew = avg IV of puts with strike ~10% below price
Call skew = avg IV of calls with strike ~10% above price
iv_skew = put_skew - call_skew  (positive = fear, puts expensive)
```

### Directional Bias Scoring
```
Start with bull_score = 0, bear_score = 0

Trend (weight 40):
  Bullish → bull_score += 40
  Mildly Bullish → bull_score += 25
  Bearish → bear_score += 40
  Mildly Bearish → bear_score += 25

RSI (weight 25):
  ≤ 30 → bull_score += 25  (oversold = bullish reversal)
  ≤ 45 → bull_score += 10
  ≥ 70 → bear_score += 25  (overbought = bearish reversal)
  ≥ 55 → bear_score += 10

MACD crossover (weight 20):
  Bullish → bull_score += 20
  Bearish → bear_score += 20

PCR (weight 15, contrarian):
  PCR > 1.3 → bull_score += 15  (too many puts = contrarian bullish)
  PCR > 1.1 → bull_score += 7
  PCR < 0.7 → bear_score += 15
  PCR < 0.9 → bear_score += 7

Result:
  bias = whichever of bull/bear is higher (or "Neutral" if tied)
  confidence = clamp((winner - loser) / 100 * 100 + 20, 0, 95)
```

### Volatility Regime
```
iv_rank >= 50 AND iv_vs_hv > 0  → "Sell Premium"
iv_rank < 35 OR iv_vs_hv < -5  → "Buy Premium"
else                            → "Neutral"
```

---

## Strike Selection — Delta-Based (not hardcoded %)

The engine selects strikes by targeting specific delta ranges.
If the options chain includes delta values, use them directly.
If not, approximate using Black-Scholes simplified formula:

```
Target delta ranges:
  Credit spread short leg:  delta 0.20 – 0.32
  Debit spread long leg:    delta 0.40 – 0.55
  Iron condor short legs:   delta 0.15 – 0.25

Delta to OTM% approximation (when delta unavailable):
  Use median IV from chain and DTE=30 as approximation:
  T = DTE / 365
  z_score lookup by target delta:
    0.50 → 0.00,  0.45 → 0.13,  0.40 → 0.25,  0.35 → 0.39
    0.30 → 0.52,  0.25 → 0.67,  0.20 → 0.84,  0.15 → 1.04
    0.10 → 1.28,  0.05 → 1.65
  OTM% ≈ iv_median * sqrt(T) * z_score * 100
```

---

## Expiry Selection

```
Credit spreads target:  21–50 DTE (sweet spot for theta decay)
Debit spreads target:   20–40 DTE
Straddles target:       14–35 DTE

Selection: find the expiry date closest to the midpoint of the target range.
If no expiry falls within range, relax: take nearest expiry beyond DTE_MIN - 5.
```

---

## Strategy Construction

### 1. Long Call
```
Trigger: directional_bias is Bullish OR RSI ≤ 30, AND iv_rank < 50
Strike: find call with delta in [0.40, 0.55]
Expiry: debit target (20–40 DTE)
net_credit = -mid_price (debit paid)
max_loss = mid_price
max_profit = unlimited (display as cost * 10)
breakeven = strike + mid_price
prob_of_profit ≈ 1 - delta
```

### 2. Long Put
```
Trigger: directional_bias is Bearish OR RSI ≥ 70, AND iv_rank < 50
Strike: find put with delta in [-0.55, -0.40] (abs delta 0.40–0.55)
Expiry: debit target
net_credit = -mid_price
max_loss = mid_price
breakeven = strike - mid_price
prob_of_profit ≈ abs(delta)
```

### 3. Bull Call Spread (Debit)
```
Trigger: directional_bias includes Bullish
Buy leg:  call with delta [0.40, 0.55]
Sell leg: call with delta [0.20, 0.32]
Ensure buy_strike < sell_strike
net_debit = buy_mid - sell_mid
spread_width = sell_strike - buy_strike
max_profit = spread_width - net_debit
max_loss = net_debit
breakeven = buy_strike + net_debit
prob_of_profit ≈ 1 - sell_leg_delta
```

### 4. Bear Put Spread (Debit)
```
Trigger: directional_bias includes Bearish
Buy leg:  put with abs_delta [0.40, 0.55]
Sell leg: put with abs_delta [0.20, 0.32]
Ensure buy_strike > sell_strike
net_debit = buy_mid - sell_mid
spread_width = buy_strike - sell_strike
max_profit = spread_width - net_debit
max_loss = net_debit
breakeven = buy_strike - net_debit
```

### 5. Bull Put Spread (Credit)
```
Trigger: directional_bias is NOT Bearish, AND iv_rank ≥ 50
Sell leg: put with delta [0.20, 0.32]
Buy leg:  put at distance = (price - sell_strike) below sell_strike
net_credit = sell_mid - buy_mid
spread_width = sell_strike - buy_strike
max_profit = net_credit
max_loss = spread_width - net_credit
credit_pct_of_width = net_credit / spread_width * 100
breakeven = sell_strike - net_credit
prob_of_profit ≈ 1 - sell_delta
```

### 6. Bear Call Spread (Credit)
```
Trigger: directional_bias is NOT Bullish, AND iv_rank ≥ 50
Sell leg: call with delta [0.20, 0.32]
Buy leg:  call at same distance above sell_strike
net_credit = sell_mid - buy_mid
spread_width = buy_strike - sell_strike
max_profit = net_credit
max_loss = spread_width - net_credit
breakeven = sell_strike + net_credit
prob_of_profit ≈ 1 - sell_delta
```

### 7. Iron Condor
```
Trigger: directional_bias is Neutral, AND iv_rank ≥ 50
Put side:  sell put delta [0.15, 0.25], buy put 1 wing-width below
Call side: sell call delta [0.15, 0.25], buy call 1 wing-width above
net_credit = sum of all four mid prices (sells minus buys)
max_loss = max(put_width, call_width) - net_credit
credit_pct = net_credit / max_wing * 100
breakeven_lower = put_sell_strike - net_credit
breakeven_upper = call_sell_strike + net_credit
prob_of_profit ≈ 1 - put_delta - call_delta (floor at 0.40)
```

### 8. Long Straddle
```
Trigger: iv_rank < 50, directional_bias is Neutral
Strike: ATM (closest to current price) for both call and put
total_cost = call_mid + put_mid
max_loss = total_cost
breakeven_lower = strike - total_cost
breakeven_upper = strike + total_cost
prob_of_profit ≈ 0.40 (straddles are inherently costly)
```

---

## Expected Value Formula

```
EV = (prob_of_profit * max_profit) - ((1 - prob_of_profit) * max_loss)

A positive EV means the trade has statistical edge.
A negative EV means you are paying more in expected value than you receive.
```

---

## Hard Filters (Reject if failing)

```
1. Credit filter (credit spreads and condors only):
   net_credit / spread_width * 100 >= 25%
   → Reject or warn if credit is less than 25% of spread width

2. Liquidity filter (per leg):
   bid_ask_spread_pct = (ask - bid) / mid * 100
   bid_ask_spread_pct <= 15%
   open_interest >= 50
   volume >= 5 (or OI as fallback)
   mid_price >= $0.05

3. Minimum net credit/debit:
   net_credit (or debit) must be > $0 after accounting for both legs

4. Strike ordering:
   Bull call spread: buy_strike < sell_strike
   Bear put spread:  buy_strike > sell_strike
   Iron condor:      put_buy < put_sell < call_sell < call_buy
```

---

## Composite Scoring System (0–100)

Every trade that passes filters is scored across 4 dimensions:

### Signal Score (0–40): How well signals align with the strategy

```
Perfect fit conditions by strategy:
  Long Call:        Bullish bias + Buy Premium regime
  Long Put:         Bearish bias + Buy Premium regime
  Bull Call Spread: Bullish bias
  Bear Put Spread:  Bearish bias
  Bull Put Spread:  Not Bearish + Sell Premium regime
  Bear Call Spread: Not Bullish + Sell Premium regime
  Iron Condor:      Neutral bias + Sell Premium regime
  Long Straddle:    Neutral bias + Buy Premium regime

Perfect fit  → +40 points
Partial fit  → +22 points
Poor fit     → +5 points
MACD bonus   → +5 if crossover matches direction
Confidence   → +0 to +10 based on bias_confidence
```

### Structure Score (0–30): Quality of the trade's mechanics

```
Expected Value (0–12):
  EV > 0.10/share  → 12
  EV > 0.05/share  → 8
  EV > 0           → 4
  EV ≤ 0           → 0

Risk/Reward ratio (0–10):
  ratio ≤ 2.0  → 10
  ratio ≤ 3.0  → 7
  ratio ≤ 4.0  → 4
  ratio > 4.0  → 1

Credit % of width (0–8, credit spreads only):
  ≥ 35% → 8
  ≥ 28% → 5
  ≥ 20% → 2
  < 20% → 0
```

### Liquidity Score (0–20): How tradeable the options are

```
Start at 20. Deduct per leg:
  bid_ask_spread > 10% → -8 per leg
  bid_ask_spread > 6%  → -4 per leg
  bid_ask_spread > 3%  → -1 per leg
  OI < 100             → -4 per leg
  OI < 500             → -1 per leg
Floor at 0.
```

### IV Fit Score (0–10): How well IV environment suits the strategy

```
Credit strategies (Iron Condor, Bull Put, Bear Call):
  iv_rank ≥ 65 AND iv_vs_hv > 5  → 10
  iv_rank ≥ 50                    → 7
  iv_rank ≥ 35                    → 3
  iv_rank < 35                    → 0

Debit strategies (Long Call/Put, Spreads, Straddle):
  iv_rank < 25 AND iv_vs_hv < 0  → 10
  iv_rank < 40                    → 7
  iv_rank < 55                    → 4
  iv_rank ≥ 55                    → 1
```

**Total = signal + structure + liquidity + iv_fit (0–100)**
Sort descending. Return top 6.

---

## Exit Plans

### Credit Strategies (Iron Condor, Bull Put Spread, Bear Call Spread)
```
Take profit: Close when position gains 50% of max profit
Stop loss:   Close if loss reaches 2× credit received
Time exit:   Always close at 21 DTE regardless of P&L
             (gamma risk accelerates in final 3 weeks)
```

### Debit Strategies (Long Call/Put, Bull/Bear Spread, Straddle)
```
Take profit: Close when position gains 100% of cost basis (2× your money)
Stop loss:   Close if position loses 50% of premium paid
Time exit:   Close at 21 DTE if target not reached
```

---

## UI Requirements

### Layout
Single page, dark theme. From top to bottom:
1. **Header bar** — app name + version badge
2. **Ticker Input** — text input + expiry dropdown + Analyze button + quick ticker buttons
3. **Market Overview** — price header, 6-metric grid, vol regime banner, MA badges
4. **Signal Panel** — collapsible, full 4-section signal breakdown
5. **Recommendations** — ranked cards, count badge
6. **Tabs** — Price Chart | Options Chain
7. **Filters Panel** — collapsible, shows engine parameters used
8. **Footer disclaimer**

### Color Scheme
```
Backgrounds:    #030712 (page), #111827 (cards), #1f2937 (inner sections)
Bullish/Profit: #22c55e (green-500)
Bearish/Loss:   #ef4444 (red-500)
Neutral:        #f59e0b (amber-500)
Accent:         #7c3aed / #8b5cf6 (violet)
Info:           #3b82f6 (blue)
Text:           #f1f5f9 (primary), #9ca3af (muted), #6b7280 (very muted)
Card border:    #374151
```

### Recommendation Card (most important component)
Each card shows in order:
1. Rank badge + strategy name + bias pill + DTE badge + score/100
2. Filter pass/fail badges (R:R ✅, Credit % ✅/⚠️, Liquidity ✅)
3. Warnings list (if any)
4. Legs table: Action | Type | Strike | Expiry | Delta | Mid | IV | OI | BA%
5. Risk metrics: Max Profit | Max Loss | Breakeven | Expiry (2×2 or 4-col grid)
6. Probability & EV: Prob Profit % | Prob Max Loss % | EV $/share (colored by sign)
7. R:R visual bar: proportional green (profit zone) / red (loss zone) bar
8. Credit % annotation for credit spreads
9. Score breakdown: 4 progress bars (signal/40, structure/30, liquidity/20, iv_fit/10)
10. Rationale box (💡 plain English)
11. Exit plan (🚪 collapsible)

### Signal Panel (collapsible)
4 sections in 2-column grid:
- Trend Signals: all MA values, slopes, MACD values + crossover badge
- Momentum: RSI gauge bar (0–100 with colored zones + dot), MACD histogram
- Volatility: IV/HV values, IV rank progress bar, iv_vs_hv colored
- Sentiment: PCR + signal, IV skew + interpretation

### Price Chart
1-year daily close price + MA20 (blue dashed) + MA50 (amber dashed) + MA200 (red dashed)
Area fill under price line, dark background, tooltip on hover.

### Options Chain Table
Two tabs (Calls / Puts). Columns: Strike | Last | Bid | Ask | Volume | OI | IV | Delta
Highlight ATM row (closest strike to current price).

---

## Data Source

Use Yahoo Finance (free, no API key needed):
- Python: `yfinance` library
  - `yf.Ticker(ticker).history(period="1y")` for price history
  - `yf.Ticker(ticker).options` for available expiry dates
  - `yf.Ticker(ticker).option_chain(expiry)` for calls and puts
  - `yf.Ticker(ticker).info` for company name, sector, market cap
- JavaScript/Node: `yahoo-finance2` npm package
- Other languages: any Yahoo Finance API wrapper or direct API calls to
  `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}`
  `https://query1.finance.yahoo.com/v7/finance/options/{ticker}`

---

## Error Handling

```
Ticker not found:         404 — "No data found for ticker '{ticker}'"
No options available:     404 — "No options data available for '{ticker}'"
Insufficient history:     400 — "Need at least 60 days of price history"
No trades pass filters:   Return empty recommendations array (not an error)
yfinance fetch failure:   500 with descriptive message
```

On the UI side:
- Show spinner with "Fetching data · Computing signals · Scoring trades" during load
- Show red error card with message + retry hint on failure
- Show amber card explaining why no trades passed filters (list the filter thresholds)

---

## Important Implementation Notes

1. Filter options chain to strikes between 75%–130% of current price before all processing
2. Use mid price = (bid + ask) / 2 for all premium calculations. Handle missing bid/ask gracefully.
3. Never show "Infinity" — cap display at 999 or "Unlimited" string
4. "Per contract" = per share × 100. Always show both.
5. iv_rank uses historical volatility as an IV proxy (since yfinance doesn't store historical IV).
   This is an approximation — real IV rank requires a paid data source.
6. Delta in yfinance options chain is often missing (NaN). Always implement the
   OTM% approximation fallback using the delta→z-score lookup table above.
7. The frontend should proxy API calls through the dev server to avoid CORS issues in development.
8. Probability of profit for credit strategies: PoP ≈ 1 - abs(short_delta)
   This is a well-known approximation. It assumes delta ≈ probability of expiring ITM.

---

## Disclaimer
This system is for educational and informational purposes only.
It does not constitute financial advice.
Options trading involves significant risk of loss.
Always do your own research and consult a licensed financial advisor before trading.
