import { useState, useMemo } from 'react'
import { Target, TrendingUp } from 'lucide-react'

export interface PayoffMatrix {
  prices: number[]
  columns: Array<{ daysElapsed: number; daysRemaining: number; date: string; isExpiration: boolean }>
  grid: number[][]
}

const fmtUsd = (v: number) => `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Bilinear interpolation of the BS price×time grid at (price, daysRemaining). */
function pnlAt(m: PayoffMatrix, price: number, daysRemaining: number): number {
  const prices = m.prices
  const cols = m.columns
  if (!prices.length || !cols.length) return 0
  const p = clamp(price, prices[0], prices[prices.length - 1])
  let pi = 0
  while (pi < prices.length - 2 && prices[pi + 1] < p) pi += 1
  const pSpan = prices[pi + 1] - prices[pi] || 1
  const tp = clamp((p - prices[pi]) / pSpan, 0, 1)

  // columns are ordered from most days-remaining (today) to 0 (expiration)
  const dr = clamp(daysRemaining, cols[cols.length - 1].daysRemaining, cols[0].daysRemaining)
  let cj = 0
  while (cj < cols.length - 2 && cols[cj + 1].daysRemaining > dr) cj += 1
  const cSpan = cols[cj].daysRemaining - cols[cj + 1].daysRemaining || 1
  const tc = clamp((cols[cj].daysRemaining - dr) / cSpan, 0, 1)

  const a = m.grid[pi]?.[cj] ?? 0
  const b = m.grid[pi + 1]?.[cj] ?? a
  const c = m.grid[pi]?.[cj + 1] ?? a
  const d = m.grid[pi + 1]?.[cj + 1] ?? b
  const top = a + (b - a) * tp
  const bot = c + (d - c) * tp
  return top + (bot - top) * tc
}

export default function TradeExitPlanner({
  matrix,
  stockPrice,
  targetPrice,
  breakeven,
  maxRisk,
  direction,
}: {
  matrix?: PayoffMatrix
  stockPrice: number
  targetPrice: number
  breakeven: number
  maxRisk: number
  direction: string
}) {
  const maxDays = matrix?.columns?.[0]?.daysRemaining ?? 0
  const [exitPrice, setExitPrice] = useState(() => Number((targetPrice || stockPrice).toFixed(2)))
  const [daysHeld, setDaysHeld] = useState(0)

  const pct = stockPrice > 0 ? (exitPrice / stockPrice - 1) * 100 : 0
  const daysRemaining = Math.max(0, maxDays - daysHeld)

  const pnl = useMemo(
    () => (matrix ? pnlAt(matrix, exitPrice, daysRemaining) : 0),
    [matrix, exitPrice, daysRemaining],
  )
  const denom = Math.abs(maxRisk) || 1
  const roi = (pnl / denom) * 100
  const atExpiration = matrix ? pnlAt(matrix, exitPrice, 0) : 0

  const setPct = (p: number) => setExitPrice(Number((stockPrice * (1 + p / 100)).toFixed(2)))

  const presets: Array<{ label: string; price: number; tone?: string }> = [
    { label: '−10%', price: stockPrice * 0.9 },
    { label: '−5%', price: stockPrice * 0.95 },
    { label: 'B/E', price: breakeven || stockPrice, tone: 'amber' },
    { label: 'Flat', price: stockPrice },
    { label: 'Target', price: targetPrice || stockPrice, tone: 'emerald' },
    { label: '+5%', price: stockPrice * 1.05 },
    { label: '+10%', price: stockPrice * 1.1 },
  ]

  if (!matrix || !matrix.grid?.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-surface-card p-4 text-sm text-muted dark:border-white/[0.08]">
        Exit Planner will appear once the trade evaluates.
      </div>
    )
  }

  const pnlColor = pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'

  return (
    <div className="rounded-xl border border-violet-300/70 bg-violet-50/50 p-4 dark:border-violet-500/30 dark:bg-violet-500/[0.05]">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white"><Target size={15} /></span>
        <div>
          <div className="text-sm font-black text-text-primary">Exit Planner</div>
          <div className="text-[11px] text-text-tertiary">Model your exit by price or % move and how long you hold. {direction} bias.</div>
        </div>
      </div>

      {/* Preset chips */}
      <div className="my-3 flex flex-wrap gap-1.5">
        {presets.map(pz => {
          const active = Math.abs(pz.price - exitPrice) < 0.005
          const tone = pz.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : pz.tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-text-secondary'
          return (
            <button key={pz.label} type="button" onClick={() => setExitPrice(Number(pz.price.toFixed(2)))}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${active ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : `border-slate-200 ${tone} hover:border-violet-400 dark:border-white/[0.1]`}`}>
              {pz.label}
            </button>
          )
        })}
      </div>

      {/* Price + % inputs */}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">
          Exit price
          <input type="number" step="0.01" value={exitPrice}
            onChange={e => setExitPrice(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-surface-canvas px-3 py-2 font-mono text-sm font-bold text-text-primary outline-none focus:border-violet-500 dark:border-white/[0.1]" />
        </label>
        <label className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">
          Move from ${stockPrice.toFixed(2)}
          <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-surface-canvas px-3 dark:border-white/[0.1]">
            <input type="number" step="0.5" value={Number(pct.toFixed(1))}
              onChange={e => setPct(Number(e.target.value))}
              className="w-full bg-transparent py-2 font-mono text-sm font-bold text-text-primary outline-none" />
            <span className="text-sm font-bold text-text-tertiary">%</span>
          </div>
        </label>
      </div>

      {/* Days held slider */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-text-tertiary">
          <span>Days held</span>
          <span className="font-mono text-text-secondary">{daysHeld}d held · {daysRemaining}d left</span>
        </div>
        <input type="range" min={0} max={Math.max(1, maxDays)} step={1} value={Math.min(daysHeld, maxDays)}
          onChange={e => setDaysHeld(Number(e.target.value))}
          className="mt-1 w-full accent-violet-600" />
      </div>

      {/* Result */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">Projected P&amp;L</div>
          <div className={`font-mono text-2xl font-black tabular-nums ${pnlColor}`}>{pnl >= 0 ? '+' : '−'}{fmtUsd(pnl)}</div>
          <div className={`font-mono text-xs font-bold ${pnlColor}`}>{roi >= 0 ? '+' : '−'}{Math.abs(roi).toFixed(0)}% on risk</div>
        </div>
        <div className="text-right text-[11px] leading-relaxed text-text-secondary">
          <div className="flex items-center gap-1 justify-end"><TrendingUp size={12} className="text-text-tertiary" /> at <span className="font-mono font-bold text-text-primary">${exitPrice.toFixed(2)}</span> in {daysHeld}d</div>
          <div>If held to expiry: <span className={`font-mono font-bold ${atExpiration >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{atExpiration >= 0 ? '+' : '−'}{fmtUsd(atExpiration)}</span></div>
          <div className="text-text-tertiary">Max loss {fmtUsd(-Math.abs(maxRisk))} · B/E ${(breakeven || 0).toFixed(2)}</div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-text-tertiary">Estimated with Black-Scholes across price and time — educational, not a fill guarantee.</div>
    </div>
  )
}
