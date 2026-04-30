# FluXTrade — Cursor Implementation Prompts

Two self-contained prompts. Paste **Prompt A** into Cursor when working inside `fluxtrade-api/`, and **Prompt B** when inside `fluxtrade/`.

---

---

# PROMPT A — fluxtrade-api (Python + FastAPI backend)

> Paste everything from here through "END OF PROMPT A" into Cursor's AI chat when the `fluxtrade-api/` folder is open.

---

Build a complete Python + FastAPI backend called **fluxtrade-api** for a Systematic Options Trade Advisor.

## Project structure to create

```
fluxtrade-api/
├── main.py
├── models.py
├── analysis.py
├── engine.py
├── long_options_scanner.py    ← NEW
├── credit_spread_scanner.py   ← NEW
└── requirements.txt
```

## requirements.txt

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
yfinance>=0.2.38
pandas>=2.2.0
numpy>=1.26.0
pydantic>=2.0.0
```

Run with: `uvicorn main:app --reload --port 8080`

---

## What the system does

A user submits a stock ticker. The API:
1. Fetches 1-year price history + live options chain from Yahoo Finance (`yfinance`)
2. Computes 15+ market signals (trend, momentum, volatility, sentiment)
3. The **Decision Lab** (`/api/analyze`) runs all 8 strategies through a unified engine
4. The **Options Scanner** (`/api/scan`) runs two independent scanner services in parallel:
   - Long Options Scanner (Long Call, Long Put, Bull Call Spread, Bear Put Spread)
   - Credit Spread Scanner (Bull Put Spread, Bear Call Spread, Iron Condor)
5. Each scanner uses its own signal weights, scoring rubric, and decision labels

**CRITICAL ARCHITECTURE RULE:**
- `engine.py` is used exclusively by `/api/analyze`. Do NOT touch it when adding scanner logic.
- `long_options_scanner.py` has NO knowledge of credit % filters.
- `credit_spread_scanner.py` has NO knowledge of breakout/momentum requirements.
- Each scanner scores independently with its own 0–100 rubric.

---

## models.py — Pydantic models

### Existing models (keep exactly as-is — used by /api/analyze)

```python
from pydantic import BaseModel
from typing import Optional

class AnalyzeRequest(BaseModel):
    ticker: str
    weeks_out: int = 4

class OptionLegOut(BaseModel):
    action: str
    option_type: str
    strike: float
    expiry: str
    delta: float
    mid_price: float
    bid: float
    ask: float
    iv: float
    oi: int
    volume: int
    bid_ask_spread_pct: float

class ScoreBreakdown(BaseModel):
    signal_score: int
    structure_score: int
    liquidity_score: int
    iv_fit_score: int
    total_score: int

class RecommendationOut(BaseModel):
    rank: int
    strategy: str
    bias: str
    legs: list[OptionLegOut]
    expiry: str
    dte: int
    net_credit: float
    spread_width: float
    max_profit: float
    max_loss: float
    risk_reward_ratio: float
    credit_pct_of_width: float
    breakeven_lower: float
    breakeven_upper: float
    short_leg_delta: float
    prob_of_profit: float
    prob_of_max_loss: float
    expected_value: float
    passes_rr_filter: bool
    passes_liquidity_filter: bool
    passes_credit_filter: bool
    scores: ScoreBreakdown
    rationale: str
    exit_plan: str
    warnings: list[str]

class OptionRowOut(BaseModel):
    strike: float
    last_price: float
    bid: float
    ask: float
    volume: int
    open_interest: int
    implied_volatility: str
    delta: Optional[float] = None

class PricePoint(BaseModel):
    date: str
    close: float
    ma20: float
    ma50: float
    ma200: float

class SignalsOut(BaseModel):
    current_price: float
    prev_close: float
    price_change: float
    price_change_pct: float
    trend: str
    trend_strength: str
    ma20: float
    ma50: float
    ma200: float
    above_ma20: bool
    above_ma50: bool
    above_ma200: bool
    ma50_slope: float
    ma200_slope: float
    rsi: float
    rsi_signal: str
    macd: float
    macd_signal_line: float
    macd_histogram: float
    macd_crossover: str
    current_iv: float
    hv_20: float
    hv_60: float
    iv_rank: float
    iv_percentile: float
    iv_vs_hv: float
    iv_environment: str
    put_call_ratio: float
    pcr_signal: str
    iv_skew: float
    skew_signal: str
    directional_bias: str
    bias_confidence: int
    volatility_regime: str

class AnalyzeResponse(BaseModel):
    ticker: str
    company_name: str
    sector: str
    market_cap: str
    signals: SignalsOut
    recommendations: list[RecommendationOut]
    calls_chain: list[OptionRowOut]
    puts_chain: list[OptionRowOut]
    price_history: list[PricePoint]
    filters_applied: dict
```

### New scanner models (add below existing models)

```python
# ── Long Options Scanner ──────────────────────────────────────────────────────

class LongScoreBreakdown(BaseModel):
    trend_score: int       # 0–25  directional alignment
    momentum_score: int    # 0–20  RSI timing (HIGH RSI does NOT block — just lowers score)
    breakout_score: int    # 0–20  MACD + price action
    volume_score: int      # 0–15  volume confirmation vs 20-day average  ← NEW
    liquidity_score: int   # 0–12  bid-ask spread + OI
    iv_fit_score: int      # 0–8   LOW IV favors buying premium
    total_score: int       # 0–100 (25+20+20+15+12+8)

class LongOptionCandidate(BaseModel):
    ticker: str
    strategy: str           # "Long Call" | "Long Put" | "Bull Call Spread" | "Bear Put Spread" | "Long Straddle"
    decision: str           # "TRADE" | "WATCH" | "SETUP" | "SKIP"
    score: int              # 0–100
    scores: LongScoreBreakdown
    legs: list[OptionLegOut]
    expiry: str
    dte: int
    premium_paid: float     # net debit per share (positive number)
    max_loss: float         # same as premium_paid for single-leg; capped for spreads
    max_profit: float       # "Unlimited" sentinel = 9999
    breakeven: float        # breakeven price for single-leg; lower breakeven for spreads
    breakeven_upper: float  # 9999 if unlimited upside
    prob_of_profit: float   # 0–1
    expected_value: float
    iv_rank: float
    iv_environment: str
    rsi: float
    rsi_note: str           # e.g. "RSI 72 — extended but not blocked; watch for continuation"
    macd_crossover: str
    reason: str             # plain-English explanation of the decision
    risk_notes: list[str]   # warnings specific to long options (e.g. "IV elevated — premium expensive")
    exit_plan: str

# ── Credit Spread Scanner ─────────────────────────────────────────────────────

class CreditScoreBreakdown(BaseModel):
    iv_score: int          # 0–25  HIGH IV favors selling premium
    pop_score: int         # 0–25  probability of profit
    credit_score: int      # 0–20  credit received as % of width
    buffer_score: int      # 0–15  distance of short strike from current price
    liquidity_score: int   # 0–15  bid-ask + OI per leg
    total_score: int       # 0–100

class CreditSpreadCandidate(BaseModel):
    ticker: str
    strategy: str           # "Bull Put Spread" | "Bear Call Spread" | "Iron Condor"
    decision: str           # "TRADE" | "WATCH" | "SKIP"
    score: int              # 0–100
    scores: CreditScoreBreakdown
    legs: list[OptionLegOut]
    expiry: str
    dte: int
    net_credit: float
    spread_width: float
    credit_pct_of_width: float
    max_profit: float
    max_loss: float
    breakeven_lower: float
    breakeven_upper: float
    short_leg_delta: float
    prob_of_profit: float
    expected_value: float
    iv_rank: float
    iv_environment: str
    reason: str
    risk_notes: list[str]   # warnings specific to credit trades
    exit_plan: str

# ── Scan request / response ───────────────────────────────────────────────────

class ScanRequest(BaseModel):
    ticker: str
    weeks_out: int = 4

class ScanResponse(BaseModel):
    ticker: str
    company_name: str
    sector: str
    market_cap: str
    signals: SignalsOut
    long_options: list[LongOptionCandidate]
    credit_spreads: list[CreditSpreadCandidate]
    price_history: list[PricePoint]
```

---

## analysis.py — Signal computation (UNCHANGED)

Implement `generate_signals(hist, calls, puts)` exactly as described. This is shared by both
the Decision Lab and the Scanner endpoints.

### Trend (from moving averages)
```
ma20  = hist["Close"].rolling(20).mean().iloc[-1]
ma50  = hist["Close"].rolling(50).mean().iloc[-1]
ma200 = hist["Close"].rolling(200).mean().iloc[-1]
ma50_slope  = % change of MA50 over last 10 days
ma200_slope = % change of MA200 over last 10 days
price = hist["Close"].iloc[-1]

