import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, generatedApiPath } from '../api/client'
import type { ApiOperationId } from '../api/generated/openapi-types'
import { useApp } from '../contexts/AppContext'

const DAY_TRADE_BACKTEST_OPERATION_IDS = {
  historyBars: 'get_history_bars_api_history_bars_get',
} as const satisfies Record<string, ApiOperationId>

interface Bar {
  t: string; o: number; h: number; l: number; c: number; v: number
  vwap?: number; vwapUpper1?: number; vwapLower1?: number
  vwapUpper2?: number; vwapLower2?: number
}

interface TradeLog {
  time: string; barIndex: number
  setupType: string; entry: number; stop: number; t1: number; t2: number
  outcome?: 'T1_HIT' | 'T2_HIT' | 'STOPPED' | 'OPEN'
  pnl?: number
}

function calcVwap(bars: Bar[]): void {
  let cumPV = 0, cumV = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!, tp = (b.h + b.l + b.c) / 3
    cumPV += tp * b.v; cumV += b.v
    b.vwap = cumPV / cumV
  }
  // Sigma bands from 20-bar rolling std dev of vwap residuals
  for (let i = 0; i < bars.length; i++) {
    if (i < 20) continue
    const closes = bars.slice(i - 20, i).map(x => x.c)
    const mean = closes.reduce((a, c) => a + c, 0) / closes.length
    const sq = closes.reduce((a, c) => a + (c - mean) ** 2, 0)
    const sigma = Math.sqrt(sq / closes.length)
    const v = bars[i]!.vwap!
    bars[i]!.vwapUpper1 = v + sigma
    bars[i]!.vwapLower1 = v - sigma
    bars[i]!.vwapUpper2 = v + sigma * 2
    bars[i]!.vwapLower2 = v - sigma * 2
  }
}

