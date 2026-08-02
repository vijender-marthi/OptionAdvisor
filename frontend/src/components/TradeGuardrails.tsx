import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

const BULLISH = new Set(['Long Call', 'Bull Call Spread', 'Bull Put Spread', 'Cash Secured Put', 'Covered Call'])
const BEARISH = new Set(['Long Put', 'Bear Put Spread', 'Bear Call Spread'])

type Sev = 'block' | 'warn' | 'ok'
interface Check { sev: Sev; title: string; detail: string }

export interface GuardrailInputs {
  direction: string
  strategy: string
  premium: number
  stockPrice: number
  targetPrice: number
  chainMid?: number | null
  chainBid?: number | null
  chainAsk?: number | null
  openInterest?: number | null
  expectedValue?: number
  theta?: number
  delta?: number
  checklistDone: number
  checklistTotal: number
  invalidatesFilled: boolean
}

export function buildGuardrails(x: GuardrailInputs): Check[] {
  const checks: Check[] = []
  const strat = x.strategy

  // Rule 1 — Direction ↔ Strategy contradiction (blocking)
  const stratBias = BULLISH.has(strat) ? 'Bullish' : BEARISH.has(strat) ? 'Bearish' : 'Neutral'
  if (stratBias !== 'Neutral' && (x.direction === 'Bullish' || x.direction === 'Bearish') && x.direction !== stratBias) {
    const targetSide = x.targetPrice > x.stockPrice ? 'above' : 'below'
    checks.push({
      sev: 'block',
      title: 'Direction and strategy contradict each other',
      detail: `Direction ${x.direction} + ${strat} (a ${stratBias.toLowerCase()} instrument). Target $${x.targetPrice.toFixed(2)} is ${targetSide} spot. Set Direction = ${stratBias}, or change the strategy — everything downstream (trend score, alternatives) is answering the wrong question.`,
    })
  } else if (stratBias !== 'Neutral' && x.direction === 'Neutral') {
    checks.push({
      sev: 'warn',
      title: 'Neutral direction with a directional strategy',
      detail: `${strat} is a ${stratBias.toLowerCase()} instrument. Set Direction = ${stratBias} so scoring and alternatives align.`,
    })
  }

  // Rule 2 — Premium vs live chain mid (> 5% deviation)
  const mid = x.chainMid ?? 0
  if (mid > 0 && x.premium > 0) {
    const dev = Math.abs(x.premium - mid) / mid
    if (dev > 0.05) {
      checks.push({
        sev: 'warn',
        title: `Premium is ${(dev * 100).toFixed(0)}% off the live chain mid`,
        detail: `You entered $${x.premium.toFixed(2)}; chain mid is $${mid.toFixed(2)}${x.chainBid != null && x.chainAsk != null ? ` (bid $${x.chainBid.toFixed(2)} / ask $${x.chainAsk.toFixed(2)})` : ''}. Cost basis, breakeven, max loss and every metric below are computed off this — confirm the strike/premium.`,
      })
    }
  }

  // Rule 5 — Liquidity (spread > 8% of mid, or OI < 200)
  if (x.chainBid != null && x.chainAsk != null && mid > 0) {
    const spreadPct = ((x.chainAsk - x.chainBid) / mid) * 100
    if (spreadPct > 8) {
      checks.push({
        sev: 'warn',
        title: `Wide bid/ask spread (${spreadPct.toFixed(0)}% of mid)`,
        detail: `A market-order round trip surrenders ~${(spreadPct / 2).toFixed(0)}% before the thesis plays out. Use limit orders at mid only.`,
      })
    }
  }
  if (x.openInterest != null && x.openInterest > 0 && x.openInterest < 200) {
    checks.push({ sev: 'warn', title: `Thin open interest (${x.openInterest})`, detail: 'Open interest under 200 — fills and exits may be difficult. Consider a more liquid strike.' })
  }

  // Rule 7 — Negative expected value requires an override rationale
  if (x.expectedValue != null && x.expectedValue < 0) {
    checks.push({ sev: 'warn', title: 'Expected value is negative', detail: 'Document why you are taking a negative-EV trade (edge the model misses) before proceeding.' })
  }

  // Rule 3 — What-invalidates must be filled
  if (!x.invalidatesFilled) {
    checks.push({ sev: 'block', title: '“What invalidates the trade?” is blank', detail: 'A blank invalidation is a belief, not a thesis. Write the price/level that kills the trade before saving.' })
  }

  // Rule 4 — Checklist must be complete
  if (x.checklistDone < x.checklistTotal) {
    checks.push({ sev: 'warn', title: `Checklist ${x.checklistDone}/${x.checklistTotal} complete`, detail: 'An unchecked worksheet is not a completed worksheet — including stop defined, size acceptable, and emotional-decision avoided.' })
  }

  return checks
}

/** Underlying move needed each day just to offset theta: |theta| / |delta|. */
export function dailyBreakevenDrift(theta?: number, delta?: number, stockPrice?: number): { dollars: number; pct: number } | null {
  if (!theta || !delta || !stockPrice || Math.abs(delta) < 1e-6) return null
  const dollars = Math.abs(theta) / Math.abs(delta)
  return { dollars, pct: (dollars / stockPrice) * 100 }
}

export default function TradeGuardrails(props: GuardrailInputs) {
  const checks = buildGuardrails(props)
  const blocks = checks.filter(c => c.sev === 'block').length
  const drift = dailyBreakevenDrift(props.theta, props.delta, props.stockPrice)

  if (checks.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 size={16} /> Pre-trade guardrails clear — inputs are internally consistent.
        </div>
        {drift && (
          <div className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
            Daily breakeven drift: <b>${drift.dollars.toFixed(2)}/day ({drift.pct.toFixed(2)}% of spot)</b> — the underlying must move this much every day just to offset theta.
          </div>
        )}
      </div>
    )
  }

  const border = blocks > 0 ? 'border-rose-400 dark:border-rose-500/40' : 'border-amber-400 dark:border-amber-500/40'
  const bg = blocks > 0 ? 'bg-rose-50 dark:bg-rose-500/[0.07]' : 'bg-amber-50 dark:bg-amber-500/[0.07]'

  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={18} className={blocks > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'} />
        <div className="text-sm font-black text-text-primary">
          {blocks > 0
            ? `${blocks} blocking ${blocks === 1 ? 'error' : 'errors'} — don’t judge the trade until fixed`
            : `${checks.length} guardrail ${checks.length === 1 ? 'warning' : 'warnings'}`}
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            {c.sev === 'block'
              ? <XCircle size={15} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" />
              : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />}
            <div>
              <div className="text-[13px] font-bold text-text-primary">{c.title}</div>
              <div className="text-[11px] leading-relaxed text-text-secondary">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>

      {drift && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-[11px] text-text-secondary dark:border-white/[0.08] dark:bg-slate-950/50">
          <b className="text-text-primary">Daily breakeven drift:</b> ${drift.dollars.toFixed(2)}/day ({drift.pct.toFixed(2)}% of spot) — the underlying must move this much every day just to offset theta. Theta accelerates as expiry nears.
        </div>
      )}
    </div>
  )
}