Classification:
  price > ma50 > ma200 AND ma50_slope > 0  → "Bullish",  "Strong"
  price > ma50 > ma200                      → "Bullish",  "Moderate"
  price > ma50 AND price > ma200            → "Mildly Bullish", "Moderate"
  price > ma50                              → "Mildly Bullish", "Weak"
  price < ma50 < ma200 AND ma50_slope < 0  → "Bearish",  "Strong"
  price < ma50 < ma200                      → "Bearish",  "Moderate"
  price < ma50 AND price < ma200            → "Mildly Bearish", "Moderate"
  price < ma50                              → "Mildly Bearish", "Weak"
  else                                      → "Neutral",  "Weak"
```

### RSI (14-period)
```
delta     = hist["Close"].diff()
avg_gain  = delta.clip(lower=0).rolling(14).mean()
avg_loss  = (-delta.clip(upper=0)).rolling(14).mean()
rs        = avg_gain / avg_loss
rsi       = 100 - (100 / (1 + rs)).iloc[-1]

rsi_signal:
  ≥ 75 → "Overbought"
  ≥ 65 → "Mildly Overbought"
  ≤ 25 → "Oversold"
  ≤ 35 → "Mildly Oversold"
  else → "Neutral"
```

### MACD
```
ema12 = hist["Close"].ewm(span=12, adjust=False).mean()
ema26 = hist["Close"].ewm(span=26, adjust=False).mean()
macd_line   = ema12 - ema26
signal_line = macd_line.ewm(span=9, adjust=False).mean()
histogram   = macd_line - signal_line

macd_crossover:
  histogram crosses from negative to positive → "Bullish"
  histogram crosses from positive to negative → "Bearish"
  else → "None"
```

### Volatility signals
```
daily_returns = hist["Close"].pct_change().dropna()
hv_20 = daily_returns.rolling(20).std().iloc[-1] * np.sqrt(252) * 100
hv_60 = daily_returns.rolling(60).std().iloc[-1] * np.sqrt(252) * 100
hv_series = daily_returns.rolling(20).std() * np.sqrt(252) * 100

ntm_calls = calls[(calls["strike"] >= price*0.95) & (calls["strike"] <= price*1.05)]
ntm_puts  = puts[(puts["strike"] >= price*0.95)  & (puts["strike"] <= price*1.05)]
all_iv = pd.concat([ntm_calls["impliedVolatility"], ntm_puts["impliedVolatility"]]).dropna()
current_iv = float(all_iv.median()) * 100 if not all_iv.empty else hv_20

iv_rank       = clamp((current_iv - hv_series.min()) / (hv_series.max() - hv_series.min()) * 100, 0, 100)
iv_percentile = (hv_series < current_iv).sum() / len(hv_series) * 100
iv_vs_hv      = current_iv - hv_20

iv_environment:
  current_iv ≥ 40 → "High"
  current_iv ≥ 30 → "Elevated"
  current_iv ≥ 20 → "Moderate"
  current_iv ≥ 12 → "Low"
  else            → "Very Low"
```

### Sentiment signals
```
put_call_ratio = puts["volume"].sum() / calls["volume"].sum()  (handle div-by-zero)

pcr_signal:
  pcr > 1.2 → "Bearish"
  pcr < 0.8 → "Bullish"
  else      → "Neutral"

put_skew  = avg impliedVolatility of puts  with strike ≈ price * 0.90
call_skew = avg impliedVolatility of calls with strike ≈ price * 1.10
iv_skew   = (put_skew - call_skew) * 100

skew_signal:
  iv_skew > 5  → "High Fear"
  iv_skew < -2 → "Low Fear"
  else         → "Normal"
```

### Directional bias
```
bull_score = 0, bear_score = 0

Trend weight 40:
  "Bullish"        → bull_score += 40
  "Mildly Bullish" → bull_score += 25
  "Bearish"        → bear_score += 40
  "Mildly Bearish" → bear_score += 25

RSI weight 25:
  rsi ≤ 30 → bull_score += 25
  rsi ≤ 45 → bull_score += 10
  rsi ≥ 70 → bear_score += 25
  rsi ≥ 55 → bear_score += 10

MACD crossover weight 20:
  "Bullish" → bull_score += 20
  "Bearish" → bear_score += 20

PCR weight 15 (contrarian):
  pcr > 1.3 → bull_score += 15
  pcr > 1.1 → bull_score += 7
  pcr < 0.7 → bear_score += 15
  pcr < 0.9 → bear_score += 7

directional_bias = "Bullish" if bull > bear, "Bearish" if bear > bull, else "Neutral"
bias_confidence  = clamp((abs(bull_score - bear_score) / 100 * 100 + 20), 0, 95)
```

### Volatility regime
```
iv_rank ≥ 50 AND iv_vs_hv > 0  → "Sell Premium"
iv_rank < 35 OR iv_vs_hv < -5  → "Buy Premium"
else                            → "Neutral"
```

### Price history
```
price_history = list of last 252 trading days with:
  {"date": date_str, "close": close, "ma20": ma20, "ma50": ma50, "ma200": ma200}
  (NaN MAs → 0.0)
```

---

## engine.py — Decision Lab trade engine (UNCHANGED)

Used ONLY by `/api/analyze`. Do NOT modify when adding scanner logic.

### Constants
```python
MIN_CREDIT_PCT_OF_WIDTH = 25
TARGET_SHORT_DELTA_CREDIT = (0.20, 0.32)
TARGET_LONG_DELTA_DEBIT   = (0.40, 0.55)
TARGET_SHORT_DELTA_CONDOR = (0.15, 0.25)
DTE_CREDIT_MIN, DTE_CREDIT_MAX     = 21, 50
DTE_DEBIT_MIN,  DTE_DEBIT_MAX      = 20, 40
DTE_STRADDLE_MIN, DTE_STRADDLE_MAX = 14, 35
MAX_BA_SPREAD_PCT = 15.0
MIN_OPEN_INTEREST = 50
MIN_VOLUME        = 5
```

### Delta lookup helper
```python
DELTA_Z = {
    0.50: 0.00, 0.45: 0.13, 0.40: 0.25, 0.35: 0.39,
    0.30: 0.52, 0.25: 0.67, 0.20: 0.84, 0.15: 1.04,
    0.10: 1.28, 0.05: 1.65
}

def approx_delta(iv_median, dte, target_delta):
    T = dte / 365
    z = DELTA_Z.get(round(target_delta, 2), 0.67)
    return iv_median / 100 * np.sqrt(T) * z
