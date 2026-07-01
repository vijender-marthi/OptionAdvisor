import { useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, ShieldCheck, HelpCircle } from 'lucide-react'
import type { Recommendation, Signals } from '../types'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Status   = 'pass' | 'warn' | 'fail'
type Category = 'IV Environment' | 'Directional Bias' | 'Momentum' | 'Structure' | 'Timing' | 'Liquidity'

export interface CheckItem {
  label:    string
  status:   Status
  detail:   string
  category: Category
  hard:     boolean   // hard fail = NO GO regardless of other items
}

export type Verdict = 'GO' | 'CAUTION' | 'NO GO'

// ─── Checklist builder ──────────────────────────────────────────────────────
//
// Credit spreads (Bull Put, Bear Call, Iron Condor) and long options (Long
// Call, Long Put, debit spreads) have fundamentally different goals:
//   Credit: profit when stock STAYS PUT — high PoP expected, trend/MACD
//           only matter for "is there a serious threat to my short strike?"
//   Debit:  profit from a REAL MOVE — lower PoP is normal but need strong
//           directional conviction, IV must be cheap enough to overcome crush.

export function buildChecklist(rec: Recommendation, sig: Signals): CheckItem[] {
  const items: CheckItem[] = []
  const isCredit    = rec.net_credit > 0
  const isCovered   = rec.strategy === 'Covered Call' || rec.strategy === 'Covered Put'
  const isNakedSell = rec.strategy === 'Short Put'    || rec.strategy === 'Short Call'
  // Income-sell: covered or naked single-leg sells — use yield-based checks instead of EV/R:R
  const isIncomeSell = isCovered || isNakedSell
  const isBullish   = rec.bias.toUpperCase().includes('BULLISH')
  const isBearish   = rec.bias.toUpperCase().includes('BEARISH')
  const isNeutral   = !isBullish && !isBearish
  const strategyName = rec.strategy || 'strategy'
  const shortPutStrike = rec.legs.find(l => l.action === 'SELL' && l.option_type === 'PUT')?.strike
  const shortCallStrike = rec.legs.find(l => l.action === 'SELL' && l.option_type === 'CALL')?.strike
  const strikeText = (strike?: number) => Number.isFinite(strike) ? `$${strike?.toFixed(0)}` : 'the short strike'

  // ── 1. IV Environment ────────────────────────────────────────────────────
  // Credit: want rich premium → favor high IV, penalize very low IV
  // Debit:  want cheap premium → favor low IV, penalize high IV (crush risk)
  const ivr = sig.iv_rank ?? 0
  if (isCredit) {
    if (ivr >= 45)
      items.push({ label: 'IV Environment', status: 'pass', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — elevated. Premium is rich; selling credit has a statistical edge.` })
    else if (ivr >= 20)
      items.push({ label: 'IV Environment', status: 'warn', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — moderate. Credit is tradeable but premium is thinner than ideal.` })
    else
      items.push({ label: 'IV Environment', status: 'fail', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — very low IV. Collected premium barely compensates for gap risk.` })
  } else {
    if (ivr <= 40)
      items.push({ label: 'IV Environment', status: 'pass', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — reasonable cost to own premium. IV expansion adds upside potential.` })
    else if (ivr <= 60)
      items.push({ label: 'IV Environment', status: 'warn', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — elevated. Long options face IV crush risk after catalysts; size down.` })
    else
      items.push({ label: 'IV Environment', status: 'fail', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — high. Long option premium is expensive; IV crush can erase gains even on a correct move.` })
  }

  // ── 2. Bias / Range Conviction ────────────────────────────────────────────
  // Iron Condor (neutral + credit): directional confidence is irrelevant —
  //   what matters is whether the stock is genuinely range-bound.
  // Directional credit (Bull Put, Bear Call): moderate confidence is fine;
  //   you just need the stock NOT to breach the short strike.
  // Debit/long: need stronger directional conviction to justify the premium.
  const conf = sig.bias_confidence ?? 0
  if (isNeutral && isCredit) {
    // Iron Condor — check range-bound conditions instead of directional confidence
    const slopeFlat = Math.abs(sig.ma50_slope) < 0.002
    const rsiMid    = sig.rsi >= 38 && sig.rsi <= 62
    if (slopeFlat && rsiMid)
      items.push({ label: 'Range Conditions', status: 'pass', hard: false, category: 'Directional Bias',
        detail: `MA50 slope flat + RSI ${(sig.rsi ?? 50).toFixed(0)} in mid-range. Stock looks range-bound — ideal for iron condor.` })
    else if (slopeFlat || rsiMid)
      items.push({ label: 'Range Conditions', status: 'warn', hard: false, category: 'Directional Bias',
        detail: `Partial range support — MA50 slope ${sig.ma50_slope > 0 ? 'rising' : 'falling'}, RSI ${(sig.rsi ?? 50).toFixed(0)}. One side of the condor carries more risk.` })
    else
      items.push({ label: 'Range Conditions', status: 'fail', hard: false, category: 'Directional Bias',
        detail: `Trending conditions with RSI ${(sig.rsi ?? 50).toFixed(0)}. A directional move is more likely; iron condor range may be breached.` })
  } else if (isCredit) {
    // Directional credit spread — moderate conviction is sufficient
    if (conf >= 40)
      items.push({ label: 'Bias Confidence', status: 'pass', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — enough directional support for ${strategyName}. For credit spreads, this does not need to be perfect; it only needs to show that price is less likely to challenge your short strike. Example: on a bull put spread, modest bullish/neutral bias is acceptable if the short put is safely below support.` })
    else if (conf >= 25)
      items.push({ label: 'Bias Confidence', status: 'warn', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — the market read is weak. If you still trade, use smaller size, choose a farther OTM short strike, or wait for price to confirm direction. Example: sell a wider bull put only after price holds support.` })
    else
      items.push({ label: 'Bias Confidence', status: 'fail', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — too little directional edge. The trade may still collect premium, but the odds of the short strike being tested are not favorable enough.` })
  } else {
    // Long / debit — need stronger conviction to justify premium cost
    if (conf >= 55)
      items.push({ label: 'Bias Confidence', status: 'pass', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — solid directional conviction. Long premium needs price movement, so the engine wants stronger confirmation before paying debit. Example: a long call should have clear bullish trend and momentum, not only a cheap option price.` })
    else if (conf >= 35)
      items.push({ label: 'Bias Confidence', status: 'warn', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — moderate conviction. A debit spread may be better than a naked long option because it lowers premium risk while keeping directional exposure.` })
    else
      items.push({ label: 'Bias Confidence', status: 'fail', hard: false, category: 'Directional Bias',
        detail: `${conf.toFixed(0)}% confidence — weak directional conviction. Paying premium here has poor expected value because price may not move enough before theta decay takes over.` })
  }

  // ── 3. Trend Alignment ────────────────────────────────────────────────────
  // Credit spreads have a WIDER margin for error — the short strike is OTM,
  // so the trend doesn't need to perfectly align, it just can't strongly oppose.
  // Debit/long strategies need the trend squarely behind them.
  if (isBullish) {
    if (isCredit) {
      // Bull Put / Covered / Short Put: stock just needs to stay above the short strike. Above MA50 = enough.
      const stratLabel  = isIncomeSell ? `${rec.strategy} position` : 'Bull put spread'
      const strikeLabel = rec.strategy === 'Covered Call' || rec.strategy === 'Short Call'
        ? 'short call strike' : 'short put strike'
      if (sig.above_ma50)
        items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
          detail: `Price is above the 50-day moving average, so the stock is still holding intermediate support. That gives the ${stratLabel} room to work before ${strikeText(shortPutStrike)} is threatened. Example: prefer selling puts below support, not directly at the current price.` })
      else if (sig.ma50_slope > 0)
        items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
          detail: `Price is below MA50, but the MA50 is still rising. The trend is bending, not fully broken. Monitor closely because the ${strikeLabel} has less cushion.` })
      else
        items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
          detail: `Price is below a declining MA50. That means the trend is working against the bullish income trade and increases the chance of testing the ${strikeLabel}.` })
    } else {
      // Long call / bull call spread: need real trend support
      if (sig.above_ma50 && sig.ma50_slope > 0)
        items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
          detail: 'Price is above a rising MA50. That is clean bullish structure and supports paying for long call or bull call spread exposure. Example: buy pullbacks while price remains above rising support.' })
      else if (sig.above_ma50 || sig.ma50_slope > 0)
        items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
          detail: 'Trend support is mixed. Long premium needs a clear move to profit, so consider waiting for price to reclaim the MA50 or use a defined-risk debit spread.' })
      else
        items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
          detail: 'Price is below a declining MA50. That trend works directly against a long call and raises the chance that theta decay wins before price moves.' })
    }
  } else if (isBearish) {
    if (isCredit) {
      // Bear Call: stock just needs to stay below the short call.
      if (!sig.above_ma50)
        items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
          detail: `Price is below MA50, so the stock is holding under intermediate resistance. That gives the bear call spread room before ${strikeText(shortCallStrike)} is threatened. Example: sell calls above resistance, not near current price.` })
      else if (sig.ma50_slope < 0)
        items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
          detail: 'Price is above MA50, but the MA50 slope is declining. Bearish structure is not fully broken, but the short call has higher test risk.' })
      else
        items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
          detail: `Price is above a rising MA50. That uptrend works against the bear call spread and increases the chance of testing ${strikeText(shortCallStrike)}.` })
    } else {
      // Long put / bear put spread: need real downtrend
      if (!sig.above_ma50 && sig.ma50_slope < 0)
        items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
          detail: 'Price is below a declining MA50. That is clean bearish structure and supports paying for long put or bear put spread exposure. Example: enter after failed bounces into resistance.' })
      else if (!sig.above_ma50 || sig.ma50_slope < 0)
        items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
          detail: 'Bearish alignment is partial. Price or slope is mixed, so a long put needs faster follow-through to overcome premium decay.' })
      else
        items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
          detail: 'Price is above a rising MA50. That trend works directly against a long put and increases bounce risk.' })
    }
  } else {
    // Neutral (Iron Condor / Long Straddle)
    const flat = Math.abs(sig.ma50_slope) < 0.002
    items.push({ label: 'Trend Alignment', status: flat ? 'pass' : 'warn', hard: false, category: 'Directional Bias',
      detail: flat
        ? 'Flat MA50 slope — sideways price action supports a range-bound or volatility-play strategy.'
        : `MA50 slope is directional (${sig.ma50_slope > 0 ? 'rising' : 'falling'}) — neutral strategy carries elevated risk on one side.` })
  }

  // ── 4. RSI ────────────────────────────────────────────────────────────────
  // Credit: RSI extremes are BAD — they signal potential continuation moves
  //         that could breach your short strike.
  // Debit:  RSI extremes against your direction are BAD — entering overbought
  //         on a long call or oversold on a long put is poor timing.
  const rsi = sig.rsi ?? 50
  if (isCredit) {
    if (isBullish) {
      // Bull Put Spread: oversold RSI means stock may keep falling through the put
      if (rsi < 28)
        items.push({ label: 'RSI Level', status: 'fail', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — severely oversold. For a bull put spread, this means sellers may still be in control and price could continue toward ${strikeText(shortPutStrike)}. Example: wait for the first stabilization candle or choose a lower short put.` })
      else if (rsi < 38)
        items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — near oversold. The trade can still work, but the cushion is thinner. Consider a wider OTM spread or wait for RSI to turn up.` })
      else
        items.push({ label: 'RSI Level', status: 'pass', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — not near oversold. Momentum is not pressuring the short put, so the bull put spread has reasonable room to work.` })
    } else if (isBearish) {
      // Bear Call Spread: overbought RSI means stock may keep surging through the call
      if (rsi > 72)
        items.push({ label: 'RSI Level', status: 'fail', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — severely overbought. For a bear call spread, buyers may still push toward ${strikeText(shortCallStrike)}. Example: wait for rejection or sell a higher call spread.` })
      else if (rsi > 62)
        items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — near overbought. The bear call can still work, but the short call has less cushion. Wait for RSI to cool or move strikes farther OTM.` })
      else
        items.push({ label: 'RSI Level', status: 'pass', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — not near overbought. Momentum is not pressuring the short call, so the bear call spread has reasonable room to work.` })
    } else {
      // Iron Condor: any extreme threatens one side of the range
      if (rsi > 70 || rsi < 30)
        items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — at an extreme. Increased probability of a directional move breaking outside the condor range.` })
      else
        items.push({ label: 'RSI Level', status: 'pass', hard: false, category: 'Momentum',
          detail: `RSI ${rsi.toFixed(1)} — in mid-range. Stock not at extremes; iron condor range is well-supported.` })
    }
  } else {
    // Long / debit — RSI against direction is a timing problem
    if (isBullish && rsi > 75)
      items.push({ label: 'RSI Level', status: 'fail', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} — overbought. Entering a long call here risks a mean-reversion pullback before expiry.` })
    else if (isBullish && rsi > 68)
      items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} — elevated. Waiting for a pullback to RSI 50–60 would improve entry timing.` })
    else if (isBearish && rsi < 25)
      items.push({ label: 'RSI Level', status: 'fail', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} — oversold. Entering a long put here risks a bounce eating into your premium.` })
    else if (isBearish && rsi < 32)
      items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} — approaching oversold. A short-term bounce could reduce your put value quickly.` })
    else if (isNeutral && (rsi > 68 || rsi < 32))
      items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} — at an extreme for a straddle/neutral. A mean-reversion move may help but watch expiry timing.` })
    else
      items.push({ label: 'RSI Level', status: 'pass', hard: false, category: 'Momentum',
        detail: `RSI ${rsi.toFixed(1)} (${sig.rsi_signal}) — no extreme momentum signal. Entry timing is reasonable.` })
  }

  // ── 5. MACD ────────────────────────────────────────────────────────────────
  // Credit spreads: MACD only matters if it signals a THREAT to the short strike.
  //   Bull Put → only warn if MACD strongly bearish (might crash through the put).
  //   Bear Call → only warn if MACD strongly bullish (might rocket through the call).
  //   Iron Condor → warn if MACD is strongly directional either way.
  // Debit/long: MACD must CONFIRM the direction you're betting on.
  const hist = sig.macd_histogram ?? 0
  if (isCredit) {
    if (isBullish) {
      if (hist < -0.5 && sig.macd < sig.macd_signal_line)
        items.push({ label: 'MACD Signal', status: 'warn', hard: false, category: 'Momentum',
          detail: `MACD is bearish (histogram ${hist.toFixed(2)}). That does not automatically kill a bull put spread, but it warns that downside momentum could test ${strikeText(shortPutStrike)}. Example: wait for MACD histogram to flatten or reduce size.` })
      else
        items.push({ label: 'MACD Signal', status: 'pass', hard: false, category: 'Momentum',
          detail: `MACD histogram ${hist.toFixed(2)} — no strong downside momentum is currently threatening the bull put spread.` })
    } else if (isBearish) {
      if (hist > 0.5 && sig.macd > sig.macd_signal_line)
        items.push({ label: 'MACD Signal', status: 'warn', hard: false, category: 'Momentum',
          detail: `MACD is bullish (histogram ${hist.toFixed(2)}). That warns buyers may push toward ${strikeText(shortCallStrike)}. Example: wait for a failed breakout or sell a higher call spread.` })
      else
        items.push({ label: 'MACD Signal', status: 'pass', hard: false, category: 'Momentum',
          detail: `MACD histogram ${hist.toFixed(2)} — no strong upside momentum is currently threatening the bear call spread.` })
    } else {
      // Iron Condor: any strong momentum is a threat
      if (Math.abs(hist) > 0.5)
        items.push({ label: 'MACD Signal', status: 'warn', hard: false, category: 'Momentum',
          detail: `MACD histogram ${hist.toFixed(2)} — directional momentum present. Iron condor range may be challenged.` })
      else
        items.push({ label: 'MACD Signal', status: 'pass', hard: false, category: 'Momentum',
          detail: `MACD histogram ${hist.toFixed(2)} — momentum is flat. Supports range-bound iron condor thesis.` })
    }
  } else {
    // Long/debit: need MACD to confirm direction
    if (isBullish) {
      if (hist > 0 && sig.macd > sig.macd_signal_line)
        items.push({ label: 'MACD Confirmation', status: 'pass', hard: false, category: 'Momentum',
          detail: 'MACD above signal, positive histogram — bullish momentum confirmed. Long call has tailwind.' })
      else if (hist > 0 || sig.macd > sig.macd_signal_line)
        items.push({ label: 'MACD Confirmation', status: 'warn', hard: false, category: 'Momentum',
          detail: 'Mixed MACD — partial bullish signal. Wait for histogram to confirm before full-size entry.' })
      else
        items.push({ label: 'MACD Confirmation', status: 'fail', hard: false, category: 'Momentum',
          detail: 'MACD below signal, bearish histogram — momentum opposes the long call. Higher risk of premium loss.' })
    } else if (isBearish) {
      if (hist < 0 && sig.macd < sig.macd_signal_line)
        items.push({ label: 'MACD Confirmation', status: 'pass', hard: false, category: 'Momentum',
          detail: 'MACD below signal, negative histogram — bearish momentum confirmed. Long put has tailwind.' })
      else if (hist < 0 || sig.macd < sig.macd_signal_line)
        items.push({ label: 'MACD Confirmation', status: 'warn', hard: false, category: 'Momentum',
          detail: 'Mixed MACD — partial bearish signal. Momentum shift still developing.' })
      else
        items.push({ label: 'MACD Confirmation', status: 'fail', hard: false, category: 'Momentum',
          detail: 'MACD above signal, bullish histogram — momentum opposes the long put. Higher risk of premium loss.' })
    } else {
      // Long straddle: want low directional momentum (volatility play)
      items.push({ label: 'MACD Signal', status: Math.abs(hist) < 0.5 ? 'pass' : 'warn', hard: false, category: 'Momentum',
        detail: Math.abs(hist) < 0.5
          ? `MACD histogram ${hist.toFixed(2)} — low directional momentum. Straddle benefits from an upcoming volatility event, not current trend.`
          : `MACD histogram ${hist.toFixed(2)} — trending. Straddle works better with flat MACD; one side of the position is disadvantaged.` })
    }
  }

  // ── 6. DTE ────────────────────────────────────────────────────────────────
  const dte = rec.dte
  if (isCredit) {
    if (dte >= 21 && dte <= 50)
      items.push({ label: 'DTE Window', status: 'pass', hard: false, category: 'Timing',
        detail: `${dte} DTE — strong window for credit spreads. Theta decay is active, but gamma risk is not yet extreme. Example: sell 30-45 DTE and plan to take profits at 50% of credit.` })
    else if (dte > 50 && dte <= 65)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — slightly long. Theta decay is slower than optimal; consider a nearer expiry if available.` })
    else if (dte >= 14 && dte < 21)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — short window. Theta is faster, but gamma risk rises quickly. Use smaller size and close early if the short strike is tested.` })
    else if (dte < 14)
      items.push({ label: 'DTE Window', status: 'fail', hard: true, category: 'Timing',
        detail: `${dte} DTE — dangerously short. Gamma risk is extreme; credit spreads under 2 weeks should be avoided.` })
    else
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — beyond 65 days. Theta decay is slow; capital is tied up longer than necessary.` })
  } else {
    if (dte >= 21 && dte <= 70)
      items.push({ label: 'DTE Window', status: 'pass', hard: false, category: 'Timing',
        detail: `${dte} DTE — practical window for long options and debit spreads. There is enough time for the thesis to work while theta decay remains manageable.` })
    else if (dte > 70)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — more time than needed. More premium at risk; consider a nearer expiry.` })
    else if (dte >= 14)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — short. Theta is accelerating; the move must happen soon or the position decays rapidly.` })
    else
      items.push({ label: 'DTE Window', status: 'fail', hard: true, category: 'Timing',
        detail: `${dte} DTE — too short. Theta destruction is severe for long options under 2 weeks.` })
  }

  // ── 7. Liquidity ──────────────────────────────────────────────────────────
  items.push({
    label: 'Liquidity', status: rec.passes_liquidity_filter ? 'pass' : 'fail',
    hard: !rec.passes_liquidity_filter, category: 'Liquidity',
    detail: rec.passes_liquidity_filter
      ? 'Bid/ask spread and open interest meet minimum thresholds. Entry and exit fills should be reasonable with limit orders. Example: if mid is $2.00 and spread is tight, start near mid instead of paying ask.'
      : 'One or more legs have wide spreads or thin open interest. Expect slippage on both entry and exit. Example: a $0.40 spread on a $1.20 option can erase much of the edge.',
  })

  // ── 8. Risk / Reward ──────────────────────────────────────────────────────
  const rr  = rec.passes_rr_filter
  const cr  = rec.passes_credit_filter
  const pop = rec.prob_of_profit ?? 0
  if (isIncomeSell) {
    // Income-sell strategies: key metric is premium yield, not spread credit %
    const collateralLabel = rec.strategy === 'Covered Call'
      ? 'stock position'
      : rec.strategy === 'Covered Put'
      ? 'cash collateral'
      : 'stock price'           // Short Put / Short Call — yield vs stock price
    const minYield = rec.strategy === 'Covered Call' ? 0.80
      : rec.strategy === 'Covered Put' ? 0.60
      : 0.50                    // Short Put / Short Call: 0.50% minimum yield
    if (cr)
      items.push({ label: 'Income Yield', status: 'pass', hard: false, category: 'Structure',
        detail: `${(rec.credit_pct_of_width ?? 0).toFixed(2)}% yield on ${collateralLabel} — meets the minimum ${minYield.toFixed(2)}% income threshold. PoP ${(pop * 100).toFixed(0)}%.` })
    else
      items.push({ label: 'Income Yield', status: 'fail', hard: false, category: 'Structure',
        detail: `${(rec.credit_pct_of_width ?? 0).toFixed(2)}% yield on ${collateralLabel} — below minimum ${minYield.toFixed(2)}% threshold. Premium too thin to justify the capital requirement.` })
  } else if (isCredit) {
    // Standard credit spread: both R/R and minimum credit % matter
    if (rr && cr)
      items.push({ label: 'Trade Structure', status: 'pass', hard: false, category: 'Structure',
        detail: `Credit ${(rec.credit_pct_of_width ?? 0).toFixed(0)}% of spread width — passes minimum 25% threshold. Risk/Reward: ${(rec.risk_reward_ratio ?? 0).toFixed(1)}x.` })
    else if (rr || cr)
      items.push({ label: 'Trade Structure', status: 'warn', hard: false, category: 'Structure',
        detail: `Credit ${(rec.credit_pct_of_width ?? 0).toFixed(0)}% of width, R/R ${(rec.risk_reward_ratio ?? 0).toFixed(1)}x — one structure filter missed. Tighter than ideal.` })
    else
      items.push({ label: 'Trade Structure', status: 'fail', hard: false, category: 'Structure',
        detail: `Credit ${(rec.credit_pct_of_width ?? 0).toFixed(0)}% of width, R/R ${(rec.risk_reward_ratio ?? 0).toFixed(1)}x — poor credit structure. Both minimum thresholds failed.` })
  } else {
    // Debit: R/R filter is the primary metric (credit filter doesn't apply)
    if (rr)
      items.push({ label: 'Trade Structure', status: 'pass', hard: false, category: 'Structure',
        detail: `Risk/Reward ${(rec.risk_reward_ratio ?? 0).toFixed(1)}x — passes the R/R filter. Max profit ($${(rec.max_profit * 100).toFixed(0)}) justifies the premium paid.` })
    else
      items.push({ label: 'Trade Structure', status: 'warn', hard: false, category: 'Structure',
        detail: `Risk/Reward ${(rec.risk_reward_ratio ?? 0).toFixed(1)}x — below ideal. A large move is required to generate meaningful profit relative to premium paid.` })
  }

  // ── 9. Expected Value / Kelly Edge ────────────────────────────────────────
  // EV <= 0 is a hard NO GO for every strategy. Positive but very small
  // EV/max-loss is shown as a thin-edge warning because PoP estimation error can erase it.
  const ev = rec.expected_value ?? 0
  const edge = rec.edge_ratio ?? (rec.max_loss > 0 ? ev / rec.max_loss : 0)
  if (ev <= 0)
    items.push({ label: 'Expected Value', status: 'fail', hard: true, category: 'Structure',
      detail: `EV $${(ev * 100).toFixed(2)}/contract — negative expected value. The probability math does not favor this trade.` })
  else if (edge < 0.05)
    items.push({ label: 'Kelly Edge', status: 'warn', hard: false, category: 'Structure',
      detail: `EV +$${(ev * 100).toFixed(2)}/contract, but edge is only ${(edge * 100).toFixed(1)}% of max loss. Size conservatively; estimation error could erase it.` })
  else if (isIncomeSell) {
    // Income-sell strategies: evaluate on yield vs. capital, not speculative EV
    const yield_pct = rec.credit_pct_of_width ?? 0   // yield % stored here for income-sell strategies
    const collLabel = rec.strategy === 'Covered Call'
      ? 'stock position'
      : rec.strategy === 'Covered Put'
      ? 'cash collateral'
      : 'stock price'           // Short Put / Short Call
    if (yield_pct >= 1.0)
      items.push({ label: 'Income Edge', status: 'pass', hard: false, category: 'Structure',
        detail: `${yield_pct.toFixed(2)}% yield on ${collLabel} — solid income; EV positive after option-stop model. Premium well compensates for the risk of assignment.` })
    else if (yield_pct >= 0.60)
      items.push({ label: 'Income Edge', status: 'warn', hard: false, category: 'Structure',
        detail: `${yield_pct.toFixed(2)}% yield on ${collLabel} — thin premium. Verify that the income justifies the capital tied up and the assignment risk.` })
    else
      items.push({ label: 'Income Edge', status: 'fail', hard: false, category: 'Structure',
        detail: `${yield_pct.toFixed(2)}% yield on ${collLabel} — premium is too small. Low IV or wrong strike selection; the income does not compensate for risk.` })
  } else if (ev > 0.04)
    items.push({ label: 'Expected Value', status: 'pass', hard: false, category: 'Structure',
      detail: `EV +$${(ev * 100).toFixed(2)}/contract — meaningful positive edge after probability weighting. Edge ratio ${(edge * 100).toFixed(1)}%.` })
  else if (ev > 0)
    items.push({ label: 'Expected Value', status: 'warn', hard: false, category: 'Structure',
      detail: `EV +$${(ev * 100).toFixed(2)}/contract — positive but thin. Commissions and slippage may reduce the edge.` })

  // ── 10. Prob of Profit ────────────────────────────────────────────────────
  // Credit spreads are DESIGNED to have high PoP (60–75%) — that's the trade-off
  // for capped upside. Long options naturally have lower PoP (40–55%) but with
  // asymmetric reward potential that justifies the lower probability.
  if (isCredit) {
    // Income-sell strategies (covered + naked) need ≥65% PoP — higher bar for single-leg premium sellers
    const passThreshold = isIncomeSell ? 0.65 : 0.62
    const warnThreshold = isIncomeSell ? 0.55 : 0.52
    const stratDesc     = isIncomeSell ? 'income-sell strategy' : 'credit spread'
    if (pop >= passThreshold)
      items.push({ label: 'Prob of Profit', status: 'pass', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — strong probability for a ${stratDesc}. Time and statistics are on your side.` })
    else if (pop >= warnThreshold)
      items.push({ label: 'Prob of Profit', status: 'warn', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — below the typical ${(passThreshold*100).toFixed(0)}%+ target for a ${stratDesc}. The edge is thin.` })
    else
      items.push({ label: 'Prob of Profit', status: 'fail', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — too low for a ${stratDesc}. You are taking directional risk without directional reward.` })
  } else {
    if (pop >= 0.45)
      items.push({ label: 'Prob of Profit', status: 'pass', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — acceptable for a long/debit strategy where asymmetric reward compensates for lower probability.` })
    else if (pop >= 0.35)
      items.push({ label: 'Prob of Profit', status: 'warn', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — below 50/50. Needs strong conviction and a clear catalyst to justify holding.` })
    else
      items.push({ label: 'Prob of Profit', status: 'fail', hard: false, category: 'Structure',
        detail: `${(pop * 100).toFixed(0)}% PoP — probability is stacked against this trade. Consider a debit spread to reduce cost and improve PoP.` })
  }

  return items
}

/** @deprecated Verdict now comes from the backend. Kept for callers that build checklist locally. */
export function deriveVerdict(items: CheckItem[]): Verdict {
  const hardFails = items.filter(i => i.status === 'fail' && i.hard).length
  const softFails = items.filter(i => i.status === 'fail' && !i.hard).length
  if (hardFails > 0 || softFails >= 2) return 'NO GO'
  if (softFails === 1 || items.filter(i => i.status === 'warn').length >= 5) return 'CAUTION'
  return 'GO'
}

// ─── Sub-components ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<Status, React.ReactNode> = {
  pass: <CheckCircle2  size={14} className="text-emerald-400 shrink-0 mt-0.5" />,
  warn: <AlertTriangle size={14} className="text-amber-400  shrink-0 mt-0.5" />,
  fail: <XCircle       size={14} className="text-red-400    shrink-0 mt-0.5" />,
}

const VERDICT_STYLE: Record<Verdict, { bg: string; border: string; text: string; label: string; sub: string }> = {
  'GO':      { bg: 'bg-emerald-950/60', border: 'border-emerald-700', text: 'text-emerald-300', label: '✅ READY TO TRADE',      sub: 'All key criteria are met. Proceed with your planned size and exit rules.' },
  'CAUTION': { bg: 'bg-amber-950/50',   border: 'border-amber-700',   text: 'text-amber-300',   label: '⚠️ PROCEED WITH CAUTION', sub: 'Some signals are mixed. Consider reducing size or waiting for better conditions.' },
  'NO GO':   { bg: 'bg-red-950/50',     border: 'border-red-800',     text: 'text-red-300',     label: '🚫 DO NOT TRADE',         sub: 'One or more critical filters failed. The probability-weighted edge is not present.' },
}

const CAT_ORDER: Category[] = ['IV Environment', 'Directional Bias', 'Momentum', 'Timing', 'Liquidity', 'Structure']

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  rec:     Recommendation
  signals: Signals
}

export default function PreTradeChecklist({ rec, signals }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showBiasHelp, setShowBiasHelp] = useState(false)

  const items   = buildChecklist(rec, signals)
  const verdict = deriveVerdict(items)
  const passes  = items.filter(i => i.status === 'pass').length
  const warns   = items.filter(i => i.status === 'warn').length
  const fails   = items.filter(i => i.status === 'fail').length
  const vs      = VERDICT_STYLE[verdict]

  const grouped = CAT_ORDER.map(cat => ({
    cat,
    items: items.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0)

  return (
    <div className={`mx-4 mb-3 rounded-xl border ${vs.bg} ${vs.border} overflow-hidden`}>

      {/* ── Header (always visible) ── */}
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <ShieldCheck size={15} className={vs.text} />
        <span className={`text-xs font-bold ${vs.text}`}>{vs.label}</span>

        {/* Mini score pills */}
        <div className="flex items-center gap-1.5 ml-1">
          {passes > 0 && (
            <span className="text-[10px] font-bold bg-emerald-900/60 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded-full">
              {passes}✓
            </span>
          )}
          {warns > 0 && (
            <span className="text-[10px] font-bold bg-amber-900/60 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded-full">
              {warns}⚠
            </span>
          )}
          {fails > 0 && (
            <span className="text-[10px] font-bold bg-red-900/60 text-red-400 border border-red-800 px-1.5 py-0.5 rounded-full">
              {fails}✗
            </span>
          )}
        </div>

        <span className="flex-1" />
        <span className={`text-xs ${vs.text} opacity-60`}>Pre-Trade Checklist</span>
        <span className={`ml-1 ${vs.text} opacity-60`}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-3 py-3 space-y-4">

          {/* Verdict banner */}
          <div className={`p-2.5 rounded-lg border ${vs.bg} ${vs.border}`}>
            <div className={`text-xs font-bold ${vs.text}`}>{vs.label}</div>
            <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{vs.sub}</div>
          </div>

          {/* Checklist items grouped by category */}
          {grouped.map(({ cat, items: grpItems }) => (
            <div key={cat}>
              <div className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">{cat}</div>
              <div className="space-y-1.5">
                {grpItems.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    {STATUS_ICON[item.status]}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${
                        item.status === 'pass' ? 'text-emerald-300' :
                        item.status === 'warn' ? 'text-amber-300' : 'text-red-300'
                      }`}
                        title={item.label === 'Bias Confidence'
                          ? 'Measures how strongly the engine believes the directional setup is supported by trend, momentum, volume, and market context.'
                          : item.label === 'Range Conditions'
                          ? 'Checks whether the stock is range-bound or trending. Range-bound conditions support neutral strategies like iron condors.'
                          : undefined}>
                        {item.label}
                      </div>
                      <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              {cat === 'Directional Bias' && grpItems.some(i => i.label === 'Bias Confidence' && (i.status === 'warn' || i.status === 'fail')) && (
                <div className="mt-1.5">
                  <button
                    onClick={() => setShowBiasHelp(o => !o)}
                    className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    <HelpCircle size={12} />
                    {showBiasHelp ? 'Hide explanation' : 'More about Bias Confidence'}
                  </button>
                  {showBiasHelp && (
                    <div className="mt-1.5 p-2.5 rounded-lg bg-gray-800/60 border border-gray-700 text-xs space-y-1.5">
                      <p className="font-semibold text-gray-300">What Bias Confidence measures</p>
                      <p className="text-gray-400">
                        A score showing how strongly the engine believes the directional setup is valid, based on
                        trend alignment, momentum, volume, and market context.
                      </p>
                      <div className="grid gap-1 pt-1 text-gray-400">
                        <div><span className="text-emerald-400 font-semibold">80–100%:</span> Strong conviction — multiple trend systems agree. Full position sizing is reasonable.</div>
                        <div><span className="text-amber-400 font-semibold">30–60%:</span> Weak conviction — trend exists but lacks alignment. Consider smaller size or wider strikes.</div>
                        <div><span className="text-red-400 font-semibold">0–30%:</span> Very weak — directional signal is unreliable. Mitigate with wider OTM strikes or a non-directional strategy.</div>
                      </div>
                      <p className="text-gray-500 pt-1">
                        Low confidence does not mean the trade will fail — it means the directional setup lacks
                        strong confirmation. Wider strikes, smaller size, or non-directional strategies (iron condor,
                        straddle) can still work.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Entry timing reminder */}
          <div className="p-2.5 bg-gray-800/60 border border-gray-700 rounded-lg">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Entry Timing Reminder</div>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>• Wait 30–45 min after market open before entering — spreads are widest at open.</div>
              <div>• Best window: <span className="text-gray-300">10:00–11:30 AM ET</span> or <span className="text-gray-300">1:30–3:00 PM ET</span>.</div>
              <div>• For credit spreads: enter when the stock is at a <span className="text-gray-300">minor pullback</span>, not an extended move.</div>
              <div>• Check if <span className="text-gray-300">earnings fall within {rec.dte} days</span> — IV crush will destroy long options post-earnings.</div>
            </div>
          </div>

          {/* Exit rules reminder */}
          <div className="p-2.5 bg-gray-800/60 border border-gray-700 rounded-lg">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Exit Rules Before Entry</div>
            <div className="text-xs text-gray-400 space-y-0.5">
              {rec.strategy === 'Short Put' ? (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Buy back the put at 50% of credit (~${(rec.net_credit * 100 * 0.5).toFixed(0)}/contract) to lock in gains early.</div>
                  <div>• <span className="text-red-400">Stop loss:</span> Close immediately if the put doubles in value (loss = ${(rec.net_credit * 100).toFixed(0)}/contract) — never let a naked put run against you.</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Close or roll at 21 DTE — gamma risk spikes on naked short options.</div>
                </>
              ) : rec.strategy === 'Short Call' ? (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Buy back the call at 50% of credit (~${(rec.net_credit * 100 * 0.5).toFixed(0)}/contract).</div>
                  <div>• <span className="text-red-400">Stop loss:</span> Close IMMEDIATELY if the call doubles in value — unlimited upside risk makes delay dangerous.</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Close or roll at 21 DTE. Never hold a naked short call into expiry week.</div>
                </>
              ) : rec.strategy === 'Covered Call' ? (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Buy back the call at 50% of credit (~${(rec.net_credit * 100 * 0.5).toFixed(0)}/contract) to free the stock for further upside.</div>
                  <div>• <span className="text-violet-400">If called away:</span> You sell shares at ${rec.legs[0]?.strike ?? '—'} — total option return ${(rec.max_profit * 100).toFixed(0)}/contract. Accept or roll up-and-out.</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Roll or close at 21 DTE to avoid gamma acceleration on the short call.</div>
                </>
              ) : rec.strategy === 'Covered Put' ? (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Buy back the put at 50% of credit (~${(rec.net_credit * 100 * 0.5).toFixed(0)}/contract) to free up capital early.</div>
                  <div>• <span className="text-violet-400">If assigned:</span> You own shares at effective cost ${(rec.breakeven_lower).toFixed(2)} — immediately consider selling a covered call ("wheel").</div>
                  <div>• <span className="text-red-400">Stop loss:</span> Close if put triples in value (≈ 2× credit debit = ${(rec.net_credit * 100 * 2).toFixed(0)}/contract).</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Close or roll at 21 DTE if near-the-money — gamma risk spikes.</div>
                </>
              ) : rec.net_credit > 0 ? (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Close at 50% of max credit (${(rec.net_credit * 100 * 0.5).toFixed(0)}/contract collected).</div>
                  <div>• <span className="text-red-400">Stop loss:</span> Close if spread value doubles against you (2× credit = ${(rec.net_credit * 100 * 2).toFixed(0)}/contract debit).</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Close at 21 DTE regardless — gamma risk spikes in final 3 weeks.</div>
                </>
              ) : (
                <>
                  <div>• <span className="text-emerald-400">Profit target:</span> Take 50–100% gain on premium paid (${(rec.max_loss * 100 * 0.5).toFixed(0)}–${(rec.max_loss * 100).toFixed(0)}/contract).</div>
                  <div>• <span className="text-red-400">Stop loss:</span> Close if premium drops 40–50% from entry (${(rec.max_loss * 100 * 0.45).toFixed(0)}/contract loss).</div>
                  <div>• <span className="text-amber-400">Time stop:</span> Close or roll at 21 DTE — theta accelerates sharply below 3 weeks.</div>
                </>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
