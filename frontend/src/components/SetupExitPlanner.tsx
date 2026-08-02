import { useState, useMemo } from 'react'
import { Target } from 'lucide-react'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const money = (v: number) => `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Exit Planner for directional underlying setups (Day / Swing).
 * Given entry / stop / target levels, model an exit by price or %-move and see
 * the R-multiple, P&L per share, and progress to target.
 */
export default function SetupExitPlanner({
  entry,
  stop,
  target,
  target2,
  current,
  direction,
  compact = false,
}: {
  entry?: number | null
  stop?: number | null
  target?: number | null
  target2?: number | null
  current?: number | null
  direction?: string
  compact?: boolean
}) {
  const isLong = !/bear|short|put|down/i.test(String(direction || 'long'))
  const e = Number(entry) || 0
  const s = Number(stop) || 0
  const t1 = Number(target) || 0
  const t2 = Number(target2) || 0
  const ref = Number(current) || e

  const risk = Math.abs(e - s)
  const [exit, setExit] = useState(() => (t1 > 0 ? t1 : ref || e))

  const pnl = isLong ? exit - e : e - exit
  const r = risk > 0 ? pnl / risk : null
  const movePct = e > 0 ? (exit / e - 1) * 100 : 0
  const toTargetPct = useMemo(() => {
    if (!t1 || t1 === e) return null
    return clamp((isLong ? (exit - e) / (t1 - e) : (e - exit) / (e - t1)) * 100, -50, 150)
  }, [exit, e, t1, isLong])

  if (!e || !s) {
    return (
      <div className="rounded-xl border border-slate-200 bg-surface-card p-3 text-xs text-muted dark:border-white/[0.08]">
        Exit Planner needs entry and stop levels from the engine.
      </div>
    )
  }

  const rPrice = (mult: number) => (isLong ? e + risk * mult : e - risk * mult)
  const presets: Array<{ label: string; price: number; tone?: string }> = [
    { label: 'Stop', price: s, tone: 'rose' },
    { label: 'Entry', price: e },
    { label: '+1R', price: rPrice(1) },
    ...(t1 ? [{ label: 'Target', price: t1, tone: 'emerald' }] : []),
    ...(t2 ? [{ label: 'Target 2', price: t2, tone: 'emerald' }] : []),
    { label: '+2R', price: rPrice(2) },
  ]

  const setPct = (p: number) => setExit(Number((e * (1 + p / 100)).toFixed(2)))
  const rColor = (r ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'

  // progress bar geometry: stop → entry → target1
  const lo = Math.min(s, t1 || s, e), hi = Math.max(s, t1 || s, e)
  const posOf = (v: number) => (hi > lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 50)

  return (
    <div className={`rounded-xl border border-violet-300/70 bg-violet-50/50 dark:border-violet-500/30 dark:bg-violet-500/[0.05] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600 text-white"><Target size={13} /></span>
        <div className="text-sm font-black text-text-primary">Exit Planner</div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">{isLong ? 'Long' : 'Short'} · risk {money(risk)}/sh</span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map(pz => {
          const active = Math.abs(pz.price - exit) < 0.005
          const tone = pz.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : pz.tone === 'rose' ? 'text-rose-700 dark:text-rose-300' : 'text-text-secondary'
          return (
            <button key={pz.label} type="button" onClick={() => setExit(Number(pz.price.toFixed(2)))}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${active ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : `border-slate-200 ${tone} hover:border-violet-400 dark:border-white/[0.1]`}`}>
              {pz.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">
          Exit price
          <input type="number" step="0.01" value={exit} onChange={ev => setExit(Number(ev.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-surface-canvas px-3 py-2 font-mono text-sm font-bold text-text-primary outline-none focus:border-violet-500 dark:border-white/[0.1]" />
        </label>
        <label className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">
          Move from {e.toFixed(2)}
          <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-surface-canvas px-3 dark:border-white/[0.1]">
            <input type="number" step="0.1" value={Number(movePct.toFixed(1))} onChange={ev => setPct(Number(ev.target.value))}
              className="w-full bg-transparent py-2 font-mono text-sm font-bold text-text-primary outline-none" />
            <span className="text-sm font-bold text-text-tertiary">%</span>
          </div>
        </label>
      </div>

      {/* stop → entry → target bar */}
      <div className="relative mt-3 h-2 rounded-full bg-slate-200 dark:bg-white/[0.08]">
        <div className="absolute -top-4 text-[9px] font-bold text-rose-500" style={{ left: `${posOf(s)}%`, transform: 'translateX(-50%)' }}>S</div>
        <div className="absolute -top-4 text-[9px] font-bold text-text-tertiary" style={{ left: `${posOf(e)}%`, transform: 'translateX(-50%)' }}>E</div>
        {t1 ? <div className="absolute -top-4 text-[9px] font-bold text-emerald-500" style={{ left: `${posOf(t1)}%`, transform: 'translateX(-50%)' }}>T</div> : null}
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-violet-600 shadow dark:border-slate-900" style={{ left: `${posOf(exit)}%`, transform: 'translate(-50%,-50%)' }} />
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-text-tertiary">R-Multiple</div>
          <div className={`font-mono text-2xl font-black tabular-nums ${rColor}`}>{r != null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : '—'}</div>
        </div>
        <div className="text-right text-[11px] leading-relaxed text-text-secondary">
          <div>P&amp;L: <span className={`font-mono font-bold ${rColor}`}>{pnl >= 0 ? '+' : '−'}{money(pnl)}/sh</span></div>
          {toTargetPct != null && <div>{toTargetPct.toFixed(0)}% of the way to target</div>}
          <div className="text-text-tertiary">Stop {money(s)} · Target {t1 ? money(t1) : '—'}</div>
        </div>
      </div>
    </div>
  )
}