```

### Helpers: find_strike, select_expiry, make_leg
(Same as original — see full descriptions below in scanner files for reference implementation)

### 8 strategy builders (Long Call, Long Put, Bull Call Spread, Bear Put Spread, Bull Put Spread, Bear Call Spread, Iron Condor, Long Straddle)

#### 1. Long Call
```
Trigger: bias is Bullish OR rsi ≤ 30, AND iv_rank < 50
Leg:     BUY CALL with delta [0.40, 0.55]
Expiry:  20–40 DTE
net_credit      = -mid_price
max_loss        = mid_price
max_profit      = mid_price * 10
breakeven_lower = strike + mid_price
breakeven_upper = 999
prob_of_profit  ≈ 1 - abs(delta)
```

#### 2. Long Put
```
Trigger: bias is Bearish OR rsi ≥ 70, AND iv_rank < 50
Leg:     BUY PUT with abs_delta [0.40, 0.55]
net_credit = -mid_price
max_loss   = mid_price
max_profit = mid_price * 10
```

#### 3. Bull Call Spread (Debit)
```
Trigger: bias includes Bullish
Buy leg:  CALL delta [0.40, 0.55]
Sell leg: CALL delta [0.20, 0.32], strike > buy_strike
net_debit    = buy_mid - sell_mid
spread_width = sell_strike - buy_strike
max_profit   = spread_width - net_debit
max_loss     = net_debit
breakeven    = buy_strike + net_debit
prob_profit  ≈ 1 - sell_delta
```

#### 4. Bear Put Spread (Debit)
```
Trigger: bias includes Bearish
Buy leg:  PUT abs_delta [0.40, 0.55]
Sell leg: PUT abs_delta [0.20, 0.32], strike < buy_strike
net_debit    = buy_mid - sell_mid
spread_width = buy_strike - sell_strike
max_profit   = spread_width - net_debit
max_loss     = net_debit
breakeven    = buy_strike - net_debit
```

#### 5. Bull Put Spread (Credit)
```
Trigger: bias is NOT Bearish, AND iv_rank ≥ 50
Sell leg: PUT delta [0.20, 0.32]
Buy leg:  PUT below sell_strike
net_credit          = sell_mid - buy_mid
spread_width        = sell_strike - buy_strike
credit_pct_of_width = net_credit / spread_width * 100
breakeven_lower     = sell_strike - net_credit
```

#### 6. Bear Call Spread (Credit)
```
Trigger: bias is NOT Bullish, AND iv_rank ≥ 50
Sell leg: CALL delta [0.20, 0.32]
Buy leg:  CALL above sell_strike
net_credit      = sell_mid - buy_mid
breakeven_upper = sell_strike + net_credit
```

#### 7. Iron Condor
```
Trigger: bias is Neutral, AND iv_rank ≥ 50
Put  sell: delta [0.15, 0.25]  |  Put  buy: put_sell_strike  - wing
Call sell: delta [0.15, 0.25]  |  Call buy: call_sell_strike + wing
net_credit      = (put_sell_mid - put_buy_mid) + (call_sell_mid - call_buy_mid)
max_loss        = max(put_width, call_width) - net_credit
breakeven_lower = put_sell_strike  - net_credit
breakeven_upper = call_sell_strike + net_credit
prob_profit     ≈ max(1 - put_delta - call_delta, 0.40)
```

#### 8. Long Straddle
```
Trigger: iv_rank < 50, bias is Neutral
Strike: ATM
total_cost      = call_mid + put_mid
breakeven_lower = strike - total_cost
breakeven_upper = strike + total_cost
prob_profit     ≈ 0.40
```

### Hard filters
```
1. net_credit / net_debit > 0
2. Credit spreads + condors: credit_pct_of_width ≥ 25%
3. Per leg: BA spread ≤ 15%, OI ≥ 50, volume ≥ 5, mid ≥ 0.05
4. Strike ordering enforced
```

### Unified Scoring (0–100)
#### Signal score (0–40)
```
Perfect fit  → +40 | Partial fit → +22 | Poor fit → +5
MACD matches direction → +5 bonus
Confidence bonus: bias_confidence / 10 points (0–10)
```

#### Structure score (0–30)
```
EV: > 0.10 → 12 | > 0.05 → 8 | > 0 → 4 | else → 0
R:R ratio: ≤ 2.0 → 10 | ≤ 3.0 → 7 | ≤ 4.0 → 4 | > 4.0 → 1
Credit % (credit only): ≥ 35% → 8 | ≥ 28% → 5 | ≥ 20% → 2 | < 20% → 0
```

#### Liquidity score (0–20)
```
Start 20. Per leg: BA > 10% → -8 | > 6% → -4 | > 3% → -1 | OI < 100 → -4 | OI < 500 → -1
```

#### IV fit score (0–10)
```
Credit: iv_rank ≥ 65 AND iv_vs_hv > 5 → 10 | ≥ 50 → 7 | ≥ 35 → 3 | < 35 → 0
Debit:  iv_rank < 25 AND iv_vs_hv < 0 → 10 | < 40 → 7 | < 55 → 4 | ≥ 55 → 1
```

Sort descending. Return top 6.

### Exit plans & rationale (same as original)

---

## long_options_scanner.py — NEW FILE

**PURPOSE:** Find directional long call / long put opportunities.
**STRATEGIES COVERED:** Long Call, Long Put, Bull Call Spread, Bear Put Spread, Long Straddle.
**DOES NOT USE:** credit % of width filter, spread width filter, or credit-spread logic of any kind.

**SHARED HELPERS — import from engine.py, do not redefine:**
```python
from engine import make_leg, safe_float, safe_int, approx_delta, select_expiry, DELTA_Z
```

```python
"""
long_options_scanner.py
========================
Independent scanner for directional debit/premium-buying strategies.

Rules:
- RSI being high does NOT automatically block a long call. It lowers the momentum score.
  A strong trend with high RSI still gets a partial momentum score.
- Low IV favors buying premium (cheaper options). It boosts iv_fit_score.
- High IV does NOT block long options. It lowers iv_fit_score only.
- No credit % filter. No spread width constraint from the credit world.
- Decisions: TRADE / WATCH / SETUP / SKIP
"""

# ── Constants ──────────────────────────────────────────────────────────────────
LO_TARGET_LONG_DELTA  = (0.40, 0.55)   # long (buying) leg delta range
LO_TARGET_SHORT_DELTA = (0.20, 0.32)   # short (selling) leg in debit spreads
LO_DTE_MIN, LO_DTE_MAX = 20, 45        # target DTE for long options
LO_MAX_BA_SPREAD_PCT   = 15.0          # max bid-ask spread %
LO_MIN_OI              = 50            # min open interest per leg
LO_MIN_MID             = 0.05          # min mid price per leg

# Decision thresholds
LO_TRADE_THRESHOLD = 70
LO_WATCH_THRESHOLD = 50
LO_SETUP_THRESHOLD = 35
# < 35 → SKIP


def score_long_option(signals, legs, strategy) -> LongScoreBreakdown:
    """
    Score a long options trade on 6 independent dimensions (total = 100).
    Returns a LongScoreBreakdown with each component and total.

    ┌─────────────────────────────┬──────┐
    │ Dimension                   │  Max │
    ├─────────────────────────────┼──────┤
    │ 1. Trend alignment          │   25 │
    │ 2. RSI timing               │   20 │
    │ 3. Breakout / MACD          │   20 │
    │ 4. Volume confirmation      │   15 │  ← NEW
    │ 5. Liquidity                │   12 │
    │ 6. IV environment fit       │    8 │
    └─────────────────────────────┴──────┘
    Total                               100

    DIMENSION 1 — Trend alignment (0–25)
    ──────────────────────────────────────
    Calls / Bull spreads:
      trend == "Bullish"        → 25
      trend == "Mildly Bullish" → 17
      trend == "Neutral"        → 7
      trend == "Mildly Bearish" → 2
      trend == "Bearish"        → 0
    Puts / Bear spreads: mirror the above, inverted.
    Straddle: Neutral = 25, Mildly Bullish/Bearish = 17, Bullish/Bearish = 8
      (Straddle profits from a big move in either direction; neutral is ideal,
       but a directional trend is still acceptable — it just reduces premium efficiency.)

    DIMENSION 2 — RSI timing (0–20)
    ─────────────────────────────────
    NOTE: High RSI NEVER blocks a call. It reduces the score.
    A mildly extended RSI on a strong trend is still a watchable setup.

    For CALLS / Bull spreads:
      rsi ≤ 40  → 20  (oversold — ideal entry, fear = cheap calls)
      rsi ≤ 52  → 16
      rsi ≤ 62  → 12
      rsi ≤ 70  → 7   (mildly overbought — extended but valid in strong trend)
      rsi ≤ 78  → 3
      rsi > 78  → 1   (very extended — warn, do not block)

    For PUTS / Bear spreads:
      rsi ≥ 60  → 20  (overbought — ideal for puts)
      rsi ≥ 48  → 16
      rsi ≥ 38  → 12
      rsi ≥ 30  → 7
      rsi ≥ 22  → 3
      rsi < 22  → 1   (very oversold — warn, do not block)

    For STRADDLE: RSI near 50 = ideal (neither side overbought nor oversold)
      45 ≤ rsi ≤ 55 → 20
      40 ≤ rsi < 45 OR 55 < rsi ≤ 62 → 14
      35 ≤ rsi < 40 OR 62 < rsi ≤ 70 → 8
      rsi < 35 OR rsi > 70 → 3  (not blocked — extreme RSI implies directionality)

    DIMENSION 3 — Breakout / MACD momentum (0–20)
    ─────────────────────────────────────────────────
    For CALLS / Bull spreads:
      macd_crossover == "Bullish"                       → 20
      macd_histogram > 0 (rising but no crossover yet)  → 13
      macd_crossover == "None" AND histogram ≤ 0        → 5
      macd_crossover == "Bearish"                        → 1

    For PUTS / Bear spreads:
      macd_crossover == "Bearish"                        → 20
      macd_histogram < 0                                 → 13
      macd_crossover == "None" AND histogram ≥ 0         → 5
      macd_crossover == "Bullish"                        → 1

    For STRADDLE: Volatility compression (pre-explosion setup) is ideal.
      macd_histogram is very near zero (abs < 0.05 × price) → 20  (coiled spring)
      histogram trending toward zero                         → 13
      fresh crossover in either direction                    → 8   (move may have started)
      strong directional histogram                           → 3   (trend underway, straddle costly)

    DIMENSION 4 — Volume confirmation (0–15)
    ──────────────────────────────────────────
    Compute avg_volume_20 = 20-day average daily volume from price history.
    Compare latest day's volume (or last 3-day avg if latest is incomplete).

    For CALLS / PUTS / spreads:
      latest_volume ≥ 1.5× avg_volume_20 → 15  (strong volume surge confirms move)
      latest_volume ≥ 1.2× avg_volume_20 → 11
      latest_volume ≥ 0.9× avg_volume_20 → 7   (average volume — acceptable)
      latest_volume ≥ 0.6× avg_volume_20 → 3   (low volume — weak confirmation)
      latest_volume < 0.6× avg_volume_20 → 0   (very low volume — warn)

    For STRADDLE: Volume signals pending catalyst.
      Same scoring as above.

    NOTE: volume data comes from hist["Volume"] in the price history DataFrame.
    avg_volume_20 = hist["Volume"].rolling(20).mean().iloc[-1]
    latest_volume = hist["Volume"].iloc[-1]

    DIMENSION 5 — Liquidity (0–12)
    ─────────────────────────────────
    Start at 12. Deductions per leg:
      BA spread > 10% → -5  |  > 6% → -3  |  > 3% → -1
      OI < 100 → -3  |  OI < 500 → -1
    Floor at 0.

    DIMENSION 6 — IV environment fit (0–8)
    ────────────────────────────────────────
    Low IV FAVORS buying premium (cheap options). High IV does not block — it just costs more.
      iv_rank < 20  → 8  (very cheap premium — ideal)
      iv_rank < 35  → 6
      iv_rank < 50  → 4
      iv_rank < 65  → 2
      iv_rank ≥ 65  → 0  (expensive premium — not a blocker, just not ideal)
    """
    pass  # implement the scoring logic


