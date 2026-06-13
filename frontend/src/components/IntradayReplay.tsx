import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Play, Pause, ChevronRight, ChevronLast, RotateCcw,
  Key, Plus, Trash2, TrendingUp, TrendingDown, CheckCircle2, XCircle,
  BarChart3, Activity, AlertTriangle, Info,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Bar {
  datetime: string   // "2024-01-15 09:30:00"
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface TradeLogEntry {
  id: number
  barIndex: number
  time: string
  setupType: string
  direction: 'long' | 'short'
  entry: number
  stop: number
  t1: number
  t2: number
}

interface TradeResult extends TradeLogEntry {
  t1Hit: boolean
  t2Hit: boolean
  stopped: boolean
  exitPrice: number
  exitTime?: string
  pnl: number
}

interface SessionRecord {
  date: string
  ticker: string
  results: TradeResult[]
}

const SETUP_TYPES = [
  'OR Breakout', 'VWAP Retest', 'VWAP Reclaim',
  'Pullback Reset', '1σ Bounce', '2σ Rejection', 'Other',
]

const SPEED_OPTS = [
  { label: '1×', ms: 700 },
  { label: '2×', ms: 300 },
  { label: '5×', ms: 120 },
  { label: '10×', ms: 40 },
  { label: '⚡', ms: 8 },
]

const OR_OPTS = [5, 10, 15, 30]

const LS_KEY_API  = 'oa_replay_td_key'
const LS_KEY_HIST = 'oa_replay_history'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(dt: string): string { return dt.slice(11, 16) }
function fp(n: number): string { return n.toFixed(2) }

function loadHistory(): SessionRecord[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_HIST) ?? '[]') } catch { return [] }
}
function saveHistory(h: SessionRecord[]) {
  localStorage.setItem(LS_KEY_HIST, JSON.stringify(h.slice(-30)))
}

// ─── VWAP + Bands ────────────────────────────────────────────────────────────

function calcSeries(bars: Bar[]) {
  let sumTPV = 0, sumV = 0, sumSqDev = 0
  const vwap: number[] = [], std: number[] = []
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3
    sumTPV += tp * b.volume
    sumV   += b.volume
    const v = sumV > 0 ? sumTPV / sumV : tp
    sumSqDev += (tp - v) ** 2 * b.volume
    vwap.push(v)
    std.push(sumV > 0 ? Math.sqrt(sumSqDev / sumV) : 0)
  }
  return { vwap, std }
}

// ─── Outcome Evaluation ──────────────────────────────────────────────────────

function evaluateTrades(logs: TradeLogEntry[], bars: Bar[]): TradeResult[] {
  return logs.map(log => {
    const rest = bars.slice(log.barIndex + 1)
    let t1Hit = false, t2Hit = false, stopped = false
    let exitPrice = log.entry, exitTime: string | undefined
    const isLong = log.direction === 'long'

    for (const b of rest) {
      if (!t1Hit && !stopped) {
        const hitStop = isLong ? b.low  <= log.stop : b.high >= log.stop
        const hitT1   = isLong ? b.high >= log.t1   : b.low  <= log.t1
        if (hitStop && (!hitT1 || log.stop === log.t1)) {
          stopped = true; exitPrice = log.stop; exitTime = fmtTime(b.datetime); break
        } else if (hitT1) {
          t1Hit = true; exitPrice = log.t1; exitTime = fmtTime(b.datetime)
        } else if (hitStop) {
          stopped = true; exitPrice = log.stop; exitTime = fmtTime(b.datetime); break
        }
      } else if (t1Hit && !t2Hit && log.t2 > 0) {
        const hitBE = isLong ? b.low <= log.entry : b.high >= log.entry
        const hitT2 = isLong ? b.high >= log.t2  : b.low  <= log.t2
        if (hitT2) {
          t2Hit = true; exitPrice = log.t2; exitTime = fmtTime(b.datetime); break
        }
        if (hitBE) { exitPrice = log.entry; break }
      } else if (t1Hit) { break }
    }

    const pnl = isLong ? exitPrice - log.entry : log.entry - exitPrice
    return { ...log, t1Hit, t2Hit, stopped, exitPrice, exitTime, pnl }
  })
}

// ─── Chart ───────────────────────────────────────────────────────────────────

const CP = { t: 20, r: 76, b: 40, l: 62 }