export default function DayTradeBacktestPage() {
  const { theme } = useApp()
  const isDark = theme !== 'light'
  const [ticker, setTicker] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [allBars, setAllBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [logs, setLogs] = useState<TradeLog[]>([])
  const [showSummary, setShowSummary] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const fetchBars = useCallback(async () => {
    if (!ticker.trim() || !date) return
    setLoading(true); setError('')
    try {
      const { data } = await api.get(generatedApiPath(DAY_TRADE_BACKTEST_OPERATION_IDS.historyBars), { params: { ticker: ticker.trim(), date } })
      const raw: Bar[] = (data as { bars: Bar[] }).bars
      if (!raw?.length) { setError('No data for this date'); setLoading(false); return }
      calcVwap(raw)
      setAllBars(raw)
      setPlayhead(0)
      setLogs([])
      setShowSummary(false)
    } catch (e) {
      setError(String(e))
    } finally { setLoading(false) }
  }, [ticker, date])

  const visibleBars = useMemo(() => allBars.slice(0, playhead + 1), [allBars, playhead])

  // Auto-calculate ORH/ORL (first 15 minutes)
  const orBars = useMemo(() => {
    if (allBars.length < 15) return null
    const slice = allBars.slice(0, 15)
    const orh = Math.max(...slice.map(b => b.h))
    const orl = Math.min(...slice.map(b => b.l))
    const orMid = (orh + orl) / 2
    return { orh, orl, orMid, endIndex: 14 }
  }, [allBars])

  const latest = visibleBars[visibleBars.length - 1]

  // Playback timer
  useEffect(() => {
    if (!isPlaying || playhead >= allBars.length - 1) { setIsPlaying(false); return }
    timerRef.current = setInterval(() => {
      setPlayhead(p => {
        const n = Math.min(p + speed, allBars.length - 1)
        if (n >= allBars.length - 1) setIsPlaying(false)
        return n
      })
    }, 200)
    return () => clearInterval(timerRef.current)
  }, [isPlaying, speed, allBars.length])

  const addLog = (entry: number, stop: number, t1: number, t2: number, setupType: string) => {
    if (!latest) return
    setLogs(prev => [...prev, {
      time: latest.t, barIndex: playhead,
      setupType, entry, stop, t1, t2,
      outcome: 'OPEN',
    }])
  }

  // Evaluate logs against subsequent bars when at end
  useEffect(() => {
    if (playhead < allBars.length - 1 || !logs.length) return
    setLogs(prev => prev.map(log => {
      if (log.outcome !== 'OPEN') return log
      const future = allBars.slice(log.barIndex + 1)
      for (const b of future) {
        if (b.h >= log.t2) return { ...log, outcome: 'T2_HIT', pnl: log.t2 - log.entry }
        if (b.h >= log.t1) return { ...log, outcome: 'T1_HIT', pnl: log.t1 - log.entry }
        if (b.l <= log.stop) return { ...log, outcome: 'STOPPED', pnl: log.stop - log.entry }
      }
      return { ...log, outcome: 'OPEN' as const }
    }))
  }, [playhead, allBars, logs.length])

  // Chart dimensions
  const W = 720, H = 420, PAD = { l: 50, r: 20, t: 20, b: 50 }
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b

  const chartLayout = useMemo(() => {
    if (visibleBars.length < 2) return null
    const times = visibleBars.map(b => new Date(b.t).getTime())
    const tMin = times[0]!, tMax = times[times.length - 1]!, tSpan = Math.max(1, tMax - tMin)
    let yMin = Infinity, yMax = -Infinity
    for (const b of visibleBars) {
      yMin = Math.min(yMin, b.l, b.vwap ?? Infinity, b.vwapLower1 ?? Infinity, b.vwapLower2 ?? Infinity)
      yMax = Math.max(yMax, b.h, b.vwap ?? -Infinity, b.vwapUpper1 ?? -Infinity, b.vwapUpper2 ?? -Infinity)
    }
    if (orBars) { yMin = Math.min(yMin, orBars.orl); yMax = Math.max(yMax, orBars.orh) }
    const pad = (yMax - yMin) * 0.05 || 0.5
    yMin -= pad; yMax += pad
    const xAt = (i: number) => PAD.l + (i / Math.max(1, visibleBars.length - 1)) * innerW
    const yAt = (p: number) => PAD.t + ((yMax - p) / (yMax - yMin)) * innerH
    return { tMin, tMax, tSpan, yMin, yMax, xAt, yAt }
  }, [visibleBars, orBars])

  const wins = logs.filter(l => l.outcome === 'T1_HIT' || l.outcome === 'T2_HIT').length
  const losses = logs.filter(l => l.outcome === 'STOPPED').length
  const totalPnl = logs.reduce((s, l) => s + (l.pnl ?? 0), 0)

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto', background: isDark ? '#0A0C10' : '#F3F4F6', minHeight: '100vh', color: isDark ? '#E8EBF0' : '#111827' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Day Trade Backtest</h1>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="Ticker (e.g. ARM)" style={{ padding: '7px 12px', borderRadius: 6, border: `1px solid ${isDark ? '#1E2330' : '#D1D5DB'}`, background: isDark ? '#111318' : '#FFF', color: 'inherit', fontSize: 13, width: 100 }} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 12px', borderRadius: 6, border: `1px solid ${isDark ? '#1E2330' : '#D1D5DB'}`, background: isDark ? '#111318' : '#FFF', color: 'inherit', fontSize: 13 }} />
        <button onClick={fetchBars} disabled={loading} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#4A7CFF', color: '#FFF', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{loading ? 'Loading...' : 'Load'}</button>
        <span style={{ fontSize: 12, color: isDark ? '#5A6478' : '#6B7280' }}>{allBars.length} bars loaded</span>
      </div>

      {error && <div style={{ color: '#F85149', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {allBars.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* Chart */}
          <div style={{ flex: '1 1 720px', minWidth: 0 }}>
            <svg width={W} height={H} style={{ display: 'block', background: isDark ? '#111318' : '#FFF', borderRadius: 8, border: `1px solid ${isDark ? '#1E2330' : '#E5E7EB'}` }}>
              {chartLayout && (() => {
                const { xAt, yAt, yMin, yMax } = chartLayout
                const bw = Math.max(2, innerW / visibleBars.length * 0.6)
                return <>
                  {/* VWAP line */}
                  <polyline fill="none" stroke="#58A6FF" strokeWidth={1.2} strokeOpacity={0.8} points={visibleBars.map((b, i) => `${xAt(i)},${yAt(b.vwap ?? 0)}`).join(' ')} />
                  {/* 1σ bands */}
                  <polyline fill="none" stroke="rgba(56,189,248,0.3)" strokeWidth={0.8} strokeDasharray="3 3" points={visibleBars.filter(b => b.vwapUpper1).map((b, i) => `${xAt(i)},${yAt(b.vwapUpper1!)}`).join(' ')} />
                  <polyline fill="none" stroke="rgba(56,189,248,0.3)" strokeWidth={0.8} strokeDasharray="3 3" points={visibleBars.filter(b => b.vwapLower1).map((b, i) => `${xAt(i)},${yAt(b.vwapLower1!)}`).join(' ')} />
                  {/* 2σ bands */}
                  <polyline fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth={0.8} strokeDasharray="4 4" points={visibleBars.filter(b => b.vwapUpper2).map((b, i) => `${xAt(i)},${yAt(b.vwapUpper2!)}`).join(' ')} />
                  <polyline fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth={0.8} strokeDasharray="4 4" points={visibleBars.filter(b => b.vwapLower2).map((b, i) => `${xAt(i)},${yAt(b.vwapLower2!)}`).join(' ')} />
                  {/* ORH/ORL lines */}
                  {orBars && <>
                    <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(orBars.orh)} y2={yAt(orBars.orh)} stroke="#F85149" strokeWidth={1} strokeDasharray="6 3" />
                    <text x={PAD.l + 4} y={yAt(orBars.orh) - 4} fill="#F85149" fontSize={9} fontWeight={600}>ORH {orBars.orh.toFixed(2)}</text>
                    <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(orBars.orl)} y2={yAt(orBars.orl)} stroke="#3FB950" strokeWidth={1} strokeDasharray="6 3" />
                    <text x={PAD.l + 4} y={yAt(orBars.orl) + 12} fill="#3FB950" fontSize={9} fontWeight={600}>ORL {orBars.orl.toFixed(2)}</text>
                  </>}
                  {/* Candles */}
                  {visibleBars.map((b, i) => {
                    const cx = xAt(i), yo = yAt(b.o), yc = yAt(b.c), yl = yAt(b.l), yh = yAt(b.h)
                    const up = b.c >= b.o, col = up ? '#3FB950' : '#F85149'
                    return <g key={`c-${i}`}>
                      <line x1={cx} x2={cx} y1={yl} y2={yh} stroke={col} strokeWidth={1} opacity={0.6} />
                      <rect x={cx - bw / 2} y={Math.min(yo, yc)} width={bw} height={Math.max(1, Math.abs(yc - yo))} fill={col} fillOpacity={0.85} />
                    </g>
                  })}
                  {/* Playhead line */}
                  <line x1={xAt(visibleBars.length - 1)} x2={xAt(visibleBars.length - 1)} y1={PAD.t} y2={PAD.t + innerH} stroke="#A78BFA" strokeWidth={1.5} strokeOpacity={0.7} />
                  {/* Y-axis labels */}
                  {[0.25, 0.5, 0.75].map(f => {
                    const p = yMin + (yMax - yMin) * (1 - f)
                    return <text key={f} x={PAD.l - 6} y={yAt(p) + 3} fill={isDark ? '#5A6478' : '#6B7280'} fontSize={9} textAnchor="end">{p.toFixed(1)}</text>
                  })}
                  {/* X-axis time labels */}
                  {visibleBars.filter((_, i) => i % Math.max(1, Math.floor(visibleBars.length / 6)) === 0).map((b, i) => (
                    <text key={`xt-${i}`} x={xAt(visibleBars.indexOf(b))} y={H - 16} fill={isDark ? '#5A6478' : '#6B7280'} fontSize={9} textAnchor="middle">
                      {new Date(b.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </text>
                  ))}
                </>
              })()}
            </svg>

            {/* Playback controls */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setIsPlaying(p => !p)} disabled={playhead >= allBars.length - 1} style={btnStyle(isDark)}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
              <button onClick={() => setPlayhead(p => Math.min(p + 1, allBars.length - 1))} disabled={playhead >= allBars.length - 1} style={btnStyle(isDark)}>⏭ +1</button>
              <button onClick={() => setPlayhead(p => Math.min(p + 5, allBars.length - 1))} disabled={playhead >= allBars.length - 1} style={btnStyle(isDark)}>⏭ +5</button>
              <button onClick={() => setPlayhead(0)} style={btnStyle(isDark)}>⏮ Reset</button>
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ padding: '5px 8px', borderRadius: 5, border: `1px solid ${isDark ? '#1E2330' : '#D1D5DB'}`, background: isDark ? '#111318' : '#FFF', color: 'inherit', fontSize: 12 }}>
                <option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option><option value={10}>10×</option>
              </select>
              <span style={{ fontSize: 11, color: isDark ? '#5A6478' : '#6B7280', marginLeft: 8 }}>
                Bar {playhead + 1}/{allBars.length} · {latest ? new Date(latest.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
              </span>
              {latest && (
                <span style={{ fontSize: 11, color: latest.c >= latest.o ? '#3FB950' : '#F85149', fontWeight: 600, marginLeft: 4 }}>
                  ${latest.c.toFixed(2)}
                </span>
              )}
              {/* Progress bar */}
              <div style={{ flex: '1 1 100%', height: 4, background: isDark ? '#1E2330' : '#E5E7EB', borderRadius: 2, marginTop: 2 }}>
                <div style={{ height: '100%', width: `${(playhead + 1) / allBars.length * 100}%`, background: '#4A7CFF', borderRadius: 2, transition: 'width 0.15s' }} />
              </div>
            </div>
          </div>

          {/* Trading log panel */}
          <div style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Current market data */}
            {latest && orBars && (
              <div style={{ background: isDark ? '#111318' : '#FFF', border: `1px solid ${isDark ? '#1E2330' : '#E5E7EB'}`, borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: isDark ? '#8B949E' : '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Market Data</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 11 }}>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>VWAP</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${latest.vwap?.toFixed(2) ?? '—'}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Price</span><span style={{ fontFamily: 'monospace', fontWeight: 600, color: latest.c >= latest.o ? '#3FB950' : '#F85149' }}>${latest.c.toFixed(2)}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>ORH</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${orBars.orh.toFixed(2)}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>ORL</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${orBars.orl.toFixed(2)}</span>
                  {latest.vwapUpper1 != null && <><span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>1σ Upper</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${latest.vwapUpper1.toFixed(2)}</span></>}
                  {latest.vwapLower1 != null && <><span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>1σ Lower</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${latest.vwapLower1.toFixed(2)}</span></>}
                </div>
              </div>
            )}

            {/* Log trade form */}
            {latest && (
              <div style={{ background: isDark ? '#111318' : '#FFF', border: `1px solid ${isDark ? '#1E2330' : '#E5E7EB'}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: isDark ? '#8B949E' : '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Log Entry</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                  <label style={{ fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' }}>Setup type</label>
                  <input id="setupType" defaultValue="VWAP_DEFENSE" placeholder="e.g. OR_BREAKOUT" style={inputStyle(isDark)} />
                  <label style={{ fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' }}>Entry $</label>
                  <input id="logEntry" defaultValue={latest.c.toFixed(2)} style={inputStyle(isDark)} />
                  <label style={{ fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' }}>Stop $</label>
                  <input id="logStop" placeholder="e.g. 508" style={inputStyle(isDark)} />
                  <label style={{ fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' }}>T1 $</label>
                  <input id="logT1" placeholder="e.g. 516" style={inputStyle(isDark)} />
                  <label style={{ fontSize: 10, color: isDark ? '#8B949E' : '#6B7280' }}>T2 $</label>
                  <input id="logT2" placeholder="e.g. 522" style={inputStyle(isDark)} />
                </div>
                <button onClick={() => {
                  const g = (id: string) => parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0')
                  const entry = g('logEntry'), stop = g('logStop'), t1 = g('logT1'), t2 = g('logT2')
                  const setup = (document.getElementById('setupType') as HTMLInputElement)?.value || 'MANUAL'
                  if (!entry || !stop || !t1) return
                  addLog(entry, stop, t1, t2 || t1, setup)
                }} style={{ width: '100%', marginTop: 8, padding: '6px 0', borderRadius: 5, border: 'none', background: '#4A7CFF', color: '#FFF', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Log Entry at This Bar
                </button>
              </div>
            )}

            {/* Log table */}
            {logs.length > 0 && (
              <div style={{ background: isDark ? '#111318' : '#FFF', border: `1px solid ${isDark ? '#1E2330' : '#E5E7EB'}`, borderRadius: 8, padding: '10px 12px', maxHeight: 300, overflowY: 'auto' }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: isDark ? '#8B949E' : '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trades ({logs.length})</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead><tr style={{ color: isDark ? '#5A6478' : '#6B7280' }}>
                    <th style={thStyle}>#</th><th style={thStyle}>Setup</th><th style={thStyle}>Entry</th><th style={thStyle}>Stop</th><th style={thStyle}>T1</th><th style={thStyle}>Result</th><th style={thStyle}>P&L</th>
                  </tr></thead>
                  <tbody>
                    {logs.map((l, i) => (
                      <tr key={i} style={{ color: isDark ? '#E8EBF0' : '#111827' }}>
                        <td style={tdStyle}>{i + 1}</td>
                        <td style={{ ...tdStyle, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.setupType}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>${l.entry.toFixed(2)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>${l.stop.toFixed(2)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>${l.t1.toFixed(2)}</td>
                        <td style={{ ...tdStyle, fontWeight: 600, color: l.outcome === 'T1_HIT' || l.outcome === 'T2_HIT' ? '#3FB950' : l.outcome === 'STOPPED' ? '#F85149' : isDark ? '#D29922' : '#B45309' }}>
                          {l.outcome === 'T1_HIT' ? 'T1 ✓' : l.outcome === 'T2_HIT' ? 'T2 ✓' : l.outcome === 'STOPPED' ? 'STOP ✗' : '—'}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600, color: (l.pnl ?? 0) >= 0 ? '#3FB950' : '#F85149' }}>
                          {l.pnl != null ? `${l.pnl >= 0 ? '+' : ''}$${l.pnl.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary */}
            {playhead >= allBars.length - 1 && logs.length > 0 && (
              <div style={{ background: isDark ? '#111318' : '#FFF', border: `1px solid ${isDark ? '#1E2330' : '#E5E7EB'}`, borderRadius: 8, padding: '12px' }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: isDark ? '#8B949E' : '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Session Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', fontSize: 11 }}>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Total Trades</span><span style={{ fontWeight: 700 }}>{logs.length}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Wins</span><span style={{ fontWeight: 700, color: '#3FB950' }}>{wins}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Losses</span><span style={{ fontWeight: 700, color: '#F85149' }}>{losses}</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Win Rate</span><span style={{ fontWeight: 700 }}>{logs.length ? Math.round(wins / logs.length * 100) : 0}%</span>
                  <span style={{ color: isDark ? '#8B949E' : '#6B7280' }}>Net P&L</span><span style={{ fontWeight: 700, color: totalPnl >= 0 ? '#3FB950' : '#F85149' }}>{totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function btnStyle(isDark: boolean): React.CSSProperties {
  return { padding: '5px 12px', borderRadius: 5, border: `1px solid ${isDark ? '#1E2330' : '#D1D5DB'}`, background: isDark ? '#111318' : '#FFF', color: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
}
function inputStyle(isDark: boolean): React.CSSProperties {
  return { padding: '4px 6px', borderRadius: 4, border: `1px solid ${isDark ? '#1E2330' : '#D1D5DB'}`, background: isDark ? '#181C23' : '#F9FAFB', color: 'inherit', fontSize: 11, fontFamily: 'monospace', width: '100%' }
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '3px 4px', fontWeight: 600, fontSize: 10, borderBottom: '1px solid rgba(128,128,128,0.2)' }
const tdStyle: React.CSSProperties = { padding: '3px 4px', fontSize: 10, borderBottom: '1px solid rgba(128,128,128,0.1)' }