def build_long_call(signals, calls, puts, opt_dates):
    """
    Build a Long Call candidate if conditions are met.
    No credit filter. No iv_rank upper-bound trigger (iv_rank < 50 is a soft preference,
    not a hard gate — if trend is very strong, still build and let scoring decide).
    
    Strike: call closest to delta 0.45 (prefer ATM-ish)
    Expiry: 20–45 DTE midpoint
    
    Returns LongOptionCandidate or None if chain has no suitable strike.
    """
    pass


def build_long_put(signals, calls, puts, opt_dates):
    """
    Build a Long Put candidate.
    Same rules as Long Call, inverted for puts.
    """
    pass


def build_bull_call_spread(signals, calls, puts, opt_dates):
    """
    Build a Bull Call Spread (debit).
    Buy leg:  call delta [0.40, 0.55]
    Sell leg: call delta [0.20, 0.32], must be above buy_strike
    
    premium_paid = buy_mid - sell_mid
    max_loss     = premium_paid
    max_profit   = spread_width - premium_paid
    breakeven    = buy_strike + premium_paid
    
    DO NOT apply credit_pct_of_width filter. This is a debit trade.
    The width of the spread simply determines max profit — not a quality gate.
    """
    pass


def build_bear_put_spread(signals, calls, puts, opt_dates):
    """
    Build a Bear Put Spread (debit).
    Buy leg:  put abs_delta [0.40, 0.55]
    Sell leg: put abs_delta [0.20, 0.32], must be below buy_strike
    
    premium_paid = buy_mid - sell_mid
    max_loss     = premium_paid
    max_profit   = spread_width - premium_paid
    breakeven    = buy_strike - premium_paid
    """
    pass


def build_long_straddle(signals, calls, puts, opt_dates):
    """
    Build a Long Straddle candidate.
    This strategy lives in the Long Options Scanner, NOT the Decision Lab only.
    It is a premium-buying trade — appropriate when IV is low and a large move is expected.

    Trigger: ALWAYS attempt to build (neutral bias is ideal but not required).
             Let scoring determine suitability via the straddle-specific dimension rules.

    Strike: ATM — use the call and put strike closest to current_price.
    Expiry: 14–35 DTE midpoint (shorter DTE = cheaper, but gamma risk is higher).

    Both legs: BUY CALL + BUY PUT at the same ATM strike.
    total_cost      = call_mid + put_mid
    max_loss        = total_cost
    max_profit      = 9999 (unlimited — display as "Unlimited")
    breakeven       = strike - total_cost   (downside)
    breakeven_upper = strike + total_cost   (upside)
    premium_paid    = total_cost
    prob_of_profit  ≈ 0.40  (straddles need a significant move to profit)
    expected_value  = (0.40 * max_profit_capped) - (0.60 * max_loss)
      where max_profit_capped = total_cost * 3 for EV calculation only

    Hard gates (return None if any fail):
      total_cost ≤ 0
      Either leg: BA spread > 15%, OI < 50, mid < 0.05

    NOTE: Do NOT apply the credit_pct_of_width filter. This is a debit trade.
    NOTE: Straddle scoring reverses the directional dimensions — see score_long_option.
    """
    pass


def generate_rsi_note(rsi: float, is_call: bool) -> str:
    """
    Return a human-readable note about RSI timing.
    Never says "blocked". Says "extended" or "ideal" etc.
    Examples:
      "RSI 72 — mildly extended; consider scaling in or waiting for a minor pullback."
      "RSI 35 — approaching oversold; solid timing for a call entry."
      "RSI 82 — overbought; momentum valid but risk of short-term mean reversion. Size down."
    """
    pass


def generate_risk_notes_long(candidate, signals) -> list[str]:
    """
    Produce 0–3 risk notes specific to long options. Examples:
    - "IV Rank 68% — elevated premium cost; use spread instead of naked call to reduce debit."
    - "RSI 80 — overbought; consider waiting for RSI to pull back below 70."
    - "Wide bid-ask spread on buy leg (8.2%) — use limit orders near mid."
    - "Low open interest (34) — may be difficult to exit at fair value."
    """
    pass


def run_long_options_scanner(signals, calls, puts, opt_dates) -> list[LongOptionCandidate]:
    """
    Run all 4 long option builders. Score each. Apply decision threshold.
    Filter out any candidate that is truly unbuildable (no strikes found).
    Sort by score descending. Return all (including SKIP decisions — UI can filter).
    """
    candidates = []
    for builder in [
        build_long_call,
        build_long_put,
        build_bull_call_spread,
        build_bear_put_spread,
        build_long_straddle,      # always attempted — scoring decides suitability
    ]:
        c = builder(signals, calls, puts, opt_dates)
        if c is not None:
            candidates.append(c)
    candidates.sort(key=lambda x: x.score, reverse=True)
    return candidates
```

### Long options exit plan strings
```
Single leg (Long Call / Long Put):
  "Take profit when position gains 100% of premium paid (2× your money).
   Cut loss at 50% of premium paid. Close at 21 DTE if target not reached."

Debit spread (Bull Call / Bear Put):
  "Take profit when spread gains 80% of max profit.
   Cut loss when spread loses 60% of premium paid. Close at 21 DTE."

Long Straddle:
  "Take profit when position gains 100% of total premium paid.
   Cut loss at 40% of total premium paid (straddles decay quickly — be disciplined).
   Close at 14 DTE regardless of P&L; gamma risk and accelerating theta decay make
   straddles dangerous in the final two weeks."
```

---

## credit_spread_scanner.py — NEW FILE

**PURPOSE:** Find premium-selling probability trades.
**STRATEGIES COVERED:** Bull Put Spread, Bear Call Spread, Iron Condor.
**DOES NOT USE:** breakout momentum signals, MACD crossover as a trigger.
**DOES USE directional bias** as a soft adjustment to the buffer score — see Dimension 4 below.

**SHARED HELPERS — import from engine.py, do not redefine:**
```python
from engine import make_leg, safe_float, safe_int, approx_delta, select_expiry, DELTA_Z
```

```python
"""
credit_spread_scanner.py
=========================
Independent scanner for premium-selling / high-probability strategies.

Rules:
- High IV NEVER blocks a credit spread. It may FAVOR them (boosts iv_score).
- Low IV does NOT favor credit spreads (lowers iv_score) but is not a hard block.
- No breakout or MACD requirement. Credit spreads care about probability, not direction.
- Bull Put Spread: non-bearish environment preferred, but bias is a soft preference.
  In a bullish breakout, a Bull Put Spread can still be valid if strikes are safely OTM.
- Decisions: TRADE / WATCH / SKIP  (no SETUP — credit spreads are binary: build or not)
"""

# ── Constants ──────────────────────────────────────────────────────────────────
CS_SHORT_DELTA_MIN  = 0.15          # minimum short leg delta (further OTM = safer)
CS_SHORT_DELTA_MAX  = 0.32          # maximum short leg delta
CS_CONDOR_DELTA_MAX = 0.25          # iron condor short leg delta ceiling
CS_DTE_MIN, CS_DTE_MAX = 21, 50     # credit spread sweet spot for theta
CS_MIN_CREDIT_PCT   = 25.0          # hard minimum: credit must be ≥ 25% of spread width
CS_MAX_BA_SPREAD_PCT = 15.0
CS_MIN_OI            = 50
CS_MIN_MID           = 0.05