function ReplayChart({ bars, playhead, vwapSeries, stdSeries, orH, orL, orMinutes, logs }: {
  bars: Bar[]
  playhead: number
  vwapSeries: number[]
  stdSeries: number[]
  orH: number
  orL: number
  orMinutes: number
  logs: TradeLogEntry[]
}) {
  const visible = bars.slice(0, playhead + 1)
  const n = visible.length
  const W = 900, H = 400
  const IW = W - CP.l - CP.r
  const IH = H - CP.t - CP.b

  const vwap = vwapSeries.slice(0, n)
  const sigNow = stdSeries[n - 1] ?? 0
  const vwapNow = vwap[n - 1] ?? 0

  // Price range
  const prices = visible.flatMap(b => [b.high, b.low])
  const extra: number[] = []
  if (n >= orMinutes) {
    if (orH > 0) extra.push(orH)
    if (orL > 0) extra.push(orL)
  }
  if (vwapNow > 0) { extra.push(vwapNow + sigNow * 2.1, vwapNow - sigNow * 2.1) }
  const allP = [...prices, ...extra].filter(v => isFinite(v) && v > 0)
  if (allP.length === 0) return null
  const pMin = Math.min(...allP) * 0.9995
  const pMax = Math.max(...allP) * 1.0005
  const pRange = pMax - pMin || 1

  const xOf = (i: number) => CP.l + ((i + 0.5) / n) * IW
  const yOf = (p: number) => CP.t + IH - ((p - pMin) / pRange) * IH
  const cw = Math.max(1, Math.min(9, IW / n - 1))

  // Polylines
  const pts = (arr: number[]) => arr.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')
  const vwapPts  = pts(vwap)
  const u1 = vwap.map((v, i) => v + (stdSeries[i] ?? 0))
  const l1 = vwap.map((v, i) => v - (stdSeries[i] ?? 0))
  const u2 = vwap.map((v, i) => v + (stdSeries[i] ?? 0) * 2)
  const l2 = vwap.map((v, i) => v - (stdSeries[i] ?? 0) * 2)
  const u1Pts = pts(u1.slice(0, n)), l1Pts = pts(l1.slice(0, n))
  const u2Pts = pts(u2.slice(0, n)), l2Pts = pts(l2.slice(0, n))

  const polyFill = (top: number[], bot: number[]) =>
    pts(top) + ' ' + bot.slice(0, n).map((v, i) => `${xOf(n - 1 - i)},${yOf(v)}`).reverse().join(' ')

  // Y ticks
  const yTicks = Array.from({ length: 7 }, (_, i) => {
    const val = pMin + (pRange / 6) * i
    return { val, y: yOf(val) }
  })

  // X ticks
  const xStep = Math.max(1, Math.floor(n / 8))
  const xTicks = visible
    .map((b, i) => ({ i, t: fmtTime(b.datetime) }))
    .filter(({ i }) => i % xStep === 0 || i === n - 1)

  const clipId = 'irc'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
      <defs>
        <clipPath id={clipId}><rect x={CP.l} y={CP.t} width={IW} height={IH} /></clipPath>
      </defs>

      {/* Grid */}
      {yTicks.map(({ y, val }, i) => (
        <g key={i}>
          <line x1={CP.l} y1={y} x2={CP.l + IW} y2={y} stroke="#1f2937" strokeWidth={0.5} />
          <text x={CP.l - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="#4b5563">{fp(val)}</text>
        </g>
      ))}

      {/* OR period shading */}
      {n > 0 && orMinutes > 0 && (
        <rect x={CP.l} y={CP.t}
          width={Math.min(xOf(orMinutes - 1) - CP.l + cw / 2, IW)}
          height={IH} fill="#8b5cf6" fillOpacity={0.05} clipPath={`url(#${clipId})`} />
      )}

      {/* σ band fills */}
      {n > 1 && (
        <>
          <polygon points={polyFill(u2.slice(0, n), l2.slice(0, n))} fill="#3b82f6" fillOpacity={0.04} clipPath={`url(#${clipId})`} />
          <polygon points={polyFill(u1.slice(0, n), l1.slice(0, n))} fill="#3b82f6" fillOpacity={0.07} clipPath={`url(#${clipId})`} />
        </>
      )}

      {/* σ band lines */}
      {n > 1 && (
        <>
          <polyline points={u2Pts} fill="none" stroke="#3b82f6" strokeWidth={0.8} strokeOpacity={0.3} strokeDasharray="3 5" clipPath={`url(#${clipId})`} />
          <polyline points={l2Pts} fill="none" stroke="#3b82f6" strokeWidth={0.8} strokeOpacity={0.3} strokeDasharray="3 5" clipPath={`url(#${clipId})`} />
          <polyline points={u1Pts} fill="none" stroke="#3b82f6" strokeWidth={1}   strokeOpacity={0.5} strokeDasharray="2 4" clipPath={`url(#${clipId})`} />
          <polyline points={l1Pts} fill="none" stroke="#3b82f6" strokeWidth={1}   strokeOpacity={0.5} strokeDasharray="2 4" clipPath={`url(#${clipId})`} />
        </>
      )}

      {/* VWAP */}
      {n > 1 && <polyline points={vwapPts} fill="none" stroke="#fbbf24" strokeWidth={1.5} clipPath={`url(#${clipId})`} />}

      {/* ORH / ORL */}
      {n >= orMinutes && orH > 0 && (
        <>
          <line x1={CP.l} y1={yOf(orH)} x2={CP.l + IW} y2={yOf(orH)} stroke="#34d399" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.7} clipPath={`url(#${clipId})`} />
          <text x={CP.l + IW + 3} y={yOf(orH) + 3.5} fontSize={8} fill="#34d399">ORH {fp(orH)}</text>
        </>
      )}
      {n >= orMinutes && orL > 0 && (
        <>
          <line x1={CP.l} y1={yOf(orL)} x2={CP.l + IW} y2={yOf(orL)} stroke="#f87171" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.7} clipPath={`url(#${clipId})`} />
          <text x={CP.l + IW + 3} y={yOf(orL) + 3.5} fontSize={8} fill="#f87171">ORL {fp(orL)}</text>
        </>
      )}

      {/* Candles */}
      {visible.map((b, i) => {
        const up   = b.close >= b.open
        const c    = up ? '#10b981' : '#ef4444'
        const cx   = xOf(i)
        const top  = Math.min(yOf(b.open), yOf(b.close))
        const bh   = Math.max(Math.abs(yOf(b.open) - yOf(b.close)), 1)
        return (
          <g key={i} clipPath={`url(#${clipId})`}>
            <line x1={cx} y1={yOf(b.high)} x2={cx} y2={yOf(b.low)} stroke={c} strokeWidth={0.8} />
            <rect x={cx - cw / 2} y={top} width={cw} height={bh} fill={c} />
          </g>
        )
      })}

      {/* Trade markers */}
      {logs.filter(t => t.barIndex < n).map((t, i) => {
        const cx = xOf(t.barIndex)
        const isLong = t.direction === 'long'
        return (
          <g key={t.id}>
            <line x1={cx} y1={CP.t} x2={cx} y2={CP.t + IH} stroke="#a78bfa" strokeWidth={0.7} strokeDasharray="2 4" strokeOpacity={0.6} clipPath={`url(#${clipId})`} />
            <circle cx={cx} cy={yOf(t.entry)} r={4.5} fill="#a78bfa" clipPath={`url(#${clipId})`} />
            <text x={cx + 5} y={yOf(t.entry) - 4} fontSize={7.5} fill="#a78bfa" clipPath={`url(#${clipId})`}>{isLong ? '▲' : '▼'} E{i + 1}</text>
            <line x1={cx} y1={yOf(t.stop)} x2={CP.l + IW} y2={yOf(t.stop)} stroke="#f87171" strokeWidth={0.7} strokeDasharray="2 5" strokeOpacity={0.5} clipPath={`url(#${clipId})`} />
            <line x1={cx} y1={yOf(t.t1)}   x2={CP.l + IW} y2={yOf(t.t1)}   stroke="#34d399" strokeWidth={0.7} strokeDasharray="2 5" strokeOpacity={0.5} clipPath={`url(#${clipId})`} />
            {t.t2 > 0 && (
              <line x1={cx} y1={yOf(t.t2)} x2={CP.l + IW} y2={yOf(t.t2)} stroke="#34d399" strokeWidth={0.7} strokeDasharray="1 6" strokeOpacity={0.3} clipPath={`url(#${clipId})`} />
            )}
          </g>
        )
      })}

      {/* VWAP label */}
      {vwapNow > 0 && (
        <text x={CP.l + IW + 3} y={yOf(vwapNow) + 3.5} fontSize={8} fill="#fbbf24">VWAP</text>
      )}
      {sigNow > 0 && n > 0 && (
        <>
          <text x={CP.l + IW + 3} y={yOf(vwapNow + sigNow) + 3.5} fontSize={7} fill="#60a5fa" fillOpacity={0.7}>+1σ</text>
          <text x={CP.l + IW + 3} y={yOf(vwapNow - sigNow) + 3.5} fontSize={7} fill="#60a5fa" fillOpacity={0.7}>−1σ</text>
          <text x={CP.l + IW + 3} y={yOf(vwapNow + sigNow * 2) + 3.5} fontSize={7} fill="#60a5fa" fillOpacity={0.5}>+2σ</text>
          <text x={CP.l + IW + 3} y={yOf(vwapNow - sigNow * 2) + 3.5} fontSize={7} fill="#60a5fa" fillOpacity={0.5}>−2σ</text>
        </>
      )}

      {/* X ticks */}
      {xTicks.map(({ i, t }) => (
        <g key={i}>
          <line x1={xOf(i)} y1={CP.t + IH} x2={xOf(i)} y2={CP.t + IH + 4} stroke="#374151" strokeWidth={0.8} />
          <text x={xOf(i)} y={H - CP.b + 15} textAnchor="middle" fontSize={8} fill="#4b5563">{t}</text>
        </g>
      ))}

      {/* Axes */}
      <line x1={CP.l} y1={CP.t} x2={CP.l} y2={CP.t + IH} stroke="#374151" strokeWidth={1} />
      <line x1={CP.l} y1={CP.t + IH} x2={CP.l + IW} y2={CP.t + IH} stroke="#374151" strokeWidth={1} />
    </svg>
  )
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({ results, ticker, date }: { results: TradeResult[]; ticker: string; date: string }) {
  if (results.length === 0) return null
  const wins    = results.filter(r => r.t1Hit || r.t2Hit)
  const losses  = results.filter(r => r.stopped)
  const totalPnl = results.reduce((s, r) => s + r.pnl, 0)
  const winRate  = results.length > 0 ? (wins.length / results.length * 100) : 0

  return (
    <div className="mt-5 bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-300">Session Results — {ticker} {date}</div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${winRate >= 50 ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800' : 'bg-red-900/30 text-red-400 border border-red-900'}`}>
          {winRate.toFixed(0)}% win rate
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Trades', value: String(results.length), icon: <Activity size={11} /> },
          { label: 'Wins', value: String(wins.length), color: 'text-emerald-400', icon: <CheckCircle2 size={11} /> },
          { label: 'Losses', value: String(losses.length), color: 'text-red-400', icon: <XCircle size={11} /> },
          { label: 'Net P&L (pts)', value: (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2), color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400', icon: <BarChart3 size={11} /> },
        ].map(({ label, value, color = 'text-white', icon }) => (
          <div key={label} className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
            <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">{icon}{label}</div>
            <div className={`text-lg font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Trade table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-[10px] uppercase tracking-wide">
              <th className="py-1.5 pr-3 text-left font-medium">#</th>
              <th className="py-1.5 pr-3 text-left font-medium">Time</th>
              <th className="py-1.5 pr-3 text-left font-medium">Setup</th>
              <th className="py-1.5 pr-3 text-right font-mono font-medium">Entry</th>
              <th className="py-1.5 pr-3 text-right font-mono font-medium">Stop</th>
              <th className="py-1.5 pr-3 text-right font-mono font-medium">T1</th>
              <th className="py-1.5 pr-3 text-right font-mono font-medium">T2</th>
              <th className="py-1.5 pr-3 text-right font-mono font-medium">Exit</th>
              <th className="py-1.5 pr-3 text-left font-medium">Outcome</th>
              <th className="py-1.5 text-right font-mono font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const win = r.t1Hit || r.t2Hit
              return (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="py-1.5 pr-3 text-gray-500">{i + 1}</td>
                  <td className="py-1.5 pr-3 text-gray-400 font-mono">{r.time}</td>
                  <td className="py-1.5 pr-3 text-gray-300">{r.setupType}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-gray-200">${fp(r.entry)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-red-400">${fp(r.stop)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-emerald-400">${fp(r.t1)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-emerald-400/60">{r.t2 > 0 ? `$${fp(r.t2)}` : '—'}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-gray-300">${fp(r.exitPrice)} {r.exitTime ? `@ ${r.exitTime}` : ''}</td>
                  <td className="py-1.5 pr-3">
                    {r.t2Hit  && <span className="text-emerald-300 font-semibold">T2 Hit</span>}
                    {r.t1Hit && !r.t2Hit && <span className="text-emerald-400">T1 Hit</span>}
                    {r.stopped && <span className="text-red-400">Stopped</span>}
                    {!r.t1Hit && !r.stopped && <span className="text-gray-500">Open</span>}
                  </td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${win ? 'text-emerald-400' : r.stopped ? 'text-red-400' : 'text-gray-400'}`}>
                    {r.pnl >= 0 ? '+' : ''}{fp(r.pnl)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Session History ──────────────────────────────────────────────────────────

function HistoryPanel({ history }: { history: SessionRecord[] }) {
  if (history.length === 0) return null
  const allTrades = history.flatMap(s => s.results)
  const wins = allTrades.filter(r => r.t1Hit || r.t2Hit).length
  const totalPnl = allTrades.reduce((s, r) => s + r.pnl, 0)
  const winRate = allTrades.length > 0 ? wins / allTrades.length * 100 : 0

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="text-sm font-semibold text-gray-300 mb-3">
        All-Time Stats
        <span className="ml-2 text-xs text-gray-600 font-normal">{history.length} sessions · {allTrades.length} trades</span>
      </div>
      <div className="flex gap-4 flex-wrap text-xs">
        <div><span className="text-gray-500">Win Rate: </span><span className={`font-bold ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{winRate.toFixed(1)}%</span></div>
        <div><span className="text-gray-500">Wins: </span><span className="text-emerald-400 font-semibold">{wins}</span></div>
        <div><span className="text-gray-500">Losses: </span><span className="text-red-400 font-semibold">{allTrades.length - wins}</span></div>
        <div><span className="text-gray-500">Net P&L: </span><span className={`font-semibold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{totalPnl >= 0 ? '+' : ''}{fp(totalPnl)} pts</span></div>
      </div>
      <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-1">
        {[...history].reverse().map((s, i) => {
          const w = s.results.filter(r => r.t1Hit || r.t2Hit).length
          const pnl = s.results.reduce((sum, r) => sum + r.pnl, 0)
          return (
            <div key={i} className="flex items-center justify-between py-1 border-b border-gray-800/40 last:border-0 text-xs">
              <span className="text-gray-500 font-mono">{s.date}</span>
              <span className="text-gray-400 font-semibold">{s.ticker}</span>
              <span className="text-gray-500">{s.results.length}T · {w}W/{s.results.length - w}L</span>
              <span className={`font-mono font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{fp(pnl)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntradayReplay() {
  // ── Inputs ─────────────────────────────────────────────────────────────────
  const [ticker,    setTicker]    = useState('QQQ')
  const [date,      setDate]      = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [orMinutes, setOrMinutes] = useState(15)
  const [apiKey,    setApiKey]    = useState(() => localStorage.getItem(LS_KEY_API) ?? '')
  const [showKey,   setShowKey]   = useState(!localStorage.getItem(LS_KEY_API))

  // ── Data ───────────────────────────────────────────────────────────────────
  const [bars,    setBars]    = useState<Bar[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // ── Playback ───────────────────────────────────────────────────────────────
  const [playhead,   setPlayhead]   = useState(0)
  const [isPlaying,  setIsPlaying]  = useState(false)
  const [speedIdx,   setSpeedIdx]   = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Trade log ──────────────────────────────────────────────────────────────
  const [logs,       setLogs]       = useState<TradeLogEntry[]>([])
  const [nextId,     setNextId]     = useState(1)
  const [showForm,   setShowForm]   = useState(false)
  const [form, setForm] = useState({
    setupType: 'OR Breakout',
    direction: 'long' as 'long' | 'short',
    entry: '', stop: '', t1: '', t2: '',
  })

  // ── Results ────────────────────────────────────────────────────────────────
  const [results,   setResults]   = useState<TradeResult[] | null>(null)
  const [history,   setHistory]   = useState<SessionRecord[]>(loadHistory)
  const sessionDone = bars.length > 0 && playhead >= bars.length - 1

  // ── Pre-computed VWAP / OR ─────────────────────────────────────────────────
  const { vwapSeries, stdSeries } = useMemo(() => {
    const { vwap, std } = calcSeries(bars)
    return { vwapSeries: vwap, stdSeries: std }
  }, [bars])

  const { orH, orL } = useMemo(() => {
    const orBars = bars.slice(0, orMinutes)
    if (orBars.length === 0) return { orH: 0, orL: 0 }
    return {
      orH: Math.max(...orBars.map(b => b.high)),
      orL: Math.min(...orBars.map(b => b.low)),
    }
  }, [bars, orMinutes])

  // ── Current bar values (for form defaults) ────────────────────────────────
  const currentBar = bars[playhead]
  const currentVwap = vwapSeries[playhead] ?? 0
  const currentStd  = stdSeries[playhead] ?? 0

  // ── Playback engine ────────────────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (isPlaying && bars.length > 0) {
      intervalRef.current = setInterval(() => {
        setPlayhead(p => {
          if (p >= bars.length - 1) { setIsPlaying(false); return p }
          return p + 1
        })
      }, SPEED_OPTS[speedIdx]!.ms)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isPlaying, bars.length, speedIdx])

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const loadSession = useCallback(async () => {
    if (!ticker || !date || !apiKey) {
      setError('Enter ticker, date, and Twelve Data API key.')
      return
    }
    localStorage.setItem(LS_KEY_API, apiKey)
    setLoading(true); setError(null); setBars([]); setPlayhead(0)
    setIsPlaying(false); setLogs([]); setResults(null)

    const sym = ticker.trim().toUpperCase()
    const startDT = `${date} 09:30:00`
    const endDT   = `${date} 16:00:00`
    const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1min&start_date=${encodeURIComponent(startDT)}&end_date=${encodeURIComponent(endDT)}&outputsize=500&timezone=America%2FNew_York&apikey=${apiKey}`

    try {
      const res  = await fetch(url)
      const json = await res.json()
      if (json.status === 'error') {
        setError(json.message ?? 'Twelve Data error')
        return
      }
      const raw: Bar[] = (json.values ?? []).map((v: Record<string, string>) => ({
        datetime: v.datetime ?? '',
        open:   parseFloat(v.open),
        high:   parseFloat(v.high),
        low:    parseFloat(v.low),
        close:  parseFloat(v.close),
        volume: parseInt(v.volume) || 1,
      })).reverse()  // API returns newest first

      if (raw.length === 0) {
        setError('No intraday data for this date. Try a trading day (Mon–Fri, not a holiday).')
        return
      }
      setBars(raw)
    } catch (e: any) {
      setError(e?.message ?? 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [ticker, date, apiKey])

  // ── Form helpers ───────────────────────────────────────────────────────────
  function openForm() {
    if (!currentBar) return
    const sigma = currentStd
    const isLong = form.direction === 'long'
    setForm(f => ({
      ...f,
      entry: fp(currentBar.close),
      stop:  isLong ? fp(currentBar.close - sigma * 0.3) : fp(currentBar.close + sigma * 0.3),
      t1:    isLong ? fp(currentBar.close + sigma)        : fp(currentBar.close - sigma),
      t2:    isLong ? fp(currentBar.close + sigma * 2)    : fp(currentBar.close - sigma * 2),
    }))
    setShowForm(true)
    if (isPlaying) setIsPlaying(false)
  }

  function logTrade() {
    const e = parseFloat(form.entry), s = parseFloat(form.stop)
    const t1 = parseFloat(form.t1), t2 = parseFloat(form.t2)
    if (!e || !s || !t1) return
    const entry: TradeLogEntry = {
      id: nextId, barIndex: playhead, time: currentBar ? fmtTime(currentBar.datetime) : '',
      setupType: form.setupType, direction: form.direction,
      entry: e, stop: s, t1, t2: t2 || 0,
    }
    setLogs(prev => [...prev, entry])
    setNextId(n => n + 1)
    setShowForm(false)
  }

  function evaluate() {
    const res = evaluateTrades(logs, bars)
    setResults(res)
    const record: SessionRecord = { date, ticker: ticker.trim().toUpperCase(), results: res }
    const newHistory = [...history, record]
    setHistory(newHistory)
    saveHistory(newHistory)
  }

  function reset() {
    setPlayhead(0); setIsPlaying(false); setLogs([]); setResults(null); setShowForm(false)
  }

  const pct = bars.length > 0 ? Math.round((playhead / (bars.length - 1)) * 100) : 0

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">

          {/* Ticker */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Ticker</label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="QQQ"
              className="w-24 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono uppercase focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Session Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* OR period */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">OR Period</label>
            <div className="flex gap-1">
              {OR_OPTS.map(m => (
                <button key={m} onClick={() => setOrMinutes(m)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    orMinutes === m
                      ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >{m}m</button>
              ))}
            </div>
          </div>

          {/* API Key toggle */}
          <button onClick={() => setShowKey(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-xs hover:border-gray-600 transition-colors"
          >
            <Key size={12} /> API Key
          </button>

          {/* Load button */}
          <button
            onClick={loadSession}
            disabled={loading}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 transition-colors"
          >
            {loading ? <><RotateCcw size={14} className="animate-spin" /> Loading…</> : 'Load Session'}
          </button>
        </div>

        {/* API Key input */}
        {showKey && (
          <div className="flex gap-2 items-center">
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Twelve Data API key (free at twelvedata.com)"
              className="flex-1 max-w-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-mono focus:outline-none focus:border-violet-500"
            />
            <span className="text-[10px] text-gray-600">Stored locally in your browser</span>
          </div>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <span className="text-red-400 text-xs">{error}</span>
        </div>
      )}

      {/* ── Main replay area ──────────────────────────────────────────────── */}
      {bars.length > 0 && (
        <div className="flex gap-4 items-start">

          {/* Left: chart + controls */}
          <div className="flex-1 min-w-0 space-y-3">

            {/* Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 overflow-hidden">
              {/* Bar info strip */}
              {currentBar && (
                <div className="flex gap-4 items-center text-xs font-mono text-gray-400 mb-2 px-1 flex-wrap">
                  <span className="text-white font-bold">{ticker}</span>
                  <span className="text-gray-500">{fmtTime(currentBar.datetime)}</span>
                  <span>O <span className="text-gray-200">${fp(currentBar.open)}</span></span>
                  <span>H <span className="text-emerald-400">${fp(currentBar.high)}</span></span>
                  <span>L <span className="text-red-400">${fp(currentBar.low)}</span></span>
                  <span>C <span className="text-white font-semibold">${fp(currentBar.close)}</span></span>
                  {currentVwap > 0 && <span className="text-amber-400">VWAP ${fp(currentVwap)}</span>}
                  {currentStd > 0 && <span className="text-blue-400">σ ${fp(currentStd)}</span>}
                </div>
              )}

              <ReplayChart
                bars={bars} playhead={playhead}
                vwapSeries={vwapSeries} stdSeries={stdSeries}
                orH={orH} orL={orL} orMinutes={orMinutes}
                logs={logs}
              />

              {/* Progress bar */}
              <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* Playback controls */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
              {/* Bar counter */}
              <span className="text-xs font-mono text-gray-500 shrink-0">
                {playhead + 1} / {bars.length}
                {currentBar && <span className="ml-1 text-gray-600">{fmtTime(currentBar.datetime)}</span>}
              </span>

              {/* Play / Pause */}
              <button
                onClick={() => setIsPlaying(v => !v)}
                disabled={sessionDone}
                className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white flex items-center justify-center transition-colors shrink-0"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>

              {/* Step +1 */}
              <button
                onClick={() => setPlayhead(p => Math.min(p + 1, bars.length - 1))}
                disabled={sessionDone}
                className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-40 text-gray-300 flex items-center justify-center transition-colors shrink-0"
                title="Step +1 candle"
              >
                <ChevronRight size={16} />
              </button>

              {/* Step +5 min */}
              <button
                onClick={() => setPlayhead(p => Math.min(p + 5, bars.length - 1))}
                disabled={sessionDone}
                className="px-2.5 h-8 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-40 text-gray-300 text-xs font-semibold transition-colors shrink-0"
                title="Step +5 minutes"
              >
                +5m
              </button>

              {/* Step +15 min */}
              <button
                onClick={() => setPlayhead(p => Math.min(p + 15, bars.length - 1))}
                disabled={sessionDone}
                className="px-2.5 h-8 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-40 text-gray-300 text-xs font-semibold transition-colors shrink-0"
              >
                +15m
              </button>

              {/* Speed */}
              <div className="flex gap-1 ml-1">
                {SPEED_OPTS.map((s, i) => (
                  <button key={i} onClick={() => setSpeedIdx(i)}
                    className={`px-2 h-7 rounded-md text-[10px] font-semibold border transition-colors ${
                      speedIdx === i
                        ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                    }`}
                  >{s.label}</button>
                ))}
              </div>

              {/* Skip to end */}
              <button
                onClick={() => { setIsPlaying(false); setPlayhead(bars.length - 1) }}
                className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-500 flex items-center justify-center transition-colors ml-auto shrink-0"
                title="Skip to end"
              >
                <ChevronLast size={16} />
              </button>

              {/* Reset */}
              <button onClick={reset}
                className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-500 flex items-center justify-center transition-colors shrink-0"
                title="Reset session"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-[10px] text-gray-600 px-1 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-4 h-px bg-amber-400 inline-block" /> VWAP</span>
              <span className="flex items-center gap-1"><span className="w-4 h-px bg-blue-500/50 inline-block border-dashed border-t" style={{ borderStyle: 'dashed' }} /> 1σ / 2σ bands</span>
              <span className="flex items-center gap-1"><span className="w-4 h-px bg-emerald-400 inline-block" style={{ borderStyle: 'dashed' }} /> ORH</span>
              <span className="flex items-center gap-1"><span className="w-4 h-px bg-red-400 inline-block" style={{ borderStyle: 'dashed' }} /> ORL</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> Entry</span>
            </div>
          </div>

          {/* Right: trade log panel */}
          <div className="w-64 shrink-0 space-y-3">

            {/* Log trade button */}
            {!showForm && (
              <button
                onClick={openForm}
                disabled={!currentBar}
                className="w-full py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-700 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-300 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus size={15} /> Log Trade
              </button>
            )}

            {/* Trade form */}
            {showForm && (
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-300">Log Trade @ {currentBar ? fmtTime(currentBar.datetime) : '—'}</div>

                {/* Setup type */}
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase">Setup</label>
                  <select
                    value={form.setupType}
                    onChange={e => setForm(f => ({ ...f, setupType: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 focus:outline-none focus:border-violet-500"
                  >
                    {SETUP_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>

                {/* Direction */}
                <div className="flex gap-2">
                  {(['long', 'short'] as const).map(d => (
                    <button key={d} onClick={() => setForm(f => ({ ...f, direction: d }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        form.direction === d
                          ? d === 'long'
                            ? 'bg-emerald-600/20 border-emerald-600 text-emerald-300'
                            : 'bg-red-600/20 border-red-700 text-red-300'
                          : 'bg-gray-800 border-gray-700 text-gray-500'
                      }`}
                    >{d === 'long' ? '▲ Long' : '▼ Short'}</button>
                  ))}
                </div>

                {/* Price fields */}
                {(['entry', 'stop', 't1', 't2'] as const).map(field => (
                  <div key={field} className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-500 w-8 uppercase">{field === 't1' ? 'T1' : field === 't2' ? 'T2' : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form[field]}
                      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                      className="flex-1 px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs font-mono text-gray-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                ))}

                <div className="flex gap-2 pt-1">
                  <button onClick={logTrade}
                    className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                  >Save</button>
                  <button onClick={() => setShowForm(false)}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-xs transition-colors"
                  >Cancel</button>
                </div>
              </div>
            )}

            {/* Trade log list */}
            {logs.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-400">Trade Log ({logs.length})</div>
                {logs.map((t, i) => (
                  <div key={t.id} className="flex items-start justify-between text-xs py-1.5 border-b border-gray-800/60 last:border-0">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-violet-400 font-semibold">E{i + 1}</span>
                        <span className="text-gray-500 font-mono">{t.time}</span>
                        <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                          {t.direction === 'long' ? '▲' : '▼'}
                        </span>
                      </div>
                      <div className="text-gray-500">{t.setupType}</div>
                      <div className="font-mono text-gray-400 text-[10px]">
                        In ${fp(t.entry)} · Stop ${fp(t.stop)} · T1 ${fp(t.t1)}{t.t2 > 0 ? ` · T2 $${fp(t.t2)}` : ''}
                      </div>
                    </div>
                    <button onClick={() => setLogs(prev => prev.filter(l => l.id !== t.id))}
                      className="text-gray-700 hover:text-red-500 transition-colors ml-1 shrink-0 mt-0.5"
                    ><Trash2 size={11} /></button>
                  </div>
                ))}

                {/* Evaluate button */}
                <button
                  onClick={evaluate}
                  className="w-full py-2 mt-1 rounded-xl bg-amber-600/20 border border-amber-700 hover:bg-amber-600/30 text-amber-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <TrendingUp size={13} /> Evaluate Trades
                </button>
              </div>
            )}

            {/* Empty state */}
            {logs.length === 0 && !showForm && (
              <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl p-4 text-center">
                <Activity size={20} className="text-gray-700 mx-auto mb-2" />
                <div className="text-[11px] text-gray-600 leading-relaxed">
                  Pause the replay when you spot a setup, then click <strong className="text-gray-500">Log Trade</strong> to record your call.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {bars.length === 0 && !loading && !error && (
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl p-10 text-center max-w-lg mx-auto">
          <BarChart3 size={36} className="text-violet-700 mx-auto mb-3" />
          <div className="text-gray-400 font-semibold mb-1">Intraday Replay</div>
          <div className="text-gray-600 text-sm leading-relaxed">
            Enter a ticker, pick a trading day, add your Twelve Data API key, and hit <strong className="text-gray-400">Load Session</strong>.
            <br /><br />
            Free API key at <span className="text-violet-400">twelvedata.com</span> — 800 calls/day included.
          </div>
          <div className="mt-4 flex items-start gap-2 text-xs text-gray-700 bg-gray-800/30 rounded-xl px-3 py-2 text-left">
            <Info size={11} className="mt-0.5 shrink-0 text-gray-600" />
            <span>VWAP, OR high/low, 1σ and 2σ bands are auto-calculated from the 1-minute bars. Only bars up to the current playback position are shown — no peeking ahead.</span>
          </div>
        </div>
      )}

      {/* ── Session results ───────────────────────────────────────────────── */}
      {results && <ResultsPanel results={results} ticker={ticker} date={date} />}

      {/* ── Session history ───────────────────────────────────────────────── */}
      {history.length > 0 && <HistoryPanel history={history} />}

    </div>
  )
}
