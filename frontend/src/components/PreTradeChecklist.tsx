import { useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react'
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

export function buildChecklist(rec: Recommendation, sig: Signals): CheckItem[] {
  const items: CheckItem[] = []
  const isCredit  = rec.net_credit > 0
  const isBullish = rec.bias.toUpperCase().includes('BULLISH')
  const isBearish = rec.bias.toUpperCase().includes('BEARISH')
  const isNeutral = !isBullish && !isBearish

  // ── 1. IV Environment ────────────────────────────────────────────────────
  const ivr = sig.iv_rank
  if (isCredit) {
    if (ivr >= 45)
      items.push({ label: 'IV Environment', status: 'pass', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — elevated, premium is rich. Selling credit has a statistical edge.` })
    else if (ivr >= 20)
      items.push({ label: 'IV Environment', status: 'warn', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — moderate IV. Credit edge exists but premium is thinner than ideal.` })
    else
      items.push({ label: 'IV Environment', status: 'fail', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — low IV. Premium collected is minimal; gap risk exceeds reward.` })
  } else {
    if (ivr <= 40)
      items.push({ label: 'IV Environment', status: 'pass', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — reasonable premium cost. IV expansion potential adds to upside.` })
    else if (ivr <= 65)
      items.push({ label: 'IV Environment', status: 'warn', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — elevated IV. Long options face IV crush risk; size conservatively.` })
    else
      items.push({ label: 'IV Environment', status: 'fail', hard: false, category: 'IV Environment',
        detail: `IV Rank ${ivr.toFixed(0)}% — high IV. Long options face significant IV crush risk even if direction is right.` })
  }

  // ── 2. Bias Confidence ────────────────────────────────────────────────────
  const conf = sig.bias_confidence * 100
  if (conf >= 55)
    items.push({ label: 'Bias Confidence', status: 'pass', hard: false, category: 'Directional Bias',
      detail: `${conf.toFixed(0)}% confidence — solid signal agreement across indicators.` })
  else if (conf >= 35)
    items.push({ label: 'Bias Confidence', status: 'warn', hard: false, category: 'Directional Bias',
      detail: `${conf.toFixed(0)}% confidence — moderate conviction. Consider smaller size.` })
  else
    items.push({ label: 'Bias Confidence', status: 'fail', hard: false, category: 'Directional Bias',
      detail: `${conf.toFixed(0)}% confidence — weak directional conviction. High uncertainty in outcome.` })

  // ── 3. Trend Alignment (MA) ───────────────────────────────────────────────
  if (isBullish) {
    if (sig.above_ma50 && sig.ma50_slope > 0)
      items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
        detail: 'Price above rising MA50 — trend structure supports bullish bias.' })
    else if (sig.above_ma50 || sig.ma50_slope > 0)
      items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
        detail: 'Partial trend support — price or MA50 slope is mixed.' })
    else
      items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
        detail: 'Price below declining MA50 — trend is working against a bullish trade.' })
  } else if (isBearish) {
    if (!sig.above_ma50 && sig.ma50_slope < 0)
      items.push({ label: 'Trend Alignment', status: 'pass', hard: false, category: 'Directional Bias',
        detail: 'Price below declining MA50 — trend structure supports bearish bias.' })
    else if (!sig.above_ma50 || sig.ma50_slope < 0)
      items.push({ label: 'Trend Alignment', status: 'warn', hard: false, category: 'Directional Bias',
        detail: 'Partial trend alignment — some bearish signals but not full confirmation.' })
    else
      items.push({ label: 'Trend Alignment', status: 'fail', hard: false, category: 'Directional Bias',
        detail: 'Price above rising MA50 — trend is working against a bearish trade.' })
  } else {
    const flat = Math.abs(sig.ma50_slope) < 0.0015
    items.push({ label: 'Trend Alignment', status: flat ? 'pass' : 'warn', hard: false, category: 'Directional Bias',
      detail: flat
        ? 'Flat MA50 slope — sideways price action supports a neutral / range-bound strategy.'
        : 'MA50 has a directional slope — neutral strategy carries trend risk on one side.' })
  }

  // ── 4. RSI ────────────────────────────────────────────────────────────────
  const rsi = sig.rsi
  if (isBullish && rsi > 75)
    items.push({ label: 'RSI Extreme', status: 'fail', hard: false, category: 'Momentum',
      detail: `RSI ${rsi.toFixed(1)} — overbought. High risk of a pullback before your expiry.` })
  else if (isBullish && rsi > 68)
    items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
      detail: `RSI ${rsi.toFixed(1)} — elevated. Consider waiting for a dip entry to improve premium.` })
  else if (isBearish && rsi < 25)
    items.push({ label: 'RSI Extreme', status: 'fail', hard: false, category: 'Momentum',
      detail: `RSI ${rsi.toFixed(1)} — oversold. High risk of a bounce before your expiry.` })
  else if (isBearish && rsi < 32)
    items.push({ label: 'RSI Level', status: 'warn', hard: false, category: 'Momentum',
      detail: `RSI ${rsi.toFixed(1)} — low. Watch for a short-term bounce before continuing lower.` })
  else
    items.push({ label: 'RSI Level', status: 'pass', hard: false, category: 'Momentum',
      detail: `RSI ${rsi.toFixed(1)} (${sig.rsi_signal}) — not at an extreme. No immediate reversal risk from momentum.` })

  // ── 5. MACD Confirmation ──────────────────────────────────────────────────
  const hist = sig.macd_histogram
  if (isBullish) {
    if (hist > 0 && sig.macd > sig.macd_signal_line)
      items.push({ label: 'MACD Confirmation', status: 'pass', hard: false, category: 'Momentum',
        detail: 'MACD above signal line, positive histogram — bullish momentum is confirmed.' })
    else if (hist > 0 || sig.macd > sig.macd_signal_line)
      items.push({ label: 'MACD Confirmation', status: 'warn', hard: false, category: 'Momentum',
        detail: 'Mixed MACD — partial bullish signal. Wait for histogram to turn positive.' })
    else
      items.push({ label: 'MACD Confirmation', status: 'fail', hard: false, category: 'Momentum',
        detail: 'MACD below signal line — momentum does not yet support this bullish trade.' })
  } else if (isBearish) {
    if (hist < 0 && sig.macd < sig.macd_signal_line)
      items.push({ label: 'MACD Confirmation', status: 'pass', hard: false, category: 'Momentum',
        detail: 'MACD below signal line, negative histogram — bearish momentum is confirmed.' })
    else if (hist < 0 || sig.macd < sig.macd_signal_line)
      items.push({ label: 'MACD Confirmation', status: 'warn', hard: false, category: 'Momentum',
        detail: 'Mixed MACD — partial bearish signal. Momentum shift still developing.' })
    else
      items.push({ label: 'MACD Confirmation', status: 'fail', hard: false, category: 'Momentum',
        detail: 'MACD above signal line — momentum does not support this bearish trade.' })
  } else {
    items.push({ label: 'MACD Confirmation', status: Math.abs(hist) < 0.5 ? 'pass' : 'warn', hard: false, category: 'Momentum',
      detail: `Neutral strategy — MACD histogram ${hist.toFixed(2)}. Low directional MACD momentum is preferred for range plays.` })
  }

  // ── 6. DTE ────────────────────────────────────────────────────────────────
  const dte = rec.dte
  if (isCredit) {
    if (dte >= 21 && dte <= 45)
      items.push({ label: 'DTE Window', status: 'pass', hard: false, category: 'Timing',
        detail: `${dte} DTE — ideal theta decay zone (21-45) for credit spreads.` })
    else if (dte > 45 && dte <= 60)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — slightly long. Theta decay is slower; consider a nearer expiry.` })
    else if (dte >= 14 && dte < 21)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — short window. Gamma risk rises; manage this position actively.` })
    else if (dte < 14)
      items.push({ label: 'DTE Window', status: 'fail', hard: true, category: 'Timing',
        detail: `${dte} DTE — dangerously short. Gamma risk is extreme for credit spreads under 2 weeks.` })
    else
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — beyond 60 days. Theta decay is slow; capital tied up longer than needed.` })
  } else {
    if (dte >= 21 && dte <= 70)
      items.push({ label: 'DTE Window', status: 'pass', hard: false, category: 'Timing',
        detail: `${dte} DTE — workable range (21-70) for long options. Theta decay is manageable.` })
    else if (dte > 70)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — longer than needed. More capital at risk and theta decay is slow.` })
    else if (dte >= 14)
      items.push({ label: 'DTE Window', status: 'warn', hard: false, category: 'Timing',
        detail: `${dte} DTE — short. Theta is accelerating; move quickly or choose a later expiry.` })
    else
      items.push({ label: 'DTE Window', status: 'fail', hard: true, category: 'Timing',
        detail: `${dte} DTE — too short. Theta destruction is severe for long options under 2 weeks.` })
  }

  // ── 7. Liquidity ──────────────────────────────────────────────────────────
  items.push({
    label: 'Liquidity', status: rec.passes_liquidity_filter ? 'pass' : 'fail',
    hard: !rec.passes_liquidity_filter, category: 'Liquidity',
    detail: rec.passes_liquidity_filter
      ? 'Bid-ask spreads and open interest meet minimum thresholds. Fills should be clean.'
      : 'One or more legs have wide spreads or thin OI. Expect slippage on entry and exit.',
  })

  // ── 8. Risk / Reward ──────────────────────────────────────────────────────
  const rr = rec.passes_rr_filter
  const cr = rec.passes_credit_filter
  if (rr && cr)
    items.push({ label: 'Risk / Reward', status: 'pass', hard: false, category: 'Structure',
      detail: `Credit ${rec.credit_pct_of_width.toFixed(0)}% of width, RR ${rec.risk_reward_ratio.toFixed(1)}x — structure passes both filters.` })
  else if (rr || cr)
    items.push({ label: 'Risk / Reward', status: 'warn', hard: false, category: 'Structure',
      detail: `Marginal structure — credit ${rec.credit_pct_of_width.toFixed(0)}% of width, RR ${rec.risk_reward_ratio.toFixed(1)}x. One filter missed.` })
  else
    items.push({ label: 'Risk / Reward', status: 'fail', hard: false, category: 'Structure',
      detail: `Credit ${rec.credit_pct_of_width.toFixed(0)}% of width, RR ${rec.risk_reward_ratio.toFixed(1)}x — fails both minimum thresholds.` })

  // ── 9. Expected Value ─────────────────────────────────────────────────────
  const ev = rec.expected_value
  if (ev > 0.04)
    items.push({ label: 'Expected Value', status: 'pass', hard: false, category: 'Structure',
      detail: `EV +$${(ev * 100).toFixed(2)}/contract — probability-weighted outcome is meaningfully positive.` })
  else if (ev > 0)
    items.push({ label: 'Expected Value', status: 'warn', hard: false, category: 'Structure',
      detail: `EV +$${(ev * 100).toFixed(2)}/contract — thin edge. Commissions and slippage may erase it.` })
  else
    items.push({ label: 'Expected Value', status: 'fail', hard: true, category: 'Structure',
      detail: `EV $${(ev * 100).toFixed(2)}/contract — negative expected value. Mathematical edge is not present.` })

  // ── 10. Prob of Profit ────────────────────────────────────────────────────
  const pop = rec.prob_of_profit
  if (pop >= 0.65)
    items.push({ label: 'Prob of Profit', status: 'pass', hard: false, category: 'Structure',
      detail: `${(pop * 100).toFixed(0)}% PoP — favorable odds at expiry.` })
  else if (pop >= 0.50)
    items.push({ label: 'Prob of Profit', status: 'warn', hard: false, category: 'Structure',
      detail: `${(pop * 100).toFixed(0)}% PoP — marginal. Verify your directional conviction before sizing up.` })
  else
    items.push({ label: 'Prob of Profit', status: 'fail', hard: false, category: 'Structure',
      detail: `${(pop * 100).toFixed(0)}% PoP — probability is not in your favor.` })

  return items
}

export function deriveVerdict(items: CheckItem[]): Verdict {
  const hardFails = items.filter(i => i.status === 'fail' && i.hard).length
  const softFails = items.filter(i => i.status === 'fail' && !i.hard).length
  const warns     = items.filter(i => i.status === 'warn').length
  if (hardFails > 0 || softFails >= 2) return 'NO GO'
  if (softFails === 1 || warns >= 5)   return 'CAUTION'
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
        <div className="border-t border-white/10 px-3 py-3 space-y-4">

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
                      }`}>
                        {item.label}
                      </div>
                      <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
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
              {rec.net_credit > 0 ? (
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
