import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import type { DayTradeChartBar } from '../api/client'
import { getDayTradeAlerts } from '../api/client'
import { fetchAlertCenterPage } from '../api/commandCenter'
import type { DayTradeAlertEvent } from '../types'
import { useApp } from '../contexts/AppContext'

/* ── Constants ─────────────────────────────────────────────────────────── */

const VERDICT_COLOR: Record<string, string> = {
  'STRONG GO': '#34d399',
  'GO':        '#fbbf24',
  'WATCH':     '#38bdf8',
}
function verdictColor(v: string) { return VERDICT_COLOR[v] ?? '#6b7280' }

const PAD = { l: 52, r: 12, t: 16, b: 26 } as const
const PA_H = 180  // panel A inner height
const PB_H = 52   // panel B inner height

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtP(n: number) {
  return Math.abs(n) >= 10 ? n.toFixed(2) : n.toFixed(3)
}

function ptTime(ms: number) {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles',
    })
  } catch { return '' }
}

function barPtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles',
    })
  } catch { return '' }
}

/** Find the bar index closest to a timestamp. */
function closestBar(bars: DayTradeChartBar[], tsMs: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < bars.length; i++) {
    const diff = Math.abs(new Date(bars[i]!.t).getTime() - tsMs)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}

/** Extract price from alert metrics, fall back to bar close. */
function alertPrice(alert: DayTradeAlertEvent, bars: DayTradeChartBar[], idx: number): number {
  const m = alert.metrics
  if (m) {
    const lp = m['last_price']
    if (typeof lp === 'number' && isFinite(lp) && lp > 0) return lp
    const vwap = m['vwap']
    if (typeof vwap === 'number' && isFinite(vwap) && vwap > 0) return vwap
  }
  return bars[idx]?.c ?? 0
}

/* ── DualPanelChart ─────────────────────────────────────────────────────── */

interface AlertPos {
  alert: DayTradeAlertEvent
  idx: number
  price: number
}

