import { ArrowUp, ArrowDown, CalendarClock } from 'lucide-react'

export interface PriorSession { date: string; open: number; high: number; low: number; close: number; vwap: number }
export interface PriorContext {
  lastPrice?: number | null
  prevClose?: number | null
  vwap?: number | null
  ema20?: number | null
  ema50?: number | null
  ema150?: number | null
  priorSessions?: PriorSession[]
}

const fmt = (v?: number | null) => (v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—')
const shortDate = (d: string) => {
  const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/)
  const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function Ref({ label, value, price }: { label: string; value?: number | null; price?: number | null }) {
  const has = value != null && Number.isFinite(value) && price != null && Number.isFinite(price)
  const above = has && (price as number) >= (value as number)
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-white/[0.08]">
      <span className="text-[10px] font-bold uppercase tracking-wide text-tertiary">{label}</span>
      <span className="flex items-center gap-1 font-mono text-xs font-bold tabular-nums text-heading">
        {fmt(value)}
        {has && (above
          ? <ArrowUp size={12} className="text-emerald-500" />
          : <ArrowDown size={12} className="text-rose-500" />)}
      </span>
    </div>
  )
}

export default function DayTradePriorContext({ ctx }: { ctx?: PriorContext | null }) {
  if (!ctx) return null
  const price = ctx.lastPrice ?? null
  const sessions = (ctx.priorSessions ?? []).slice(-3).reverse()
  const prev = sessions[0]
  const prevVwap = prev?.vwap ?? null

  // Lean: how many key references the current price sits above
  const refs = [ctx.prevClose, prevVwap, ctx.ema20, ctx.ema50].filter((v): v is number => v != null && Number.isFinite(v))
  const above = price != null ? refs.filter(v => price >= v).length : 0
  const lean = refs.length === 0 || price == null
    ? { label: 'No data', cls: 'text-tertiary' }
    : above >= 3 ? { label: 'Leaning Long', cls: 'text-emerald-600 dark:text-emerald-400' }
    : above <= 1 ? { label: 'Leaning Short', cls: 'text-rose-600 dark:text-rose-400' }
    : { label: 'Mixed / At Balance', cls: 'text-amber-600 dark:text-amber-400' }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarClock size={14} className="text-violet-500" />
          <span className="text-[11px] font-black uppercase tracking-widest text-tertiary">Prior-Day Context</span>
        </div>
        <span className={`text-xs font-black ${lean.cls}`}>{price != null ? `${fmt(price)} · ${lean.label}` : lean.label}</span>
      </div>

      {/* current price vs key references */}
      <div className="grid grid-cols-2 gap-1.5">
        <Ref label="Prev Close" value={ctx.prevClose} price={price} />
        <Ref label="Prev VWAP" value={prevVwap} price={price} />
        <Ref label="EMA 20" value={ctx.ema20} price={price} />
        <Ref label="EMA 50" value={ctx.ema50} price={price} />
      </div>

      {/* trailing sessions table */}
      {sessions.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.08]">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-tertiary dark:bg-slate-900">
              <tr>
                <th className="px-2 py-1 text-left font-black">Session</th>
                <th className="px-2 py-1 text-right font-black">Close</th>
                <th className="px-2 py-1 text-right font-black">VWAP</th>
                <th className="px-2 py-1 text-right font-black">Range</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.date} className="border-t border-slate-100 dark:border-white/[0.06]">
                  <td className="px-2 py-1 font-semibold text-secondary">{shortDate(s.date)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-heading">{fmt(s.close)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-violet-600 dark:text-violet-300">{fmt(s.vwap)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-tertiary">{fmt(s.low)}–{fmt(s.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-tertiary">Current price vs prior-day close, prior VWAP, and EMAs — a quick long/short lean from the multi-day picture.</div>
    </div>
  )
}