# Decision thresholds
CS_TRADE_THRESHOLD = 65
CS_WATCH_THRESHOLD = 45
# < 45 → SKIP


def score_credit_spread(signals, candidate) -> CreditScoreBreakdown:
    """
    Score a credit spread on 5 independent dimensions.

    DIMENSION 1 — IV environment (0–25)
    ──────────────────────────────────────
    High IV FAVORS credit spreads (premium is rich). This is the primary signal.
    IV rank alone does not block a trade — it shifts the score.

      iv_rank ≥ 65 AND iv_vs_hv > 5  → 25  (premium-selling ideal zone)
      iv_rank ≥ 55                   → 20
      iv_rank ≥ 45                   → 14
      iv_rank ≥ 30                   → 7
      iv_rank < 30                   → 2   (low IV → credit is thin, not ideal, not blocked)

    DIMENSION 2 — Probability of profit (0–25)
    ────────────────────────────────────────────
    PoP ≈ 1 - abs(short_leg_delta) for single-side spreads
    PoP ≈ 1 - put_delta - call_delta for iron condor

      PoP ≥ 0.76 → 25
      PoP ≥ 0.70 → 19
      PoP ≥ 0.64 → 12
      PoP ≥ 0.58 → 5
      PoP < 0.58 → 1   (not blocked — but warn)

    DIMENSION 3 — Credit quality (0–20)
    ─────────────────────────────────────
    Credit received as % of spread width.
    NOTE: Candidates must already pass the hard CS_MIN_CREDIT_PCT = 25% gate before scoring.
    This dimension rewards better credit quality; near-minimum credit gets minimal reward.

      credit_pct ≥ 35% → 20
      credit_pct ≥ 30% → 13
      credit_pct ≥ 28% → 6   (above minimum but thin — small reward)
      credit_pct ≥ 25% → 2   (just at the hard minimum — nearly no reward)
      credit_pct < 25% → 0   (filtered out by hard gate; should not reach scoring)

    RATIONALE: A spread at exactly 25% credit barely clears the minimum. Showing it as
    WATCH would be misleading — a score of 2 here ensures it needs strong IV and PoP
    scores to survive above SKIP threshold.

    DIMENSION 4 — Strike safety buffer + directional alignment (0–15)
    ──────────────────────────────────────────────────────────────────
    Base score: how far OTM is the short strike?
    Further OTM = more buffer against adverse moves.

      short_delta ≤ 0.16 → 13  (well OTM — high probability)
      short_delta ≤ 0.20 → 10
      short_delta ≤ 0.25 → 6
      short_delta ≤ 0.30 → 2
      short_delta > 0.30 → 0

    Directional alignment adjustment (applied after base score, clamped to [0, 15]):
    Credit spreads work better when bias is aligned with the direction the spread profits from.
    A Bull Put Spread profits when price stays ABOVE the short put — bullish/neutral bias helps.
    A Bear Call Spread profits when price stays BELOW the short call — bearish/neutral bias helps.
    An Iron Condor profits when price stays RANGE-BOUND — neutral bias is ideal.

    Bull Put Spread:
      directional_bias == "Bullish"        → +2  (tailwind — price moving away from short put)
      directional_bias == "Neutral"        → +0  (no help, no headwind)
      directional_bias == "Mildly Bearish" → -2  (mild headwind)
      directional_bias == "Bearish"        → -4  (headwind — price moving toward short put)

    Bear Call Spread:
      directional_bias == "Bearish"        → +2  (tailwind)
      directional_bias == "Neutral"        → +0
      directional_bias == "Mildly Bullish" → -2
      directional_bias == "Bullish"        → -4  (headwind)

    Iron Condor:
      directional_bias == "Neutral"                                   → +2  (ideal)
      directional_bias in ("Mildly Bullish", "Mildly Bearish")        → -1
      directional_bias == "Bullish" AND trend_strength == "Strong"    → -5  (call side exposed)
      directional_bias == "Bearish" AND trend_strength == "Strong"    → -5  (put side exposed)
      directional_bias in ("Bullish", "Bearish") trend not Strong     → -3

    DIMENSION 5 — Liquidity (0–15)
    ─────────────────────────────────
    Start at 15. Deductions per leg:
      BA spread > 10% → -6  |  > 6% → -3  |  > 3% → -1
      OI < 100 → -3  |  OI < 500 → -1
    Floor at 0.
    """
    pass


def build_bull_put_spread(signals, calls, puts, opt_dates):
    """
    Build a Bull Put Spread candidate.

    Sell leg: PUT with delta [0.20, 0.32]
    Buy  leg: PUT below sell_strike (distance ≈ sell_strike - price * 0.85, or next available)
    
    net_credit          = sell_mid - buy_mid
    spread_width        = sell_strike - buy_strike
    credit_pct_of_width = net_credit / spread_width * 100
    max_profit          = net_credit
    max_loss            = spread_width - net_credit
    breakeven_lower     = sell_strike - net_credit
    
    Hard gates (reject, return None):
      net_credit ≤ 0
      credit_pct_of_width < 25%
      Either leg: BA spread > 15%, OI < 50, mid < 0.05

    Direction preference: preferred when bias is NOT Bearish, but this is NOT enforced
    as a hard gate. Even in a strong bullish breakout, if strikes are safely OTM below
    price, the trade is valid. Let scoring reflect the environment.

    prob_of_profit = 1 - sell_delta
    expected_value = (PoP * max_profit) - ((1 - PoP) * max_loss)
    """
    pass


def build_bear_call_spread(signals, calls, puts, opt_dates):
    """
    Build a Bear Call Spread candidate.

    Sell leg: CALL with delta [0.20, 0.32]
    Buy  leg: CALL above sell_strike
    
    net_credit       = sell_mid - buy_mid
    spread_width     = buy_strike - sell_strike
    breakeven_upper  = sell_strike + net_credit
    
    Hard gates: same as bull put spread (net_credit > 0, credit_pct ≥ 25%, liquidity)

    prob_of_profit = 1 - sell_delta
    """
    pass


def build_iron_condor(signals, calls, puts, opt_dates):
    """
    Build an Iron Condor candidate.

    Put  sell: delta [0.15, 0.25]  →  Put  buy: put_sell_strike  - wing_width
    Call sell: delta [0.15, 0.25]  →  Call buy: call_sell_strike + wing_width
    wing_width = reasonable distance (e.g., 5% of price, or next available strike)
    
    net_credit      = (put_sell_mid - put_buy_mid) + (call_sell_mid - call_buy_mid)
    max_loss        = max(put_width, call_width) - net_credit
    credit_pct      = net_credit / max(put_width, call_width) * 100
    breakeven_lower = put_sell_strike  - net_credit
    breakeven_upper = call_sell_strike + net_credit
    
    Hard gates: net_credit > 0, credit_pct ≥ 25%, all 4 legs pass liquidity

    Preferred when bias is Neutral, but NOT a hard gate.
    During a strong directional breakout, an Iron Condor should score lower (via iv/pop scoring)
    but is not blocked.

    prob_of_profit ≈ max(1 - put_delta - call_delta, 0.40)
    """
    pass


def generate_risk_notes_credit(candidate, signals) -> list[str]:
    """
    Produce 0–3 risk notes specific to credit spreads.

    MANDATORY RULES — always check these, in order:

    1. Iron Condor + Strong directional trend (REQUIRED — never omit):
       if strategy == "Iron Condor":
         if directional_bias == "Bullish" AND trend_strength == "Strong":
           → add "Strong bullish trend — call side exposed. Verify call spread is well above
                  key resistance before trading. Consider Bull Put Spread instead."
         elif directional_bias == "Bearish" AND trend_strength == "Strong":
           → add "Strong bearish trend — put side exposed. Verify put spread is well below
                  key support before trading. Consider Bear Call Spread instead."
         elif directional_bias in ("Bullish", "Bearish"):
           → add "Mild {directional_bias} bias detected — monitor the {call/put} side for
                  directional risk if trend strengthens."

    2. Bear Call Spread with Bullish bias:
       if strategy == "Bear Call Spread" AND directional_bias in ("Bullish"):
         → add "Directional bias is Bullish — Bear Call Spread carries headwind.
                Verify the short call strike is far enough OTM to withstand continued upside."

    3. Bull Put Spread with Bearish bias:
       if strategy == "Bull Put Spread" AND directional_bias in ("Bearish"):
         → add "Directional bias is Bearish — Bull Put Spread carries headwind.
                Verify the short put strike is far enough OTM to withstand continued downside."

    4. Low IV (general):
       if iv_rank < 30:
         → add "IV Rank {iv_rank:.0f}% — low IV means thin credit received. Consider waiting
                for an IV expansion event before selling premium."

    5. Near DTE floor:
       if dte ≤ 23:
         → add "DTE {dte} — approaching the 21-DTE exit threshold; gamma risk accelerates
                quickly. Plan to close this position within days of opening."

    6. Liquidity warning (per leg):
       if any leg BA spread > 8%:
         → add "Wide bid-ask spread on {leg} ({ba:.1f}%) — use limit orders at mid-price;
                avoid market orders."
    """
    pass