function DualPanelChart({
  bars, orHigh, orLow, orMinutes, alertPositions, selectedId, onSelect, cw, isDark,
  showVwap, showOr, showAlerts,
}: {
  bars: DayTradeChartBar[]
  orHigh: number
  orLow: number
  orMinutes: number
  alertPositions: AlertPos[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  cw: number
  isDark: boolean
  showVwap: boolean
  showOr: boolean
  showAlerts: boolean
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; ap: AlertPos } | null>(null)

  const layout = useMemo(() => {
    if (!cw || bars.length < 2) return null
    const n = bars.length
    const innerW = cw - PAD.l - PAD.r
    const slot = innerW / n
    const bodyW = Math.max(1, Math.min(5, slot * 0.68))

    let yMin = Math.min(...bars.map(b => b.l), orLow,  ...bars.map(b => b.vwap))
    let yMax = Math.max(...bars.map(b => b.h), orHigh, ...bars.map(b => b.vwap))
    const pad = (yMax - yMin) * 0.08 || 0.02
    yMin -= pad; yMax += pad

    const xAt  = (i: number) => PAD.l + slot * (i + 0.5)
    const yAt  = (p: number) => PAD.t + ((yMax - p) / (yMax - yMin)) * PA_H

    const yTicks = Array.from({ length: 4 }, (_, k) => yMin + ((yMax - yMin) * k) / 3)
    const xTicks: { i: number; label: string }[] = []
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 5))) {
      xTicks.push({ i, label: barPtTime(bars[i]!.t) })
    }

    return { n, innerW, slot, bodyW, xAt, yAt, yTicks, xTicks }
  }, [cw, bars, orHigh, orLow])

  if (!layout) return null

  const { n, innerW, slot, bodyW, xAt, yAt, yTicks, xTicks } = layout
  const PA_SVG_H = PAD.t + PA_H + PAD.b
  const PB_SVG_H = 4 + PB_H + PAD.b

  const gridColor = isDark ? 'rgba(55,65,81,0.35)' : 'rgba(200,210,220,0.5)'
  const axisColor = isDark ? '#4b5563' : '#9ca3af'
  const borderColor = isDark ? 'rgba(55,65,81,0.35)' : 'rgba(200,210,220,0.7)'

  const vwapPts = bars.map((b, i) => `${xAt(i).toFixed(1)},${yAt(b.vwap).toFixed(1)}`).join(' ')

  return (
    <>
      {/* ─ Panel A: price + alert markers ─ */}
      <svg width={cw} height={PA_SVG_H} style={{ display: 'block' }}>
        <defs>
          <clipPath id="overlay-pa-clip">
            <rect x={PAD.l} y={PAD.t} width={innerW} height={PA_H} />
          </clipPath>
        </defs>

        {/* Y gridlines + labels */}
        {yTicks.map((yt, k) => (
          <g key={`yg${k}`}>
            <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(yt)} y2={yAt(yt)}
              stroke={gridColor} strokeWidth={1} />
            <text x={PAD.l - 5} y={yAt(yt)} dy="0.35em" textAnchor="end"
              fill={axisColor} fontSize={9} fontFamily="ui-monospace,monospace">
              {fmtP(yt)}
            </text>
          </g>
        ))}

        {/* OR shading */}
        {showOr && <rect x={PAD.l} y={PAD.t} width={slot * orMinutes} height={PA_H}
          fill="rgba(251,191,36,0.055)" clipPath="url(#overlay-pa-clip)" />}

        {/* OR high / low */}
        {showOr && <>
          <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(orHigh)} y2={yAt(orHigh)}
            stroke="#fbbf24" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.7}
            clipPath="url(#overlay-pa-clip)" />
          <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(orLow)} y2={yAt(orLow)}
            stroke="#fbbf24" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.7}
            clipPath="url(#overlay-pa-clip)" />
          <text x={PAD.l + innerW - 4} y={yAt(orHigh) - 3} textAnchor="end"
            fill="#fbbf24" fontSize={7.5} fontWeight={600}>OR H</text>
          <text x={PAD.l + innerW - 4} y={yAt(orLow) + 10} textAnchor="end"
            fill="#fbbf24" fontSize={7.5} fontWeight={600}>OR L</text>
        </>}

        {/* Candles */}
        <g clipPath="url(#overlay-pa-clip)">
          {bars.map((b, i) => {
            const cx  = xAt(i)
            const up  = b.c >= b.o
            const col = up ? '#34d399' : '#fb7185'
            const yH  = yAt(b.h), yL = yAt(b.l)
            const yO  = yAt(b.o), yC = yAt(b.c)
            const top = Math.min(yO, yC)
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={col} strokeWidth={1} />
                <rect x={cx - bodyW / 2} y={top} width={bodyW}
                  height={Math.max(1, Math.max(yO, yC) - top)}
                  fill={col} fillOpacity={0.85} />
              </g>
            )
          })}
        </g>

        {/* VWAP */}
        {showVwap && <polyline fill="none" stroke="#f472b6" strokeWidth={1.4}
          strokeLinejoin="round" strokeLinecap="round"
          points={vwapPts} clipPath="url(#overlay-pa-clip)" />}

        {/* Alert markers */}
        {showAlerts && alertPositions.map(ap => {
          const { alert, idx, price } = ap
          const x   = xAt(idx)
          const y   = yAt(price)
          const vc  = verdictColor(alert.verdict)
          const sel = selectedId === alert.id
          const r   = sel ? 8 : 6

          const marker = (() => {
            if (alert.verdict === 'STRONG GO') return (
              <circle cx={x} cy={y} r={r} fill={vc} fillOpacity={0.92} />
            )
            if (alert.verdict === 'GO') return (
              <circle cx={x} cy={y} r={r}
                fill={sel ? `${vc}30` : 'none'} stroke={vc} strokeWidth={2} />
            )
            if (alert.verdict === 'WATCH') return (
              <polygon
                points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
                fill={vc} fillOpacity={0.88} />
            )
            return (
              <>
                <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={vc} strokeWidth={2} />
                <line x1={x + r} y1={y - r} x2={x - r} y2={y + r} stroke={vc} strokeWidth={2} />
              </>
            )
          })()

          return (
            <g
              key={`mkr-${alert.id}`}
              clipPath="url(#overlay-pa-clip)"
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : alert.id) }}
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, ap })}
              onMouseLeave={() => setTooltip(null)}
            >
              {sel && (
                <circle cx={x} cy={y} r={r + 5}
                  fill="none" stroke={vc} strokeWidth={1.2} strokeOpacity={0.4} />
              )}
              {marker}
              <text
                x={x}
                y={alert.bias === 'short' ? y - r - 3 : y + r + 9}
                textAnchor="middle" fill={vc} fontSize={7} fontWeight={700}
              >
                {alert.bias === 'short' ? '▼' : '▲'}
              </text>
            </g>
          )
        })}

        {/* X ticks */}
        {xTicks.map(({ i, label }) => (
          <text key={`xt${i}`} x={xAt(i)} y={PA_SVG_H - 8}
            textAnchor="middle" fill={axisColor} fontSize={9}>
            {label}
          </text>
        ))}

        <rect x={PAD.l} y={PAD.t} width={innerW} height={PA_H}
          fill="none" stroke={borderColor} strokeWidth={1} />
      </svg>

      {/* ─ Panel B: timeline bands ─ */}
      <svg width={cw} height={PB_SVG_H}
        style={{ display: 'block', borderTop: `1px solid ${borderColor}` }}>
        <rect x={PAD.l} y={4} width={innerW} height={PB_H} fill="rgba(0,0,0,0.3)" />

        {showAlerts && alertPositions.map(ap => {
          const { alert, idx } = ap
          const bx  = xAt(idx)
          const vc  = verdictColor(alert.verdict)
          const sel = selectedId === alert.id
          const bw  = Math.max(slot * 0.8, 12)
          return (
            <g key={`band-${alert.id}`} style={{ cursor: 'pointer' }}
              onClick={() => onSelect(sel ? null : alert.id)}>
              <rect x={bx - bw / 2} y={4} width={bw} height={PB_H}
                fill={vc} fillOpacity={sel ? 0.3 : 0.12} />
              <line x1={bx} x2={bx} y1={4} y2={4 + PB_H}
                stroke={vc} strokeWidth={sel ? 2.5 : 1.5} strokeOpacity={0.9} />
              <text x={bx} y={4 + PB_H * 0.42} textAnchor="middle"
                fill={vc} fontSize={8} fontWeight={600}>
                {ptTime(alert.detectedAt)}
              </text>
              <text x={bx} y={4 + PB_H * 0.78} textAnchor="middle"
                fill={vc} fontSize={7.5} fontWeight={500}>
                {alert.verdict === 'STRONG GO' ? 'S.GO' : alert.verdict}
              </text>
            </g>
          )
        })}

        <rect x={PAD.l} y={4} width={innerW} height={PB_H}
          fill="none" stroke={borderColor} strokeWidth={1} />
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 14, top: tooltip.y - 12,
          background: 'rgba(13,13,13,0.97)',
          border: `1px solid ${verdictColor(tooltip.ap.alert.verdict)}50`,
          borderRadius: 8, padding: '8px 12px',
          pointerEvents: 'none', zIndex: 9999, minWidth: 200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}>
          <div className="text-xs font-semibold mb-1"
            style={{ color: verdictColor(tooltip.ap.alert.verdict) }}>
            {tooltip.ap.alert.verdict} · {ptTime(tooltip.ap.alert.detectedAt)}
          </div>
          <div className="text-[11px] text-gray-400 mb-1">
            {tooltip.ap.alert.ticker} {tooltip.ap.alert.companyName ? `· ${tooltip.ap.alert.companyName}` : ''}
          </div>
          <div className="font-mono text-[11px] text-gray-300 mb-1.5">
            Price ${fmtP(tooltip.ap.price)}
            {tooltip.ap.alert.bias && <> · {tooltip.ap.alert.bias.toUpperCase()}</>}
          </div>
          {tooltip.ap.alert.reasons?.slice(0, 2).map((r, i) => (
            <div key={i} className="text-[10px] text-gray-500">{r}</div>
          ))}
        </div>
      )}
    </>
  )
}