def run_credit_spread_scanner(signals, calls, puts, opt_dates) -> list[CreditSpreadCandidate]:
    """
    Run all 3 credit spread builders. Score each. Apply decision thresholds.
    Return all candidates (including SKIP decisions — UI can filter).
    Sort by score descending.
    """
    candidates = []
    for builder in [build_bull_put_spread, build_bear_call_spread, build_iron_condor]:
        c = builder(signals, calls, puts, opt_dates)
        if c is not None:
            candidates.append(c)
    candidates.sort(key=lambda x: x.score, reverse=True)
    return candidates
```

### Credit spread exit plan string
```
"Take profit when position gains 50% of max credit received.
 Cut loss if unrealized loss reaches 2× the credit received.
 Always close by 21 DTE to avoid accelerating gamma risk."
```

---

## main.py — FastAPI app

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf, pandas as pd, numpy as np

from models import (
    AnalyzeRequest, AnalyzeResponse, ScanRequest, ScanResponse,
    RecommendationOut, OptionLegOut, OptionRowOut, PricePoint, SignalsOut, ScoreBreakdown
)
from analysis import generate_signals
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from long_options_scanner import run_long_options_scanner
from credit_spread_scanner import run_credit_spread_scanner

app = FastAPI(title="FluXTrade API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def fetch_ticker_data(ticker: str):
    """
    Shared data-fetching helper used by both /api/analyze and /api/scan.
    Returns (stock, hist, calls_f, puts_f, opt_dates, company_name, sector, market_cap).
    Raises HTTPException on failure.
    """
    stock = yf.Ticker(ticker)
    hist  = stock.history(period="1y")

    if hist is None or hist.empty:
        raise HTTPException(404, f"No data found for '{ticker}'")
    if len(hist) < 60:
        raise HTTPException(400, f"Need at least 60 days of history for '{ticker}'")

    opt_dates = list(stock.options or [])
    if not opt_dates:
        raise HTTPException(404, f"No options available for '{ticker}'")

    target_expiry = opt_dates[min(2, len(opt_dates) - 1)]
    chain         = stock.option_chain(target_expiry)
    calls_raw, puts_raw = chain.calls.copy(), chain.puts.copy()

    try:
        info         = stock.info
        company_name = info.get("longName", ticker)
        sector       = info.get("sector", "N/A")
        market_cap   = format_market_cap(float(info.get("marketCap", 0) or 0))
    except:
        company_name, sector, market_cap = ticker, "N/A", "N/A"

    price_approx = float(hist["Close"].iloc[-1])
    calls_f = calls_raw[(calls_raw["strike"] >= price_approx * 0.75) & (calls_raw["strike"] <= price_approx * 1.30)].copy()
    puts_f  = puts_raw [(puts_raw ["strike"] >= price_approx * 0.75) & (puts_raw ["strike"] <= price_approx * 1.30)].copy()

    return stock, hist, calls_f, puts_f, opt_dates, company_name, sector, market_cap


@app.get("/")
def root():
    return {"status": "ok", "service": "FluXTrade API", "version": "1.0"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """Decision Lab endpoint — unchanged unified engine."""
    ticker = req.ticker.upper().strip()
    stock, hist, calls_f, puts_f, opt_dates, company_name, sector, market_cap = fetch_ticker_data(ticker)

    signals = generate_signals(hist, calls_f, puts_f)
    trades  = run_engine(signals, calls_f, puts_f, opt_dates)

    # Build AnalyzeResponse (same as before — map trades + signals + chains to output models)
    # NTM chain: filter to 90%–110% of price, head(20)
    # filters_applied: dict of the 5 engine constants
    ...


@app.post("/api/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
    """
    Options Scanner endpoint.
    Runs Long Options Scanner and Credit Spread Scanner INDEPENDENTLY.
    Both scanners receive the same signals object but apply their own rules.
    """
    ticker = req.ticker.upper().strip()
    stock, hist, calls_f, puts_f, opt_dates, company_name, sector, market_cap = fetch_ticker_data(ticker)

    signals = generate_signals(hist, calls_f, puts_f)

    # Run the two independent scanners — they do NOT share scoring logic
    long_candidates   = run_long_options_scanner(signals, calls_f, puts_f, opt_dates)
    credit_candidates = run_credit_spread_scanner(signals, calls_f, puts_f, opt_dates)

    price_history_out = [
        PricePoint(date=p["date"], close=p["close"], ma20=p["ma20"], ma50=p["ma50"], ma200=p["ma200"])
        for p in signals.price_history
    ]

    return ScanResponse(
        ticker=ticker,
        company_name=company_name,
        sector=sector,
        market_cap=market_cap,
        signals=build_signals_out(signals),
        long_options=long_candidates,
        credit_spreads=credit_candidates,
        price_history=price_history_out,
    )
```

### Error handling
```
Ticker not found:       404 — "No data found for ticker '{ticker}'"
No options available:   404 — "No options data available for '{ticker}'"
Insufficient history:   400 — "Need at least 60 days of price history"
No candidates found:    Return empty lists (not an error — scanners return SKIP decisions)
Any fetch failure:      500 with descriptive message
```

---

## END OF PROMPT A

---
---

# PROMPT B — fluxtrade (React + TypeScript UI)

> Paste everything from here through "END OF PROMPT B" into Cursor's AI chat when the `fluxtrade/` folder is open.
> Assumes `fluxtrade-api` is running at `http://localhost:8080`.

---

Build the complete React + TypeScript frontend for **FluXTrade** — a Systematic Options Trade Advisor.
Backend API: `http://localhost:8080`. Two main endpoints:
- `POST /api/analyze` — Decision Lab (existing unified engine)
- `POST /api/scan`    — Options Scanner (two independent scanners)

**CRITICAL:** The existing Decision Lab page must remain fully working. The Options Scanner is a NEW,
separate mode. Do NOT merge their logic, scoring, or UI.

## Tech stack

```
React 18 + TypeScript + Vite
Tailwind CSS
Recharts (all charts)
Axios (API calls)
Lucide React (icons)
```

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

## FluXTrade Brand Identity

```
Page background:   #020d18
Card background:   #071828
Inner sections:    #0c2233
Primary accent:    #0ea5e9   (sky-500)
Accent hover:      #38bdf8   (sky-400)
Bullish / Profit:  #10b981   (emerald-500)
Bearish / Loss:    #f43f5e   (rose-500)
Neutral / Warning: #f59e0b   (amber-500)
Info / MA20:       #0ea5e9
MA50:              #a78bfa   (violet-400)
MA200:             #fb923c   (orange-400)
Text primary:      #e2e8f0
Text muted:        #94a3b8
Text very muted:   #64748b
Card border:       #1e3a4f
```

App name: **FluXTrade** ("FluX" in `text-sky-400 font-bold`, "Trade" in `text-slate-200`)
Tagline: *"Systematic options intelligence."*

---

## TypeScript types (src/types/index.ts)

### Existing types (keep exactly — used by Decision Lab)

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
  signal_score: number;
  structure_score: number;
  liquidity_score: number;
  iv_fit_score: number;
  total_score: number;
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
  filters_applied: Record<string, unknown>;
}
```

### New scanner types (add below existing)

```typescript
// ── Long Options Scanner ──────────────────────────────────────────────────────

export type LongDecision = "TRADE" | "WATCH" | "SETUP" | "SKIP";

export interface LongScoreBreakdown {
  trend_score: number;      // 0–25
  momentum_score: number;   // 0–20
  breakout_score: number;   // 0–20
  volume_score: number;     // 0–15  volume vs 20-day average
  liquidity_score: number;  // 0–12
  iv_fit_score: number;     // 0–8
  total_score: number;      // 0–100
}

export interface LongOptionCandidate {
  ticker: string;
  strategy: string;           // "Long Call" | "Long Put" | "Bull Call Spread" | "Bear Put Spread" | "Long Straddle"
  decision: LongDecision;
  score: number;
  scores: LongScoreBreakdown;
  legs: OptionLeg[];
  expiry: string;
  dte: number;
  premium_paid: number;
  max_loss: number;
  max_profit: number;         // 9999 = unlimited
  breakeven: number;
  breakeven_upper: number;    // 9999 if unlimited upside
  prob_of_profit: number;
  expected_value: number;
  iv_rank: number;
  iv_environment: string;
  rsi: number;
  rsi_note: string;
  macd_crossover: string;
  reason: string;
  risk_notes: string[];
  exit_plan: string;
}