/* ── AlertList ──────────────────────────────────────────────────────────── */

function AlertList({
  alerts, selectedId, onSelect, isDark,
}: {
  alerts: DayTradeAlertEvent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  isDark: boolean
}) {
  const muted   = isDark ? '#5A6478' : '#6B7280'
  const border  = isDark ? '#1E2330' : '#E5E7EB'
  const text    = isDark ? '#E8EBF0' : '#111827'
  const bgDeep  = isDark ? '#181C23' : '#F8F9FB'

  if (alerts.length === 0) {
    return (
      <p style={{ fontSize: '0.78rem', color: muted, textAlign: 'center', padding: '8px 0' }}>
        No alerts for this ticker yet.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {alerts.map(alert => {
        const vc  = verdictColor(alert.verdict)
        const sel = selectedId === alert.id
        return (
          <div
            key={alert.id}
            onClick={() => onSelect(sel ? null : alert.id)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
              padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              background: sel ? `${vc}12` : bgDeep,
              border: `1px solid ${sel ? `${vc}45` : border}`,
              borderLeft: `3px solid ${sel ? vc : border}`,
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {/* Verdict badge */}
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 20,
              background: `${vc}20`, color: vc, border: `1px solid ${vc}45`, whiteSpace: 'nowrap',
            }}>
              {alert.verdict}
            </span>

            {/* Time */}
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: muted, marginTop: 2, whiteSpace: 'nowrap' }}>
              {ptTime(alert.detectedAt)}
            </span>

            {/* Bias */}
            {alert.bias && (
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: alert.bias === 'short' ? 'rgba(251,113,133,0.14)' : 'rgba(52,211,153,0.14)',
                color: alert.bias === 'short' ? '#fb7185' : '#34d399',
                whiteSpace: 'nowrap',
              }}>
                {alert.bias.toUpperCase()}
              </span>
            )}

            {/* Scores */}
            <span style={{ fontSize: '0.68rem', color: muted, whiteSpace: 'nowrap' }}>
              B <span style={{ color: '#34d399', fontFamily: 'monospace' }}>{alert.bullScore}</span>
              {' / '}S <span style={{ color: '#fb7185', fontFamily: 'monospace' }}>{alert.bearScore}</span>
            </span>

            {/* Reasons */}
            {alert.reasons?.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: muted, flex: 1, minWidth: 200 }}>
                {alert.reasons.slice(0, 2).join(' · ')}
                {alert.reasons.length > 2 && <span style={{ color: muted, opacity: 0.6 }}> +{alert.reasons.length - 2} more</span>}
              </span>
            )}

            {/* Session date */}
            {alert.sessionDate && (
              <span style={{ fontSize: '0.65rem', color: muted, opacity: 0.7, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {alert.sessionDate}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Main export ────────────────────────────────────────────────────────── */

export default function DayTradeAlertOverlay({
  bars,
  orHigh,
  orLow,
  orMinutes,
  ticker,
  scanAlerts = [],
}: {
  bars: DayTradeChartBar[]
  orHigh: number
  orLow: number
  orMinutes: number
  ticker: string
  /** Synthetic alerts derived from the current scan result (always shown even if ticker is not on watchlist). */
  scanAlerts?: DayTradeAlertEvent[]
}) {
  const { user, theme } = useApp()
  const isDark = theme !== 'light'

  const [allAlerts, setAllAlerts]   = useState<DayTradeAlertEvent[]>([])
  const [loading, setLoading]       = useState(false)
  const [chartOpen, setChartOpen]   = useState(true)
  const [listOpen, setListOpen]     = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showVwap, setShowVwap]     = useState(true)
  const [showOr, setShowOr]         = useState(true)
  const [showAlerts, setShowAlerts] = useState(true)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw]                 = useState(0)

  const load = useCallback(async () => {
    if (!user?.email) return
    setLoading(true)
    try {
      const [legacy, center] = await Promise.all([
        getDayTradeAlerts(user.email),
        fetchAlertCenterPage({ engine_type: 'DAY', active_only: false, today_only: false }).catch(() => null),
      ])
      const merged = [...legacy]
      if (center?.data?.alerts) {
        for (const a of center.data.alerts) {
          const ts = new Date(a.created_at).getTime()
          merged.push({
            id: `ac-${a.id}`,
            ticker: (a.ticker || '').toUpperCase(),
            companyName: undefined,
            previousVerdict: '',
            verdict: a.alert_type === 'ENTER_NOW' ? 'STRONG GO' : a.alert_type === 'STATE_CHANGE' ? 'GO' : 'WATCH',
            sessionDate: undefined,
            bias: null,
            bullScore: 0,
            bearScore: 0,
            reasons: [a.message || a.reason || a.alert_type || ''].filter(Boolean),
            metrics: undefined,
            detectedAt: Number.isFinite(ts) ? ts : Date.now(),
            emailSent: false,
          })
        }
      }
      setAllAlerts(merged)
    } catch { /* non-fatal */ } finally {
      setLoading(false)
    }
  }, [user?.email])

  useEffect(() => { void load() }, [load])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(Math.max(300, el.clientWidth)))
    ro.observe(el)
    setCw(Math.max(300, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  // Merge scan-derived alerts with watchlist alerts, deduplicating by id
  const tickerAlerts = useMemo(() => {
    const t = ticker.toUpperCase()
    const scanForTicker = scanAlerts.filter(a => a.ticker.toUpperCase() === t)
    const watchlistForTicker = allAlerts.filter(a => a.ticker.toUpperCase() === t)
    const scanIds = new Set(scanForTicker.map(a => a.id))
    const merged = [...scanForTicker, ...watchlistForTicker.filter(a => !scanIds.has(a.id))]
    return merged.sort((a, b) => a.detectedAt - b.detectedAt)
  }, [allAlerts, scanAlerts, ticker])

  // Build alert positions (idx + price) relative to bars
  const alertPositions: AlertPos[] = useMemo(() => {
    if (!bars.length) return []
    return tickerAlerts.map(alert => {
      const idx   = closestBar(bars, alert.detectedAt)
      const price = alertPrice(alert, bars, idx)
      return { alert, idx, price }
    })
  }, [tickerAlerts, bars])

  const bg     = isDark ? '#111318' : '#FFFFFF'
  const border = isDark ? '#1E2330' : '#E5E7EB'
  const muted  = isDark ? '#5A6478' : '#6B7280'

  return (
    <div
      ref={wrapRef}
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}
    >
      {/* ─ Chart section header ─ */}
      <button
        type="button"
        onClick={() => setChartOpen(p => !p)}
        className="w-full flex items-center justify-between gap-2 mb-2"
      >
        <div className="flex items-center gap-2">
          <Bell size={13} className="text-orange-400 shrink-0" />
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Alert Overlay Chart · {ticker}
          </span>
          {tickerAlerts.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
              style={{ background: 'rgba(251,146,60,0.2)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)' }}>
              {tickerAlerts.length} alert{tickerAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
          {loading && <Loader2 size={11} className="animate-spin" style={{ color: muted }} />}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void load() }}
            className="rounded-full p-0.5 hover:bg-gray-700/40 transition-colors"
            title="Refresh alerts"
          >
            <RefreshCw size={11} style={{ color: muted }} />
          </button>
        </div>
        <ChevronDown size={13} style={{
          color: muted,
          transform: chartOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }} />
      </button>

      {chartOpen && (
        <>
          {/* Legend + toggles */}
          <div className="flex flex-wrap items-center gap-3 mb-2"
            style={{ fontSize: '0.65rem', color: muted }}>
            <span><span style={{ color: '#34d399' }}>●</span> Strong Go</span>
            <span><span style={{ color: '#fbbf24' }}>○</span> Go</span>
            <span><span style={{ color: '#38bdf8' }}>◆</span> Watch</span>
            <button type="button" onClick={() => setShowVwap(p => !p)}
              className="flex items-center gap-1 hover:text-white transition-colors">
              {showVwap ? <Eye size={11} /> : <EyeOff size={11} />}
              <span style={{ color: '#f472b6' }}>VWAP</span>
            </button>
            <button type="button" onClick={() => setShowOr(p => !p)}
              className="flex items-center gap-1 hover:text-white transition-colors">
              {showOr ? <Eye size={11} /> : <EyeOff size={11} />}
              <span style={{ color: '#fbbf24' }}>OR</span>
            </button>
            <button type="button" onClick={() => setShowAlerts(p => !p)}
              className="flex items-center gap-1 hover:text-white transition-colors">
              {showAlerts ? <Eye size={11} /> : <EyeOff size={11} />}
              <span style={{ color: '#fb923c' }}>Alerts</span>
            </button>
          </div>

          {/* Dual-panel chart */}
          {bars.length >= 2 && cw > 0 ? (
            <DualPanelChart
              bars={bars}
              orHigh={orHigh}
              orLow={orLow}
              orMinutes={orMinutes}
              alertPositions={alertPositions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              cw={cw}
              isDark={isDark}
              showVwap={showVwap}
              showOr={showOr}
              showAlerts={showAlerts}
            />
          ) : (
            <div style={{ color: muted, fontSize: '0.78rem', textAlign: 'center', padding: '12px 0' }}>
              Waiting for chart data…
            </div>
          )}

          {/* ─ Alert list section ─ */}
          <button
            type="button"
            onClick={() => setListOpen(p => !p)}
            className="w-full flex items-center justify-between gap-2 mt-3 pt-2.5"
            style={{ borderTop: `1px solid ${border}` }}
          >
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Day Trade Alerts · {ticker}
              {tickerAlerts.length > 0 && ` (${tickerAlerts.length})`}
            </span>
            <ChevronDown size={12} style={{
              color: muted,
              transform: listOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }} />
          </button>

          {listOpen && (
            <div className="mt-2">
              <AlertList
                alerts={tickerAlerts}
                selectedId={selectedId}
                onSelect={setSelectedId}
                isDark={isDark}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