// ── Credit Spread Scanner ─────────────────────────────────────────────────────

export type CreditDecision = "TRADE" | "WATCH" | "SKIP";

export interface CreditScoreBreakdown {
  iv_score: number;          // 0–25
  pop_score: number;         // 0–25
  credit_score: number;      // 0–20
  buffer_score: number;      // 0–15
  liquidity_score: number;   // 0–15
  total_score: number;       // 0–100
}

export interface CreditSpreadCandidate {
  ticker: string;
  strategy: string;           // "Bull Put Spread" | "Bear Call Spread" | "Iron Condor"
  decision: CreditDecision;
  score: number;
  scores: CreditScoreBreakdown;
  legs: OptionLeg[];
  expiry: string;
  dte: number;
  net_credit: number;
  spread_width: number;
  credit_pct_of_width: number;
  max_profit: number;
  max_loss: number;
  breakeven_lower: number;
  breakeven_upper: number;
  short_leg_delta: number;
  prob_of_profit: number;
  expected_value: number;
  iv_rank: number;
  iv_environment: string;
  reason: string;
  risk_notes: string[];
  exit_plan: string;
}

// ── Scan response ─────────────────────────────────────────────────────────────

export interface ScanResponse {
  ticker: string;
  company_name: string;
  sector: string;
  market_cap: string;
  signals: Signals;
  long_options: LongOptionCandidate[];
  credit_spreads: CreditSpreadCandidate[];
  price_history: PricePoint[];
}
```

---

## API client (src/api/client.ts)

```typescript
import axios from "axios";
import { AnalyzeResponse, ScanResponse } from "../types";

const api = axios.create({ baseURL: "http://localhost:8080" });

// Existing — Decision Lab (DO NOT CHANGE)
export const analyzeOptions = async (
  ticker: string,
  weeksOut: number
): Promise<AnalyzeResponse> => {
  const { data } = await api.post<AnalyzeResponse>("/api/analyze", { ticker, weeks_out: weeksOut });
  return data;
};

// New — Options Scanner
export const scanOptions = async (
  ticker: string,
  weeksOut: number
): Promise<ScanResponse> => {
  const { data } = await api.post<ScanResponse>("/api/scan", { ticker, weeks_out: weeksOut });
  return data;
};
```

---

## App.tsx — Top-level mode switcher

App now has two top-level modes: **Decision Lab** and **Options Scanner**.
Mode is stored in state: `appMode: "lab" | "scanner"`.

**Navigation tabs** (inside or just below the Header):
```
[ 🔬 Decision Lab ]  [ 📡 Options Scanner ]
```
Active tab: sky-400 underline border. Inactive: slate-500.

**Mode explainer banner** — render directly below the nav tabs, always visible.
This is critical: traders will wonder why the two modes give different scores for the
same trade. The banner explains this before they even run an analysis.

```
Decision Lab mode banner (sky-900/30 background, sky-400 left border, rounded-xl):
  "🔬 Decision Lab — All 8 strategies run through a unified engine and scored on one
   0–100 scale combining signal fit, trade structure, liquidity, and IV environment.
   Best for deep analysis of a single ticker."

Options Scanner mode banner (violet-900/30 background, violet-400 left border, rounded-xl):
  "📡 Options Scanner — Two independent scanners, each with its own scoring rubric.
   Long Options are scored on trend, momentum, volume, and IV fit for buying premium.
   Credit Spreads are scored on IV environment, probability of profit, credit quality,
   and strike safety. Scores are not comparable between scanners or with the Decision Lab."
```

Both banners: `text-slate-400 text-xs p-3 mb-4`. Do not show a "dismiss" button — always visible.

**Decision Lab mode** (appMode === "lab"):
Renders exactly the same as before — no changes whatsoever.
```
<TickerInput onAnalyze={handleAnalyze} loading={labLoading} />
{labData && (
  <>
    <MarketOverview ... />
    <SignalPanel ... />
    <RecommendationList ... />
    <Tabs>Price Chart | Options Chain</Tabs>
    <FiltersPanel ... />
  </>
)}
```

**Options Scanner mode** (appMode === "scanner"):
```
<ScannerTickerInput onScan={handleScan} loading={scanLoading} />
{scanData && (
  <>
    <ScanMarketOverview signals={scanData.signals} ticker={scanData.ticker} ... />
    <ScannerPage data={scanData} />
  </>
)}
```

State:
```typescript
const [appMode, setAppMode] = useState<"lab" | "scanner">("lab");

// Decision Lab state
const [labData, setLabData]       = useState<AnalyzeResponse | null>(null);
const [labLoading, setLabLoading] = useState(false);
const [labError, setLabError]     = useState<string | null>(null);

// Scanner state
const [scanData, setScanData]       = useState<ScanResponse | null>(null);
const [scanLoading, setScanLoading] = useState(false);
const [scanError, setScanError]     = useState<string | null>(null);
```

---

## Header Component (updated)

Same navy top bar. Add mode toggle below the logo row or inline:
```
[ 🔬 Decision Lab ]  [ 📡 Options Scanner ]
```
Pill/tab style — sky-600 background for active mode, transparent with sky-600 border for inactive.

---

## ScannerPage Component (NEW)

`src/components/scanner/ScannerPage.tsx`

Props: `data: ScanResponse`

This component renders two sub-tabs:
```
[ Long Options ]  [ Credit Spreads ]
```
Managed by local state `scannerTab: "long" | "credit"`.

Active sub-tab: sky-400 bottom border, `text-sky-400`.
Inactive: `text-slate-500`.

Below the tabs, render the appropriate scanner result panel.

---

## LongScannerPanel Component (NEW)

`src/components/scanner/LongScannerPanel.tsx`

Props: `candidates: LongOptionCandidate[]`

**Header:**
```
📈 Long Options Scanner
"Directional premium-buying opportunities scored on trend, momentum, and IV fit."
```

**Filter chips** (local state, all enabled by default):
`[ All ]  [ TRADE ]  [ WATCH ]  [ SETUP ]  [ SKIP ]`

Clicking a chip filters the displayed candidates.

**Candidate cards** — one per `LongOptionCandidate`, in score order.

Map each to `<LongCandidateCard candidate={c} />`.

If all filtered out: amber card "No Long Options candidates found for current filter."

---

## LongCandidateCard Component (NEW)

`src/components/scanner/LongCandidateCard.tsx`

Props: `candidate: LongOptionCandidate`

Card: `bg-[#071828] border border-[#1e3a4f] rounded-2xl overflow-hidden`
Left border: 4px solid
  - TRADE → emerald (#10b981)
  - WATCH → amber (#f59e0b)
  - SETUP → sky (#0ea5e9)
  - SKIP  → slate (#475569)

**Row 1 — Header:**
- Decision badge (large pill):
  - TRADE: `bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold`
  - WATCH: `bg-amber-500/20 text-amber-400 border border-amber-500/30`
  - SETUP: `bg-sky-500/20 text-sky-400 border border-sky-500/30`
  - SKIP: `bg-slate-700/50 text-slate-500 border border-slate-600/30`
- Strategy name: bold `text-slate-100`
- Score badge: `{score}/100` colored same as Decision
- DTE badge: `{dte} DTE` in slate pill

**Row 2 — Key metrics strip** (compact horizontal row):
```
Premium: $2.40/share  ·  Max Loss: $240/contract  ·  PoP: 54%  ·  EV: +$0.12  ·  IV Rank: 28%
```
All in `font-mono text-sm text-slate-400`
EV colored emerald if positive, rose if negative.

**Row 3 — RSI note** (only if rsi_note is non-empty):
`bg-amber-950/30 border border-amber-800/30 rounded-lg p-2 text-amber-300 text-xs`
Shows `rsi_note` verbatim — e.g. "RSI 72 — mildly extended; watch for pullback."

**Row 4 — Legs table** (`font-mono text-xs`):
```
BUY  CALL  $185.00  2025-05-16  Δ 0.45  mid $2.40  IV 27%  OI 1,204  BA 4.1%
SELL CALL  $195.00  2025-05-16  Δ 0.22  mid $0.90  IV 25%  OI   880  BA 5.3%
```
BUY rows → `text-emerald-400`  |  SELL rows → `text-rose-400`

**Row 5 — Score breakdown** (6 labeled mini progress bars):
```
Trend      xx/25  ████░░░░  sky
Momentum   xx/20  ████░░░░  violet
Breakout   xx/20  ███░░░░░  emerald
Volume     xx/15  ████░░░░  teal      ← confirms the move
Liquidity  xx/12  ███░░░░░  slate
IV Fit     xx/8   ██░░░░░░  amber
──────────────────────────────────────
Total      xx/100
```
Each bar: `bg-[#0c2233]` track, colored fill, label and max on left, filled bar on right.
Bar width = (score / max) * 100% of the bar track width.

**Row 6 — Reason box:**
`bg-[#0c2233] rounded-xl p-3`
💡 `{candidate.reason}` in `text-slate-400 text-sm`

**Row 7 — Risk notes** (only if non-empty):
`bg-rose-950/20 border border-rose-800/30 rounded-xl p-3`
⚠️ label + each `risk_note` as a bullet in `text-rose-300 text-xs`

**Row 8 — Exit plan** (collapsible, closed by default):
`bg-sky-950/30 border border-sky-800/30 rounded-xl p-3`
🚪 `{candidate.exit_plan}` in `text-sky-200 text-xs`

---

## CreditScannerPanel Component (NEW)

`src/components/scanner/CreditScannerPanel.tsx`

Props: `candidates: CreditSpreadCandidate[]`

**Header:**
```
📉 Credit Spread Scanner
"Premium-selling probability trades scored on IV environment, credit quality, and strike safety."
```

**Filter chips:**
`[ All ]  [ TRADE ]  [ WATCH ]  [ SKIP ]`

Map each candidate to `<CreditCandidateCard candidate={c} />`.

---

## CreditCandidateCard Component (NEW)

`src/components/scanner/CreditCandidateCard.tsx`

Props: `candidate: CreditSpreadCandidate`

Card: same base style as LongCandidateCard.
Left border:
  - TRADE → emerald
  - WATCH → amber
  - SKIP  → slate

**Row 1 — Header:**
- Decision badge (same style as LongCandidateCard)
- Strategy name
- Score badge
- DTE badge

**Row 2 — Key credit metrics strip:**
```
Credit: $1.45/share  ·  Max Loss: $355/contract  ·  Credit %: 29%  ·  PoP: 71%  ·  IV Rank: 58%
```
Credit % colored: emerald ≥ 35%, amber ≥ 25%, rose < 25%.

**Row 3 — Legs table** (same format as LongCandidateCard, SELL rows rose, BUY rows emerald)

**Row 4 — Breakeven range:**
```
Breakeven zone: $182.50 — $207.50
```
Rendered as a small horizontal range bar:
- Rose zone: left of lower breakeven (loss territory)
- Emerald zone: between breakevens (profit zone)
- Rose zone: right of upper breakeven
- Current price marker (sky dot) on the bar
- Width and current price labeled

**Row 5 — Score breakdown** (5 labeled mini progress bars):
```
IV Environment  xx/25  sky
Prob of Profit  xx/25  emerald
Credit Quality  xx/20  violet
Strike Buffer   xx/15  teal
Liquidity       xx/15  amber
──────────────────────────────
Total           xx/100
```

**Row 6 — Reason box:** same style as LongCandidateCard.

**Row 7 — Risk notes:** same style.

**Row 8 — Exit plan:** same style.

---

## Existing components (KEEP UNCHANGED)

All of the following must remain exactly as-is and continue to work in Decision Lab mode:

```
src/components/Header.tsx           — add mode toggle only
src/components/TickerInput.tsx      — unchanged
src/components/MarketOverview.tsx   — unchanged
src/components/SignalPanel.tsx      — unchanged
src/components/RecommendationList.tsx  — unchanged
src/components/RecommendationCard.tsx  — unchanged
src/components/OptionsChainTable.tsx   — unchanged
src/components/PriceChart.tsx          — unchanged
src/components/FiltersPanel.tsx        — unchanged
```

---

## Updated file structure

```
src/
├── api/
│   └── client.ts                        (add scanOptions — keep analyzeOptions)
├── components/
│   ├── Header.tsx                       (add mode toggle)
│   ├── TickerInput.tsx                  (unchanged)
│   ├── MarketOverview.tsx               (unchanged)
│   ├── SignalPanel.tsx                  (unchanged)
│   ├── RecommendationList.tsx           (unchanged)
│   ├── RecommendationCard.tsx           (unchanged)
│   ├── OptionsChainTable.tsx            (unchanged)
│   ├── PriceChart.tsx                   (unchanged)
│   ├── FiltersPanel.tsx                 (unchanged)
│   └── scanner/                         ← NEW folder
│       ├── ScannerPage.tsx              (tab switcher: Long | Credit)
│       ├── LongScannerPanel.tsx         (long options list + filter chips)
│       ├── LongCandidateCard.tsx        (individual long candidate card)
│       ├── CreditScannerPanel.tsx       (credit spreads list + filter chips)
│       └── CreditCandidateCard.tsx      (individual credit candidate card)
├── types/
│   └── index.ts                         (add scanner types)
├── App.tsx                              (add mode state + scanner render path)
├── main.tsx
└── index.css
```

---

## Decision badge visual spec

Use these consistently across both scanner card types:

```
TRADE:  bg-emerald-500/20  text-emerald-400  border-emerald-500/40  font-bold  "● TRADE"
WATCH:  bg-amber-500/20    text-amber-400    border-amber-500/40              "◐ WATCH"
SETUP:  bg-sky-500/20      text-sky-400      border-sky-500/40                "○ SETUP"  (long only)
SKIP:   bg-slate-700/30    text-slate-500    border-slate-600/30              "✕ SKIP"
```

Pill shape: `px-3 py-1 rounded-full text-xs font-semibold border`

---

## Scanner loading & error states

**Loading (scanner):**
Sky-500 spinner + sequential messages:
"Fetching market data..." → "Running Long Options Scanner..." → "Running Credit Spread Scanner..."

**Error (scanner):**
Rose-bordered card + error message + "Try again" button.

**Empty panel:**
Amber card: "No [Long Options / Credit Spread] candidates found. Try a different ticker or expiry window."

---

## Acceptance criteria (implement and verify each)

1. **Long call opportunities survive:** A stock with strong bullish trend and RSI 74 must
   produce a Long Call candidate with decision TRADE or WATCH — not SKIP. RSI 74 maps to
   momentum_score = 7/20, which is a reduction but not a block.

2. **Long Straddle appears in the scanner:** Every ticker analysis must produce a
   `LongOptionCandidate` with `strategy == "Long Straddle"`. It may be SKIP on a trending
   ticker (scoring will be low) but it must be present — not absent.

3. **Credit spreads survive breakouts:** A Bull Put Spread on a bullish breakout ticker must
   still appear in the Credit Spread Scanner if strikes are safely OTM. The directional
   alignment gives it a +2 buffer bonus (Bullish bias → Bull Put tailwind), not a block.

4. **Iron Condor during strong trend triggers a risk note:** If a ticker has
   `directional_bias == "Bullish"` and `trend_strength == "Strong"`, the Iron Condor
   candidate's `risk_notes` must contain the call-side exposure warning. This is mandatory.

5. **Thin credit scores poorly:** A Bull Put Spread with `credit_pct_of_width == 25.5%`
   must score `credit_score = 2/20`. It passes the hard gate (≥ 25%) but its low credit
   score should pull total below 65 unless IV and PoP are strong.

6. **Volume dimension is populated:** `LongOptionCandidate.scores.volume_score` must be
   a value between 0 and 15, computed from the 20-day average volume. It must not default
   to 0 for all candidates.

7. **Scanners are independent:** Changing credit % threshold in `credit_spread_scanner.py`
   has zero effect on `long_options_scanner.py`. Changing trend weight in
   `long_options_scanner.py` has zero effect on `credit_spread_scanner.py`.

8. **Decision Lab unchanged:** `POST /api/analyze` still returns `AnalyzeResponse` with all
   8 strategies, and the Decision Lab UI renders exactly as before.

9. **Score dimensions match the model:** `LongScoreBreakdown` has exactly 6 fields
   (trend + momentum + breakout + volume + liquidity + iv_fit) summing to 100.
   `CreditScoreBreakdown` has exactly 5 fields summing to 100. Neither borrows categories
   from the other.

10. **Mode explainer banner is always visible:** Switching from Decision Lab to Options
    Scanner mode shows the violet explainer banner before any ticker is analyzed, so users
    understand the scoring difference before comparing results.

---

## Coding rules

- TypeScript strict mode — no `any`
- All financial numbers: 2 decimal places minimum
- Per contract = per share × 100 — always show both
- Never render "Infinity" or 9999 directly — display "Unlimited"
- Mobile-responsive: stack columns on `sm:` breakpoint
- Smooth hover transitions: `transition-colors duration-150`
- No shared state between Decision Lab and Scanner — separate useState for each

---

## Footer (unchanged)

`bg-[#071828] border-t border-[#1e3a4f] text-center text-slate-500 text-xs py-3`

"FluXTrade is for educational purposes only. Not financial advice. Options trading involves significant risk of loss."

---

## END OF PROMPT B
