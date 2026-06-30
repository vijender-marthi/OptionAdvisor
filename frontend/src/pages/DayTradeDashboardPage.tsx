import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Plus, X, ExternalLink, Clock, GripVertical, TrendingUp, Maximize2, Table2, CandlestickChart, LayoutDashboard, Activity, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { analyzeDayTrade, analyzeSwingTrade, analyzeV2, getDashboardTickers, saveDashboardTickers } from '../api/client'
import { fetchSignalFeed } from '../api/commandCenter'
import type { DayTradeScanResult, SwingTradeScanResult, UnifiedAnalysis } from '../api/client'
import DayTradeIntradayChart, { parseChartBars, resampleBars, orMinutesForInterval, type ChartInterval, type ChartEntryPoint } from '../components/DayTradeIntradayChart'
import ScalpTradingChart from '../components/ScalpTradingChart'
import SwingTradeMetricCharts from '../components/SwingTradeMetricCharts'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'

const SK_DAY_TICKERS   = 'oa_dashboard_tickers_day'
const SK_SWING_TICKERS = 'oa_dashboard_tickers_swing'
const SK_ACTIVE_TAB    = 'oa_dashboard_active_tab'
const AUTO_REFRESH_MS  = 30 * 1000
const MAX_TICKERS      = 8

type Tab = 'day' | 'swing' | 'table' | 'scalp'
/** Tabs share two data pools — the table tab reads the day pool. */

/** Viewport hook for responsive layout switching. */
function useViewport() {
  const [width, setWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return { width, isMobile: width < 640, isTablet: width >= 640 && width < 1024 }
}
type DataTab = 'day' | 'swing'

interface TileData {
  ticker: string
  result: DayTradeScanResult | SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  loading: boolean
  error: string | null
  requestId?: number
}

interface ExpandedChart {
  ticker: string
  tab: Tab
  metrics: Record<string, unknown>
  entryPoints?: ChartEntryPoint[]
  unified: UnifiedAnalysis | null
}

function normalizeTickerList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const sym = String(value ?? '').trim().toUpperCase()
    if (!sym || sym.length > 12 || seen.has(sym)) continue
    seen.add(sym)
    out.push(sym)
    if (out.length >= MAX_TICKERS) break
  }
  return out
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const VERDICT_COLORS: Record<string, string> = {
  STRONG_GO: '#00A86B', GO: '#00A86B', WATCH: '#D97706',
  WAIT: '#6B7280', AVOID: '#DC2626', NO_EDGE: '#6B7280',
  TRACK_ONLY: '#38BDF8', WAIT_ENTRY: '#D97706', DO_NOT_CHASE: '#D97706', NO_TRADE: '#DC2626',
}

function buildEntryPoints(result: DayTradeScanResult, metrics: Record<string, unknown>): ChartEntryPoint[] {
  const eg = result.entry_guidance, ac = result.ai_coach
  const orHigh  = metrics.or_high as number | undefined
  const orLow   = metrics.or_low  as number | undefined
  const mVwap   = typeof metrics.vwap === 'number' && isFinite(metrics.vwap) ? metrics.vwap as number : null
  const isShort = result.bias === 'short'
  const sf      = isShort ? orHigh : orLow
  const direction = isShort ? 'short' : 'long' as const
  const pts: ChartEntryPoint[] = []
  const seen = new Set<number>()

  // Each entry gets its own target, stop, R/R and verdict from per-entry R/R calculation
  const add = (
    price: number | null | undefined,
    trigger: string,
    stop?: number,
    rr?: number,
    pending?: boolean,
    verdict?: string,
    exitPrice?: number,
    exitPrice2?: number,
  ) => {
    if (!price || !isFinite(price) || price <= 0 || seen.has(price)) return
    seen.add(price)
    pts.push({ label: `E${pts.length + 1}`, price, trigger, stop, direction, exitPrice, exitPrice2, rr, pending, verdict })
  }

  // E1 — AI coach entry gate (confluence zone trigger)
  const eg1 = ac?.entry_gate as Record<string, unknown> | undefined
  const eg1Verdict  = eg1?.verdict as string | undefined
  const eg1IsNT     = eg1Verdict === 'NO_TRADE'
  const eg1Trigger  = eg1IsNT
    ? `⚠ EXTENDED — ${(eg1?.extended_reason as string) || 'entry past session T1'}`
    : ((eg1?.trigger_condition as string) ?? 'Gate trigger')
  add(
    eg1?.trigger_price as number | undefined,
    eg1Trigger,
    eg1IsNT ? undefined : (eg1?.stop as number | undefined) ?? sf,
    eg1IsNT ? 0 : (eg1?.risk_reward as number | undefined),
    false,
    eg1Verdict,
    eg1IsNT ? undefined : (eg1?.target as number | undefined),
    eg1IsNT ? undefined : (eg1?.target_2 as number | undefined),
  )

  // E2 — AI coach trade (current price analysis)
  const tr = ac?.trade as Record<string, unknown> | undefined
  const trVerdict = tr?.verdict as string | undefined
  const trIsNT    = trVerdict === 'NO_TRADE'
  const trRr      = tr?.risk_reward as number | undefined
  const trTrigger = trIsNT
    ? `⚠ EXTENDED — ${(tr?.extended_reason as string) || 'entry past session T1'}`
    : (tr ? `AI Coach · ${tr.direction} (R/R ${(trRr ?? 0).toFixed(1)}×)` : 'AI Coach')
  add(
    tr?.entry_price as number | undefined,
    trTrigger,
    trIsNT ? undefined : (tr?.stop as number | undefined) ?? sf,
    trIsNT ? 0 : trRr,
    false,
    trVerdict,
    trIsNT ? undefined : (tr?.target as number | undefined),
    trIsNT ? undefined : (tr?.target_2 as number | undefined),
  )

  // E3 — OR breakout level
  const orEntryPx  = (eg?.breakout_level ?? (isShort ? orLow : orHigh)) as number | undefined
  const orRr       = ac?.or_breakout_rr as Record<string, unknown> | undefined
  const orVerdict  = orRr?.verdict as string | undefined
  const orIsNT     = orVerdict === 'NO_TRADE'
  const orBreakoutStop = orEntryPx
    ? (isShort ? orEntryPx * 1.003 : orEntryPx * 0.997)
    : (isShort ? orHigh : orLow)
  add(
    orEntryPx,
    isShort ? 'OR low breakout' : 'OR high breakout',
    orIsNT ? undefined : (orRr?.stop as number | undefined) ?? orBreakoutStop,
    orIsNT ? 0 : (orRr?.risk_reward as number | undefined),
    false,
    orVerdict,
    orIsNT ? undefined : (orRr?.target as number | undefined),
    orIsNT ? undefined : (orRr?.target_2 as number | undefined),
  )

  // E4 — Pullback Reset (active if detected) or VWAP retest (pending / conditional)
  const pb = ac?.pullback_entry
  if (pb?.detected && pb.entry_price && isFinite(pb.entry_price)) {
    // Pullback Reset fired — color and label vary by confidence
    const pbPrice    = pb.entry_price
    if (!seen.has(pbPrice)) {
      seen.add(pbPrice)
      const pbConf     = pb.confidence
      const pbPat      = (pb.reclaim_pattern ?? 'RECLAIM').replace(/_/g, ' ')
      const pbColor    = pbConf === 'HIGH' ? '#f59e0b' : pbConf === 'MEDIUM_HIGH' ? '#fb923c' : '#94a3b8'
      const pbSizeNote = pbConf === 'HIGH' ? '' : pbConf === 'MEDIUM_HIGH' ? ' · 75% size' : ' · 50% size'
      const pbTrigger  = `⚡ Pullback Reset — ${(pbConf ?? 'detected').replace(/_/g, '-')} (${pbPat})${pbSizeNote}`
      pts.push({
        label:       `E${pts.length + 1}`,
        price:       pbPrice,
        trigger:     pbTrigger,
        stop:        pb.stop,
        direction,
        exitPrice:   pb.target_1,
        exitPrice2:  pb.target_2,
        rr:          pb.rr_t1,
        pending:     false,
        verdict:     'VALID',
        color:       pbColor,
        triggerTime: pb.bar_timestamp,
      })
    }
  } else {
    // Static VWAP retest (pending)
    const vRr      = ac?.vwap_retest_rr as Record<string, unknown> | undefined
    const vVerdict = vRr?.verdict as string | undefined
    const vwapPrice = (eg?.vwap ?? mVwap) as number | null
    const vwapRetestStop = vwapPrice ? (isShort ? vwapPrice * 1.003 : vwapPrice * 0.997) : sf
    add(
      vwapPrice,
      'VWAP re-test',
      (vRr?.stop as number | undefined) ?? vwapRetestStop,
      vRr?.risk_reward as number | undefined,
      true,
      vVerdict,
      vRr?.target as number | undefined,
      vRr?.target_2 as number | undefined,
    )
  }

  return pts
}

// ─── Verdict badge ─────────────────────────────────────────────────────────
const VERDICT_TITLES: Record<string, string> = {
  STRONG_GO: 'Strong Go — all signals aligned, high confidence. Enter now.',
  GO: 'Go — conditions met. Ready to trade.',
  WATCH: 'Watch — setup forming but not yet triggered. Monitor.',
  WAIT: 'Wait — signal exists but conditions not aligned. Stand by.',
  AVOID: 'Avoid — hard failures present. Do not trade.',
  NO_EDGE: 'No Edge — insufficient signal. Skip.',
  TRACK_ONLY: 'Track only — 15m setup exists but 5m confirmation is pending.',
  WAIT_ENTRY: 'Wait entry — 5m confirmation exists but 1m execution is not ready.',
  DO_NOT_CHASE: 'Do not chase — price is extended from VWAP / opening range levels.',
  NO_TRADE: 'No trade — multi-timeframe hierarchy blocks this setup.',
}

function VerdictBadge({ verdict, statusColor }: { verdict: string; statusColor?: string }) {
  const c = statusColor ?? VERDICT_COLORS[verdict] ?? '#6B7280'
  return (
    <span title={VERDICT_TITLES[verdict] ?? verdict} style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 9px', borderRadius: 20, border: `1.5px solid ${c}`, color: c, background: `${c}18`, whiteSpace: 'nowrap' }}>
      {verdict.replace('_', ' ')}
    </span>
  )
}

function timeframeStatusColor(status: unknown): string {
  const s = String(status || '').toUpperCase()
  if (s === 'SETUP_ACTIVE' || s === 'CONFIRMED' || s === 'READY') return '#00A86B'
  if (s === 'PENDING' || s === 'WAIT_ENTRY' || s === 'DO_NOT_CHASE') return '#D97706'
  if (s === 'NO_SETUP' || s === 'FAILED' || s === 'DISABLED' || s === 'BLOCKED') return '#DC2626'
  return '#6B7280'
}

function timeframeLabel(status: unknown): string {
  const s = String(status || '')
  return s ? s.replace(/_/g, ' ') : '—'
}

function TimeframeCell({
  title,
  status,
  direction,
  reason,
  next,
}: {
  title: string
  status?: unknown
  direction?: unknown
  reason?: unknown
  next?: unknown
}) {
  const color = timeframeStatusColor(status)
  const label = timeframeLabel(status)
  const dir = direction ? String(direction).toUpperCase() : ''
  const detail = [reason, next].filter(Boolean).map(String).join(' · ')
  return (
    <div title={detail || `${title}: ${label}`} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
      <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, border: `1px solid ${color}`, color, background: `${color}18`, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {dir && <div style={{ marginTop: 3, fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color }}>{dir}</div>}
      {reason != null && reason !== '' && <div style={{ marginTop: 3, fontSize: 10, color: '#6B7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(reason)}</div>}
    </div>
  )
}

function DashboardStatCard({
  label,
  value,
  sub,
  tone,
  dt,
}: {
  label: string
  value: string
  sub?: string
  tone?: string
  dt: Record<string, string>
}) {
  return (
    <div style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: dt.muted }}>{label}</div>
      <div style={{ marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 18, fontWeight: 800, color: tone ?? dt.text, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ marginTop: 3, fontSize: 11, color: dt.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}

function vwapTone(price: number | null, vwap: number | null, dt: Record<string, string>) {
  if (price == null || vwap == null) return dt.muted
  if (price > vwap) return dt.green
  if (price < vwap) return dt.red
  return dt.amber
}

function formatPrice(v: number | null): string {
  return v == null ? '—' : v.toFixed(2)
}

function latestChartClose(metrics?: Record<string, unknown> | null): number | null {
  const bars = parseChartBars(metrics?.chart_bars)
  if (!bars || bars.length === 0) return null
  const close = bars[bars.length - 1]?.c
  return typeof close === 'number' && Number.isFinite(close) ? close : null
}

function dayMetricPrice(metrics?: Record<string, unknown> | null, fallback?: number | null): number | null {
  return num(metrics?.last_price)
    ?? num((metrics?.entry_guidance as Record<string, unknown> | undefined)?.current_price)
    ?? latestChartClose(metrics)
    ?? (fallback ?? null)
}

function dayMetricChangePct(metrics?: Record<string, unknown> | null, fallback?: number | null): number | null {
  return num(metrics?.change_pct)
    ?? num(metrics?.regular_market_change_pct)
    ?? num(metrics?.post_market_change_pct)
    ?? num(metrics?.pre_market_change_pct)
    ?? num(metrics?.session_change_pct)
    ?? (fallback ?? null)
}

function scalpText(value: unknown, fallback = '—'): string {
  const text = String(value ?? '').trim()
  return text ? text.replace(/_/g, ' ') : fallback
}

function scalpTradeName(direction: unknown): string {
  const d = String(direction || '').toLowerCase()
  if (d === 'short') return 'LONG PUT'
  if (d === 'long') return 'LONG CALL'
  return 'WAIT'
}

function scalpActionColor(action: string, dt: Record<string, string>): string {
  const a = action.toUpperCase()
  if (a === 'GO' || a.includes('READY')) return dt.green
  if (a.includes('NO') || a.includes('CHASE')) return dt.red
  if (a.includes('TRACK')) return '#38bdf8'
  return dt.amber
}

// ─── Swing ticker table ────────────────────────────────────────────────────
function SwingTickerTable({ tickers, tiles, dt }: {
  tickers: string[]
  tiles: Record<string, TileData>
  dt: Record<string, string>
}) {
  const { isMobile } = useViewport()
  const th: React.CSSProperties = { padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dt.muted, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${dt.border}` }
  const td: React.CSSProperties = { padding: '10px', fontSize: 12, borderBottom: `1px solid ${dt.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600 }

  const macdPill = (v: number | null) => {
    if (v == null) return <span style={{ color: dt.muted }}>—</span>
    const col = v > 0 ? dt.green : dt.red
    return <span style={{ ...mono, color: col }}>{v >= 0 ? '+' : ''}{v.toFixed(3)}</span>
  }

  const maCell = (v: number | null, price: number | null) => {
    if (v == null) return <span style={{ color: dt.muted }}>—</span>
    const above = price != null && price >= v
    return <span style={{ ...mono, color: above ? dt.green : dt.red }}>{v.toFixed(2)}</span>
  }

  // Build row data once for both table and card rendering
  const rows = tickers.map(sym => {
    const tile = tiles[sym]
    const result = (tile?.result ?? null) as SwingTradeScanResult | null
    const unified = tile?.unified ?? null
    const m = (result?.metrics ?? {}) as Record<string, unknown>
    const price  = num(unified?.price) ?? num(m.last_price)
    const pct    = num(unified?.change_pct)
    const chgAmt = price != null && pct != null ? price - price / (1 + pct / 100) : null
    const up     = (pct ?? 0) >= 0
    const chgColor = pct == null ? dt.muted : up ? dt.green : dt.red
    const macd   = num(m.macd)
    const ma20   = num(m.ma20)
    const ma50   = num(m.ma50)
    const verdict = unified?.verdict ?? result?.final_decision ?? result?.verdict?.replace(' ', '_') ?? ''
    const loading = !tile || (tile.loading && !result)
    const error = tile?.error && !result
    return { sym, tile, result, unified, m, price, pct, chgAmt, up, chgColor, macd, ma20, ma50, verdict, loading, error }
  })

  // Mobile: card layout
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ sym, loading, error, price, pct, chgAmt, up, chgColor, macd, ma20, ma50, verdict, unified }) => (
          <div key={sym} style={{ border: `1px solid ${dt.border}`, borderRadius: 10, background: dt.bg, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ ...mono, fontWeight: 800, fontSize: 14, color: dt.text }}>{sym}</div>
                <div style={{ ...mono, fontSize: 11, color: dt.muted }}>{price != null ? `$${price.toFixed(2)}` : '—'}</div>
              </div>
              {verdict ? <VerdictBadge verdict={verdict} statusColor={unified?.verdict_presentation?.status_color} /> : null}
            </div>
            {loading ? (
              <div style={{ fontSize: 12, color: dt.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Scanning…
              </div>
            ) : error ? (
              <div style={{ fontSize: 12, color: dt.red }}>{(tiles[sym]?.error)}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11 }}>
                <div style={{ color: dt.muted }}>Change</div>
                <div style={{ ...mono, color: chgColor, textAlign: 'right' }}>
                  {pct == null ? '—' : `${up ? '+' : ''}${pct.toFixed(2)}%`}
                </div>
                <div style={{ color: dt.muted }}>MACD</div>
                <div style={{ textAlign: 'right' }}>{macdPill(macd)}</div>
                <div style={{ color: dt.muted }}>MA20</div>
                <div style={{ textAlign: 'right' }}>{maCell(ma20, price)}</div>
                <div style={{ color: dt.muted }}>MA50</div>
                <div style={{ textAlign: 'right' }}>{maCell(ma50, price)}</div>
              </div>
            )}
            {!loading && !error && (
              <a href={`${ROUTES.swingTrade}?ticker=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dt.violet, textDecoration: 'none', fontSize: 11, fontWeight: 600, marginTop: 8 }}>
                Swing Trade <ExternalLink size={12} />
              </a>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Desktop: table layout
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${dt.border}`, borderRadius: 12, background: dt.bg }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
        <thead>
          <tr>
            <th style={th}>Ticker</th>
            <th style={th}>Change</th>
            <th style={th}>MACD</th>
            <th style={th}>MA20</th>
            <th style={th}>MA50</th>
            <th style={th}>Verdict</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ sym, loading, error, price, pct, chgAmt, up, chgColor, macd, ma20, ma50, verdict, unified }) => {
            if (loading) {
              return (
                <tr key={sym}>
                  <td style={{ ...td, ...mono, fontWeight: 700, color: dt.text }}>{sym}</td>
                  <td style={{ ...td, color: dt.muted }} colSpan={6}>
                    <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: '-2px', marginRight: 6 }} />
                    Scanning…
                  </td>
                </tr>
              )
            }
            if (error) {
              return (
                <tr key={sym}>
                  <td style={{ ...td, ...mono, fontWeight: 700, color: dt.text }}>{sym}</td>
                  <td style={{ ...td, color: dt.red }} colSpan={6}>{tiles[sym]?.error}</td>
                </tr>
              )
            }
            return (
              <tr key={sym}>
                <td style={td}>
                  <div style={{ ...mono, fontWeight: 800, fontSize: 13, color: dt.text }}>{sym}</div>
                  <div style={{ ...mono, fontSize: 11, color: dt.muted }}>{price != null ? price.toFixed(2) : '—'}</div>
                </td>
                <td style={{ ...td, color: chgColor }}>
                  {pct == null ? '—' : (
                    <div style={mono}>
                      {up ? '▲' : '▼'} {chgAmt != null ? `${up ? '+' : '-'}$${Math.abs(chgAmt).toFixed(2)}` : ''}
                      <div style={{ fontSize: 11 }}>{up ? '+' : ''}{pct.toFixed(2)}%</div>
                    </div>
                  )}
                </td>
                <td style={td}>{macdPill(macd)}</td>
                <td style={td}>{maCell(ma20, price)}</td>
                <td style={td}>{maCell(ma50, price)}</td>
                <td style={td}>{verdict ? <VerdictBadge verdict={verdict} statusColor={unified?.verdict_presentation?.status_color} /> : '—'}</td>
                <td style={td}>
                  <a href={`${ROUTES.swingTrade}?ticker=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer"
                    title="Open in Swing Trade page (new window)"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dt.violet, textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>
                    Swing Trade <ExternalLink size={12} />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Day ticker table (Ticker Table tab) ───────────────────────────────────
function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

function DayTickerTable({ tickers, tiles, dt, isDark }: {
  tickers: string[]
  tiles: Record<string, TileData>
  dt: Record<string, string>
  isDark: boolean
}) {
  const { isMobile } = useViewport()
  const [expandedSyms, setExpandedSyms] = useState<Set<string>>(new Set())
  const [chartIntervals, setChartIntervals] = useState<Record<string, ChartInterval>>({})
  const toggleExpanded = (sym: string) => {
    setExpandedSyms(prev => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym); else next.add(sym)
      return next
    })
  }
  const th: React.CSSProperties = { padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dt.muted, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${dt.border}` }
  const td: React.CSSProperties = { padding: '10px', fontSize: 12, borderBottom: `1px solid ${dt.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }
  const entryTd: React.CSSProperties = { ...td, background: isDark ? 'rgba(74,124,255,0.06)' : 'rgba(74,124,255,0.10)' }
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600 }

  const entryCell = (pts: ChartEntryPoint[], i: number) => {
    const p = pts[i]
    if (!p) return <span style={{ color: dt.muted }}>—</span>
    const isNoTrade = p.verdict === 'NO_TRADE'
    const priceColor = isNoTrade ? dt.red : dt.text
    return (
      <div>
        <div style={{ ...mono, color: priceColor }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: isNoTrade ? dt.red : dt.accent, marginRight: 4 }}>{p.label}</span>
          {p.price.toFixed(2)}
          {p.pending && <span style={{ fontSize: 9, color: dt.amber, marginLeft: 4 }}>PENDING</span>}
          {isNoTrade && <span style={{ fontSize: 9, color: dt.red, marginLeft: 4, fontWeight: 700 }}>NO TRADE</span>}
        </div>
        <div style={{ fontSize: 10, color: isNoTrade ? dt.red : dt.muted, whiteSpace: 'normal', maxWidth: 160, lineHeight: 1.4 }}>
          {p.trigger}
          {!isNoTrade && p.stop != null && ` · stop ${p.stop.toFixed(2)}`}
          {!isNoTrade && p.exitPrice != null && ` · T1 ${p.exitPrice.toFixed(2)}`}
        </div>
        {!isNoTrade && p.stop != null && (
          <div style={{ fontSize: 10, color: isDark ? '#f87171' : '#dc2626', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600 }}>
            stop ${p.stop.toFixed(2)}
          </div>
        )}
      </div>
    )
  }

  // Build row data once
  const rows = tickers.map(sym => {
    const tile = tiles[sym]
    const result = (tile?.result ?? null) as DayTradeScanResult | null
    const unified = tile?.unified ?? null
    const m = (result?.metrics ?? {}) as Record<string, unknown>
    const loading = !tile || (tile.loading && !result)
    const error = tile?.error && !result
    const price  = dayMetricPrice(m, num(unified?.price))
    const pct    = dayMetricChangePct(m, num(unified?.change_pct))
    const chgAmt = price != null && pct != null ? price - price / (1 + pct / 100) : null
    const up     = (pct ?? 0) >= 0
    const chgColor = pct == null ? dt.muted : up ? dt.green : dt.red
    const orHigh = num(m.or_high)
    const orLow  = num(m.or_low)
    const vwap   = num(m.vwap)
    const vwapPos = String(m.vwap_position || '').toLowerCase()
    const vwapDistPct = num(m.vwap_dist_pct)
    const pcr    = num(m.put_call_ratio)
    const rvol   = num(m.rvol)
    const pts    = result ? buildEntryPoints(result, m) : []
    const timeframeState = (result?.timeframe_state ?? (m.timeframe_state as DayTradeScanResult['timeframe_state'] | undefined) ?? null)
    const gatedVerdict = String(timeframeState?.final_decision || result?.final_decision || '').toUpperCase()
    const verdict = gatedVerdict || unified?.verdict || result?.verdict?.replace(' ', '_') || ''
    const chartBars = parseChartBars(m.chart_bars)
    const hasChart = !!(chartBars && chartBars.length > 0 && orHigh != null && orLow != null)
    const setup15 = timeframeState?.setup_15m
    const confirm5 = timeframeState?.confirmation_5m
    const exec1 = timeframeState?.execution_1m
    return { sym, tile, result, unified, m, loading, error, price, pct, chgAmt, up, chgColor, orHigh, orLow, vwap, vwapPos, vwapDistPct, pcr, rvol, pts, timeframeState, gatedVerdict, verdict, chartBars, hasChart, setup15, confirm5, exec1 }
  })

  // Mobile: card layout
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ sym, loading, error, price, pct, chgAmt, up, chgColor, vwap, vwapPos, vwapDistPct, pcr, rvol, verdict, gatedVerdict, unified, pts, orHigh, orLow, chartBars, hasChart }) => {
          const isExpanded = expandedSyms.has(sym)
          return (
            <div key={sym} style={{ border: `1px solid ${dt.border}`, borderRadius: 10, background: dt.bg, overflow: 'hidden' }}>
              {/* Header row */}
              <div
                onClick={() => toggleExpanded(sym)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ ...mono, fontWeight: 800, fontSize: 14, color: dt.text }}>{sym}</div>
                  <div style={{ ...mono, fontSize: 11, color: dt.muted }}>{price != null ? `$${price.toFixed(2)}` : '—'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {verdict ? <VerdictBadge verdict={verdict} statusColor={gatedVerdict ? undefined : unified?.verdict_presentation?.status_color} /> : null}
                  {pct != null && (
                    <span style={{ ...mono, fontSize: 11, color: chgColor }}>{up ? '+' : ''}{pct.toFixed(2)}%</span>
                  )}
                </div>
              </div>

              {loading ? (
                <div style={{ padding: '8px 12px', fontSize: 12, color: dt.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Scanning…
                </div>
              ) : error ? (
                <div style={{ padding: '8px 12px', fontSize: 12, color: dt.red }}>{tiles[sym]?.error}</div>
              ) : (
                <>
                  {/* Key metrics grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', padding: '4px 12px 8px', fontSize: 11 }}>
                    <div style={{ color: dt.muted }}>VWAP</div>
                    <div style={{ ...mono, color: vwapTone(price, vwap, dt), textAlign: 'right' }}>
                      {formatPrice(vwap)} <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{vwapPos || '—'}</span>
                    </div>
                    <div style={{ color: dt.muted }}>RVOL</div>
                    <div style={{ ...mono, color: rvol != null && rvol >= 1.3 ? dt.green : dt.text, textAlign: 'right' }}>
                      {rvol != null ? `${rvol.toFixed(2)}×` : '—'}
                    </div>
                    <div style={{ color: dt.muted }}>P/C</div>
                    <div style={{ ...mono, color: dt.text, textAlign: 'right' }}>{pcr != null ? pcr.toFixed(2) : '—'}</div>
                    {vwapDistPct != null && (
                      <>
                        <div style={{ color: dt.muted }}>VWAP dist</div>
                        <div style={{ ...mono, color: dt.muted, textAlign: 'right' }}>{vwapDistPct >= 0 ? '+' : ''}{vwapDistPct.toFixed(2)}%</div>
                      </>
                    )}
                  </div>

                  {/* Entry points */}
                  {pts.length > 0 && (
                    <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {pts.slice(0, 4).map((p, i) => (
                        <div key={i} style={{ fontSize: 10.5, lineHeight: 1.4, color: dt.text, background: isDark ? 'rgba(74,124,255,0.06)' : 'rgba(74,124,255,0.08)', borderRadius: 6, padding: '4px 8px' }}>
                          <span style={{ ...mono, fontWeight: 700, color: p.verdict === 'NO_TRADE' ? dt.red : dt.accent }}>{p.label}</span>{' '}
                          <span style={{ ...mono }}>${p.price.toFixed(2)}</span>
                          {p.pending && <span style={{ color: dt.amber, marginLeft: 4 }}>PENDING</span>}
                          {p.verdict === 'NO_TRADE' && <span style={{ color: dt.red, marginLeft: 4, fontWeight: 700 }}>NO TRADE</span>}
                          {p.stop != null && p.verdict !== 'NO_TRADE' && <span style={{ color: dt.muted, marginLeft: 6 }}>stop ${p.stop.toFixed(2)}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Link */}
                  <div style={{ padding: '0 12px 8px' }}>
                    <a href={`${ROUTES.dayTrade}?ticker=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dt.accent, textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>
                      Day Trade <ExternalLink size={12} />
                    </a>
                  </div>

                  {/* Expandable chart */}
                  {isExpanded && hasChart && (
                    <div style={{ borderTop: `1px solid ${dt.border}`, background: isDark ? '#0c0e13' : '#F8F9FB', padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                          <button key={iv} onClick={() => setChartIntervals(prev => ({ ...prev, [sym]: iv }))} style={{
                            padding: '2px 8px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
                            border: `1px solid ${(chartIntervals[sym] ?? '1m') === iv ? dt.green : dt.border}`,
                            background: (chartIntervals[sym] ?? '1m') === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent',
                            color: (chartIntervals[sym] ?? '1m') === iv ? dt.green : dt.muted,
                          }}>{iv}</button>
                        ))}
                      </div>
                      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 4 }}>
                        <DayTradeIntradayChart
                          bars={resampleBars(chartBars!, chartIntervals[sym] ?? '1m')}
                          orHigh={orHigh!}
                          orLow={orLow!}
                          orMinutes={orMinutesForInterval(15, chartIntervals[sym] ?? '1m')}
                          sessionDate={String((tiles[sym]?.result as DayTradeScanResult | null)?.metrics?.session_date ?? '')}
                          entryPoints={pts.length > 0 ? pts : undefined}
                          dimEntries={false}
                          isDark={isDark}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Desktop: table layout
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${dt.border}`, borderRadius: 12, background: dt.bg }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1480, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '7%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8%' }} />
          <col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} />
          <col style={{ width: '6%' }} /><col style={{ width: '6%' }} />
          <col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} />
          <col style={{ width: '5%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Ticker</th>
            <th style={th}>Change</th>
            <th style={th}>Verdict</th>
            <th style={th} title="Session VWAP from intraday bars">VWAP</th>
            <th style={th} title="15m = setup only">15m Setup</th>
            <th style={th} title="5m = confirmation gate">5m Confirm</th>
            <th style={th} title="1m = execution only">1m Execute</th>
            <th style={th} title="Put/Call ratio">P/C</th>
            <th style={th} title="Volume vs average (RVOL)">Volume</th>
            <th style={th} title="AI Coach entry gate (confluence zone)">E1</th>
            <th style={th} title="AI Coach trade at current price">E2</th>
            <th style={th} title="Opening-range breakout level">E3</th>
            <th style={th} title="Pullback Reset (live) or VWAP re-test (pending)">E4</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ sym, loading, error, price, pct, chgAmt, up, chgColor, orHigh, orLow, vwap, vwapPos, vwapDistPct, pcr, rvol, pts, timeframeState, gatedVerdict, verdict, unified, chartBars, hasChart, setup15, confirm5, exec1 }) => {
            const isExpanded = expandedSyms.has(sym)

            if (loading) {
              return (
                <tr key={sym}>
                  <td style={{ ...td, ...mono, fontWeight: 700, color: dt.text }}>{sym}</td>
                  <td style={{ ...td, color: dt.muted }} colSpan={13}>
                    <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: '-2px', marginRight: 6 }} />
                    Scanning…
                  </td>
                </tr>
              )
            }
            if (error) {
              return (
                <tr key={sym}>
                  <td style={{ ...td, ...mono, fontWeight: 700, color: dt.text }}>{sym}</td>
                  <td style={{ ...td, color: dt.red }} colSpan={13}>{tiles[sym]?.error}</td>
                </tr>
              )
            }

            return (
              <Fragment key={sym}>
                <tr onClick={() => toggleExpanded(sym)}
                  style={{ cursor: 'pointer', background: isExpanded ? `${dt.accent}08` : undefined }}
                  onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = `${dt.bg2 || '#ffffff08'}` }}
                  onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '' }}>
                  <td style={td}>
                    <div style={{ ...mono, fontWeight: 800, fontSize: 13, color: dt.text }}>{sym}</div>
                    <div style={{ ...mono, fontSize: 11, color: dt.muted }}>{price != null ? price.toFixed(2) : '—'}</div>
                  </td>
                  <td style={{ ...td, color: chgColor }}>
                    {pct == null ? '—' : (
                      <div style={mono}>
                        {up ? '▲' : '▼'} {chgAmt != null ? `${up ? '+' : '-'}$${Math.abs(chgAmt).toFixed(2)}` : ''}
                        <div style={{ fontSize: 11 }}>{up ? '+' : ''}{pct.toFixed(2)}%</div>
                      </div>
                    )}
                  </td>
                  <td style={td}>{verdict ? <VerdictBadge verdict={verdict} statusColor={gatedVerdict ? undefined : unified?.verdict_presentation?.status_color} /> : '—'}</td>
                  <td style={td}>
                    <div style={{ ...mono, color: vwapTone(price, vwap, dt) }}>{formatPrice(vwap)}</div>
                    <div style={{ fontSize: 10, color: vwapTone(price, vwap, dt), textTransform: 'uppercase', fontWeight: 700 }}>
                      {vwapPos || (price != null && vwap != null ? (price >= vwap ? 'above' : 'below') : '—')}
                    </div>
                    {vwapDistPct != null && <div style={{ fontSize: 10, color: dt.muted }}>{vwapDistPct >= 0 ? '+' : ''}{vwapDistPct.toFixed(2)}%</div>}
                  </td>
                  <td style={td}>
                    <TimeframeCell
                      title="15m Setup"
                      status={setup15?.status}
                      direction={setup15?.direction}
                      reason={setup15?.reason}
                      next={setup15?.next_action}
                    />
                  </td>
                  <td style={td}>
                    <TimeframeCell
                      title="5m Confirmation"
                      status={confirm5?.status}
                      direction={confirm5?.direction}
                      reason={confirm5?.reason || confirm5?.trigger_requirement}
                      next={confirm5?.trigger_fired ? 'Trigger fired' : confirm5?.next_action}
                    />
                  </td>
                  <td style={td}>
                    <TimeframeCell
                      title="1m Execution"
                      status={exec1?.status}
                      reason={exec1?.chase_warning || exec1?.reason}
                      next={exec1?.next_action}
                    />
                  </td>
                  <td style={{ ...td, ...mono, color: dt.text }}>{pcr != null ? pcr.toFixed(2) : '—'}</td>
                  <td style={{ ...td, ...mono, color: rvol != null && rvol >= 1.3 ? dt.green : dt.text }}>{rvol != null ? `${rvol.toFixed(2)}×` : '—'}</td>
                  <td style={entryTd}>{entryCell(pts, 0)}</td>
                  <td style={entryTd}>{entryCell(pts, 1)}</td>
                  <td style={entryTd}>{entryCell(pts, 2)}</td>
                  <td style={entryTd}>{entryCell(pts, 3)}</td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    <a href={`${ROUTES.dayTrade}?ticker=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer"
                      title="Open in Day Trade page (new window)"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dt.accent, textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>
                      Day Trade <ExternalLink size={12} />
                    </a>
                  </td>
                </tr>
                {isExpanded && hasChart && (
                  <tr>
                    <td colSpan={14} style={{ padding: 0, background: dt.bg2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 0' }}>
                        <span style={{ fontSize: 10, color: dt.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Candle</span>
                        {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                          <button key={iv} onClick={() => setChartIntervals(prev => ({ ...prev, [sym]: iv }))} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${(chartIntervals[sym] ?? '1m') === iv ? dt.green : dt.border}`, background: (chartIntervals[sym] ?? '1m') === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent', color: (chartIntervals[sym] ?? '1m') === iv ? dt.green : dt.muted }}>{iv}</button>
                        ))}
                      </div>
                      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 4 }}>
                        <DayTradeIntradayChart
                          bars={resampleBars(chartBars!, chartIntervals[sym] ?? '1m')}
                          orHigh={orHigh!}
                          orLow={orLow!}
                          orMinutes={orMinutesForInterval((timeframeState as any)?.or_minutes ?? 15, chartIntervals[sym] ?? '1m')}
                          sessionDate={String((tiles[sym]?.result as DayTradeScanResult | null)?.metrics?.session_date ?? '')}
                          entryPoints={pts.length > 0 ? pts : undefined}
                          dimEntries={false}
                          isDark={isDark}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ScalpDecisionWorkspace({
  ticker,
  price,
  changePct,
  metrics,
  scalp,
  dt,
}: {
  ticker: string
  price: number | null | undefined
  changePct: number | null | undefined
  metrics: Record<string, unknown>
  scalp: Record<string, unknown>
  dt: Record<string, string>
}) {
  const action = scalpText(scalp.action || scalp.status, 'WAIT').toUpperCase()
  const direction = String(scalp.direction || '').toLowerCase()
  const trade = scalpTradeName(direction)
  const color = scalpActionColor(action, dt)
  const entry = num(scalp.entry_price)
  const stop = num(scalp.stop_level)
  const t1 = num(scalp.target_1)
  const t2 = num(scalp.target_2)
  const rr = num(scalp.risk_reward_t1)
  const risk = num(scalp.risk_per_share)
  const quality = num(scalp.trade_quality)
  const volumeConfirmed = Boolean(scalp.volume_confirmed)
  const trendConfirmed = Boolean(scalp.trend_confirmed)
  const priceConfirmed = scalpText(scalp.price_label).toUpperCase() === 'CONFIRMED'
  const momentum = scalpText(scalp.momentum_label, 'BUILDING').toUpperCase()
  const vwapPosition = String(metrics.vwap_position || '').toLowerCase()
  const marketPct = num(metrics.qqq_session_change_pct) ?? num(metrics.qqq_change_pct) ?? num(metrics.spy_session_change_pct) ?? num(metrics.spy_change_pct)
  const marketAligned = marketPct == null ? true : direction === 'short' ? marketPct <= 0 : marketPct >= 0
  const entryReady = action === 'GO'
  const setupChecks = [
    ['Trend', trendConfirmed],
    ['Structure', priceConfirmed],
    ['EMA', trendConfirmed],
    ['Momentum', momentum === 'STRONG'],
    ['Volume', volumeConfirmed],
  ] as Array<[string, boolean]>
  const setupPct = Math.round((setupChecks.filter(([, ok]) => ok).length / setupChecks.length) * 100)
  const missing = [
    !trendConfirmed ? 'trend alignment' : null,
    !priceConfirmed ? 'price structure' : null,
    momentum === 'WEAK' ? 'momentum expansion' : null,
    !volumeConfirmed ? 'volume confirmation' : null,
    !entryReady ? 'entry trigger' : null,
  ].filter(Boolean) as string[]
  const statusCopy = entryReady
    ? 'READY TO ENTER'
    : missing.length ? `WAIT FOR ${missing[0]?.toUpperCase()}` : action
  const checklist = [
    ['Trend', trendConfirmed],
    ['Price Structure', priceConfirmed],
    ['VWAP Context', vwapPosition ? (direction === 'short' ? vwapPosition.includes('below') : vwapPosition.includes('above')) : true],
    ['EMA Alignment', trendConfirmed],
    ['Momentum', momentum === 'STRONG'],
    ['Volume', volumeConfirmed],
    ['Market Direction', marketAligned],
    ['Entry Trigger', entryReady],
  ]
  const cards = [
    ['Trend', direction === 'short' ? 'Bearish' : direction === 'long' ? 'Bullish' : 'Neutral', trendConfirmed ? 'EMA structure supports the scalp direction.' : 'Trend is not aligned yet.', trendConfirmed ? dt.green : dt.amber],
    ['Momentum', momentum === 'STRONG' ? 'Strong and rising' : momentum === 'WEAK' ? 'Weak' : 'Building', momentum === 'STRONG' ? 'Momentum supports continuation.' : 'Wait for momentum to expand before entering.', momentum === 'STRONG' ? dt.green : dt.amber],
    ['Entry', entry != null ? entry.toFixed(2) : '—', 'Use this only after checklist gates are complete.', dt.text],
    ['Stop', stop != null ? stop.toFixed(2) : '—', 'Setup is invalid if price breaks this level.', dt.red],
    ['Reward', rr != null ? `${rr.toFixed(1)}R` : '—', 'Expected reward to first target.', rr != null && rr >= 1.5 ? dt.green : dt.amber],
    ['Confidence', quality != null ? `${Math.round(quality)}%` : '—', 'Composite quality from trend, timing, volume, and extension.', quality != null && quality >= 80 ? dt.green : dt.amber],
  ]
  const momentumState = momentum === 'STRONG' && volumeConfirmed ? 'EXPANDING' : momentum === 'WEAK' ? 'NO MOMENTUM' : volumeConfirmed ? 'BUILDING' : 'FADING'
  const momentumColor = momentumState === 'EXPANDING' ? dt.green : momentumState === 'BUILDING' ? '#38bdf8' : momentumState === 'FADING' ? dt.amber : dt.red
  const volumeRatio = num(scalp.volume_ratio_20)
  const marketLabel = marketPct == null ? 'Neutral' : marketPct < -0.15 ? 'QQQ/SPY Weak' : marketPct > 0.15 ? 'QQQ/SPY Strong' : 'Market flat'
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 14, padding: 12 }}>
        {[
          ['Intraday Trend', direction === 'short' ? 'Bearish' : direction === 'long' ? 'Bullish' : 'Neutral'],
          ['Market', marketLabel],
          ['Volume', volumeConfirmed ? 'Confirmed' : volumeRatio != null ? `${volumeRatio.toFixed(1)}x, needs more` : 'Pending'],
          ['Scalp Bias', trade],
          ['Expected Hold', '15-30 minutes'],
          ['Setup Quality', quality != null ? `${scalpText(scalp.quality_grade, 'Grade')} · ${Math.round(quality)}%` : scalpText(scalp.quality_grade, 'Pending')],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted }}>{label}</div>
            <div style={{ marginTop: 3, fontSize: 13, fontWeight: 800, color: dt.text }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ border: `1px solid ${dt.border}`, background: dt.bg2, borderRadius: 14, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 22, fontWeight: 900, color: dt.text }}>{trade}</span>
              <span style={{ border: `1px solid ${color}`, color, background: `${color}18`, borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em' }}>{statusCopy}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: dt.text, lineHeight: 1.5 }}>{scalpText(scalp.reason, 'Waiting for a cleaner scalp entry.')}</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 5 }}>
              {setupChecks.map(([label, ok]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: dt.text }}>
                  <span style={{ color: ok ? dt.green : dt.amber, fontWeight: 900 }}>{ok ? '✓' : '□'}</span>
                  <span>{label}{!ok && label === 'Volume' ? ' confirmation pending' : ok ? ' confirmed' : ' pending'}</span>
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: dt.muted }}>
                Setup is <span style={{ color, fontWeight: 900 }}>{setupPct}% complete</span>. Missing: <span style={{ color: dt.amber, fontWeight: 800 }}>{missing.join(', ')}</span>. {scalpText(scalp.next_action, 'Wait for a clean 1m setup before entering.')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: dt.muted }}>{ticker}</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 22, fontWeight: 900, color: dt.text }}>{price != null ? `$${price.toFixed(2)}` : '—'}</div>
            {changePct != null && <div style={{ fontSize: 12, color: changePct >= 0 ? dt.green : dt.red }}>{changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%</div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(138px, 1fr))', gap: 8 }}>
        {cards.map(([label, value, sub, tone]) => (
          <div key={label} style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 12, padding: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted }}>{label}</div>
            <div style={{ marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 16, fontWeight: 900, color: tone }}>{value}</div>
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.35, color: dt.muted }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted, marginBottom: 10 }}>Trade Lifecycle</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              ['SETUP', setupPct >= 80, setupChecks],
              ['ENTER', entryReady, [['Entry trigger', entryReady]]],
              ['MANAGE', false, [['Move stop after T1', false]]],
              ['EXIT', false, [['T1/T2 plan ready', t1 != null || t2 != null]]],
            ].map(([step, active, checks], idx) => (
              <div key={String(step)} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8, alignItems: 'start', opacity: idx > 1 && !entryReady ? 0.62 : 1 }}>
                <div style={{ border: `1px solid ${active ? color : dt.border}`, color: active ? color : dt.muted, borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 900, textAlign: 'center' }}>{String(step)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(checks as Array<[string, boolean]>).map(([label, ok]) => (
                    <span key={label} style={{ fontSize: 11, color: ok ? dt.green : dt.muted }}>{ok ? '✓' : '□'} {label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted, marginBottom: 8 }}>Momentum Panel</div>
          <div style={{ display: 'grid', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: dt.muted, fontSize: 12 }}>Momentum Score</span>
              <span style={{ color: momentumColor, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 900 }}>{quality != null ? `${Math.round(quality)} / 100` : 'Pending'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: dt.muted, fontSize: 12 }}>Acceleration</span>
              <span style={{ color: momentumColor, fontWeight: 800 }}>{momentum === 'STRONG' ? 'Increasing' : momentum === 'WEAK' ? 'Weakening' : 'Building'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: dt.muted, fontSize: 12 }}>Volume</span>
              <span style={{ color: volumeConfirmed ? dt.green : dt.amber, fontWeight: 800 }}>{volumeConfirmed ? 'Confirmed' : 'Pending'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: dt.muted, fontSize: 12 }}>Momentum State</span>
              <span style={{ color: momentumColor, fontWeight: 900 }}>{momentumState}</span>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.45, color: dt.muted }}>
              {momentumState === 'EXPANDING'
                ? 'Momentum is strengthening across the recent candles, increasing continuation probability.'
                : momentumState === 'FADING'
                  ? 'Momentum is not complete yet. Wait for volume to confirm before risking capital.'
                  : momentumState === 'NO MOMENTUM'
                    ? 'Momentum is weakening. Wait for buyers or sellers to regain control.'
                    : 'Momentum is building, but the setup still needs the remaining confirmation gates.'}
            </div>
          </div>
        </div>
        <DecisionPanel dt={dt} title="Trade Structure" rows={[
          ['Trade', trade],
          ['Suggested contract', entry != null ? `${Math.round(entry)} ${direction === 'short' ? 'Put' : 'Call'}` : direction === 'short' ? 'Put near 0.55-0.70 delta' : 'Call near 0.55-0.70 delta'],
          ['Expiration', scalpText(scalp.recommended_dte, '5-10 DTE')],
          ['Expected hold', '10-30 minutes'],
          ['Target delta', '0.55-0.70'],
          ['Risk', risk != null && risk > 1.5 ? 'Medium-high' : 'Medium'],
        ]} />
        <DecisionPanel dt={dt} title="Risk vs Reward" rows={[
          ['Risk', risk != null ? `$${risk.toFixed(2)}/share` : '—'],
          ['T1 reward', rr != null ? `${rr.toFixed(1)}R` : '—'],
          ['T2 reward', risk != null && risk > 0 && entry != null && t2 != null ? `${(Math.abs(t2 - entry) / risk).toFixed(1)}R` : '—'],
          ['T2 target', t2 != null ? `$${t2.toFixed(2)}` : '—'],
          ['Probability', quality != null && quality >= 80 ? 'High' : 'Medium'],
          ['Estimated hold', '15-30 minutes'],
          ['Expected win rate', quality != null ? `${Math.min(78, Math.max(52, Math.round(quality * 0.78)))}%` : '—'],
        ]} />
        <div style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted, marginBottom: 8 }}>Scalp Checklist</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            {checklist.map(([label, ok]) => (
              <div key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: dt.text }}>
                <span style={{ color: ok ? dt.green : dt.amber, fontWeight: 900 }}>{ok ? '✓' : '□'}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <DecisionPanel dt={dt} title="Exit Plan" rows={[
          ['Entry', entry != null ? `$${entry.toFixed(2)}` : 'Wait'],
          ['Stop', stop != null ? `$${stop.toFixed(2)}` : '—'],
          ['T1', t1 != null ? `$${t1.toFixed(2)} - sell 50%'` : '—'],
          ['After T1', 'Move stop to breakeven'],
          ['T2', t2 != null ? `$${t2.toFixed(2)} - exit remainder` : '—'],
        ]} />
      </div>
    </div>
  )
}

function DecisionPanel({ dt, title, rows }: { dt: Record<string, string>; title: string; rows: Array<[string, string]> }) {
  return (
    <div style={{ border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: dt.muted, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: dt.muted }}>{label}</span>
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, fontWeight: 800, color: dt.text, textAlign: 'right' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Chart expand modal ────────────────────────────────────────────────────
function ChartModal({ data, isDark, dt, onClose }: {
  data: ExpandedChart; isDark: boolean; dt: Record<string, string>; onClose: () => void
}) {
  const isSwing    = data.tab === 'swing'
  const chartBars  = !isSwing ? parseChartBars(data.metrics.chart_bars) : null
  const orHigh     = data.metrics.or_high as number | undefined
  const orLow      = data.metrics.or_low  as number | undefined
  const orMin      = (data.metrics.or_minutes as number | undefined) ?? 15
  const sessionDate = String(data.metrics.session_date ?? '')
  const [chartInterval, setChartInterval] = useState<ChartInterval>('1m')
  const [scalpZoom, setScalpZoom] = useState(1)
  const displayBars = !isSwing && chartBars ? resampleBars(chartBars, chartInterval) : null
  const displayOrMin = orMinutesForInterval(orMin, chartInterval)
  const scalpState = !isSwing && data.metrics.scalp_trading && typeof data.metrics.scalp_trading === 'object'
    ? data.metrics.scalp_trading as Record<string, unknown>
    : null
  const verdict    = data.unified?.verdict ?? ''
  const statusColor = data.unified?.verdict_presentation?.status_color
  const dimEntries = (() => {
    const fd = String(verdict || '').toUpperCase()
    return fd === 'WAIT' || fd === 'CONFLICT' || fd === 'AVOID_CHASE' || fd === 'AVOID' || fd === 'NO_EDGE'
  })()
  const price      = isSwing ? data.unified?.price : dayMetricPrice(data.metrics, data.unified?.price)
  const changePct  = isSwing ? data.unified?.change_pct : dayMetricChangePct(data.metrics, data.unified?.change_pct)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dt.bg, borderRadius: 16, width: '100%', maxWidth: 1100, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'clip', border: `1px solid ${dt.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${dt.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20, color: dt.text }}>{data.ticker}</span>
            {price != null && <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: dt.text }}>${price.toFixed(2)}</span>}
            {changePct != null && price != null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: changePct >= 0 ? dt.green : dt.red }}>
                {changePct >= 0 ? '▲' : '▼'} ${Math.abs(price * changePct / (100 + changePct)).toFixed(2)} ({Math.abs(changePct).toFixed(2)}%)
              </span>
            )}
            {verdict && <VerdictBadge verdict={verdict} statusColor={statusColor} />}
            <span style={{ fontSize: 11, color: dt.muted }}>
              {isSwing ? 'Swing · Daily Chart' : data.tab === 'scalp' ? 'Scalp · EMA trend / Momentum / Volume' : 'Intraday · 6:30 AM – 1:00 PM PT'}
            </span>
            {!isSwing && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                  <button key={iv} onClick={() => setChartInterval(iv)} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${chartInterval === iv ? dt.green : dt.border}`, background: chartInterval === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent', color: chartInterval === iv ? dt.green : dt.muted, transition: 'all 0.15s' }}>{iv}</button>
                ))}
              </div>
            )}
            {!isSwing && data.tab === 'scalp' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, padding: 3, border: `1px solid ${dt.border}`, borderRadius: 999, background: isDark ? '#111827' : '#F8FAFC' }}>
                <button
                  type="button"
                  onClick={() => setScalpZoom(z => Math.max(0.75, Math.round((z - 0.25) * 100) / 100))}
                  title="Zoom out"
                  aria-label="Zoom out scalp chart"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, border: 'none', background: 'transparent', color: dt.muted, cursor: 'pointer' }}
                >
                  <ZoomOut size={14} />
                </button>
                <span style={{ minWidth: 42, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, fontWeight: 800, color: dt.text }}>
                  {Math.round(scalpZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setScalpZoom(z => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))}
                  title="Zoom in"
                  aria-label="Zoom in scalp chart"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, border: 'none', background: 'transparent', color: dt.muted, cursor: 'pointer' }}
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setScalpZoom(1)}
                  title="Reset zoom"
                  aria-label="Reset scalp chart zoom"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, border: 'none', background: 'transparent', color: dt.muted, cursor: 'pointer' }}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: isDark ? '#1E2330' : '#F3F4F6', border: 'none', cursor: 'pointer', color: dt.muted, flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, minWidth: 0, width: '100%', overflowY: 'auto', padding: '16px 20px 20px' }}>
          {isSwing ? (
            <SwingTradeMetricCharts metrics={data.metrics} mode="price" />
          ) : data.tab === 'scalp' && chartBars && chartBars.length > 0 ? (
            <div style={{ display: 'grid', gap: 16 }}>
              {scalpState ? (
                <ScalpDecisionWorkspace
                  ticker={data.ticker}
                  price={price}
                  changePct={changePct}
                  metrics={data.metrics}
                  scalp={scalpState}
                  dt={dt}
                />
              ) : null}
              <ScalpTradingChart bars={chartBars} scalp={scalpState} isDark={isDark} zoomScale={scalpZoom} />
            </div>
          ) : displayBars && displayBars.length > 0 && orHigh != null && orLow != null ? (
            <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
              <DayTradeIntradayChart bars={displayBars} orHigh={orHigh} orLow={orLow} orMinutes={displayOrMin} sessionDate={sessionDate} entryPoints={data.entryPoints && data.entryPoints.length > 0 ? data.entryPoints : undefined} dimEntries={dimEntries} showScalpStudy={data.tab === 'scalp'} isDark={isDark} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: dt.muted }}>No chart data</div>
          )}
        </div>

        <div style={{ padding: '8px 20px 12px', borderTop: `1px solid ${dt.border}`, fontSize: 11, color: dt.muted, flexShrink: 0 }}>
          Press <kbd style={{ background: isDark ? '#1E2330' : '#F3F4F6', border: `1px solid ${dt.border}`, borderRadius: 4, padding: '1px 5px', fontSize: 10 }}>Esc</kbd> or click outside to close
        </div>
      </div>
    </div>
  )
}

// ─── Single ticker tile ────────────────────────────────────────────────────
function TickerTile({ tile, tab, dt, isDark, onRemove, onExpand, dragHandleProps, isDragging, isDropTarget, agreementBadge }: {
  tile: TileData; tab: Tab; dt: Record<string, string>; isDark: boolean
  onRemove: () => void
  onExpand: () => void
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>
  isDragging: boolean; isDropTarget: boolean
  agreementBadge?: string
}) {
  const [chartInterval, setChartInterval] = useState<ChartInterval>('1m')
  const { result, unified } = tile
  const isSwing  = tab === 'swing'
  const metrics  = result?.metrics as Record<string, unknown> | undefined
  const chartBars = !isSwing && metrics ? parseChartBars(metrics.chart_bars) : null
  const orHigh   = metrics?.or_high as number | undefined
  const orLow    = metrics?.or_low  as number | undefined
  const orMin    = (metrics?.or_minutes as number | undefined) ?? 15
  const sessionDate = String(metrics?.session_date ?? '')
  const displayChartBars = !isSwing && chartBars ? resampleBars(chartBars, chartInterval) : null
  const displayOrMin = orMinutesForInterval(orMin, chartInterval)
  const scalpState = !isSwing && metrics?.scalp_trading && typeof metrics.scalp_trading === 'object'
    ? metrics.scalp_trading as Record<string, unknown>
    : null

  const entryPoints = !isSwing && result && metrics
    ? buildEntryPoints(result as DayTradeScanResult, metrics)
    : []

  const dimEntries = (() => {
    const v = String(unified?.verdict || '').toUpperCase()
    return v === 'WAIT' || v === 'CONFLICT' || v === 'AVOID' || v === 'NO_EDGE'
  })()

  const detailHref = isSwing
    ? `${ROUTES.swingTrade}?ticker=${encodeURIComponent(tile.ticker)}`
    : `${ROUTES.dayTrade}?ticker=${encodeURIComponent(tile.ticker)}`

  const ticker    = unified?.ticker ?? result?.ticker ?? tile.ticker
  const company   = unified?.company ?? result?.company_name ?? ''
  const price     = isSwing ? unified?.price : dayMetricPrice(metrics, unified?.price)
  const changePct = isSwing ? unified?.change_pct : dayMetricChangePct(metrics, unified?.change_pct)
  const verdict   = unified?.verdict ?? result?.verdict?.replace(' ', '_') ?? ''
  const statusColor = unified?.verdict_presentation?.status_color
  const confidence  = unified?.confidence
  const sigScore    = unified?.verdict_presentation?.signal_quality?.score

  const hasChart = (isSwing && !!metrics) || (!isSwing && !!chartBars && chartBars.length > 0 && orHigh != null && orLow != null)

  return (
    <div style={{ background: dt.bg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${isDropTarget ? dt.accent : isDragging ? 'transparent' : dt.border}`, opacity: isDragging ? 0.4 : 1, outline: isDropTarget ? `2px solid ${dt.accent}` : 'none', outlineOffset: 2, display: 'flex', flexDirection: 'column', minWidth: 0, transition: 'opacity 0.15s, outline 0.1s, border-color 0.1s' }}>
      {/* Drag handle */}
      <div {...dragHandleProps} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, cursor: 'grab', userSelect: 'none', color: dt.muted, opacity: 0.45 }} title="Drag to reorder">
        <GripVertical size={14} />
      </div>

      {/* Loading state */}
      {tile.loading && !tile.result && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: dt.muted, fontSize: 13 }}>
          <RefreshCw size={16} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} />
          Scanning {tile.ticker}…
        </div>
      )}

      {/* Error state */}
      {tile.error && !tile.result && (
        <div style={{ color: dt.red, fontSize: 12, padding: '16px 0' }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontFamily: 'monospace' }}>{tile.ticker}</div>
          {tile.error}
        </div>
      )}

      {/* Content */}
      {(tile.result || tile.unified) && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 18, color: dt.text }}>{ticker}</span>
              {company && <span style={{ fontSize: 11, color: dt.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company}</span>}
              {price != null && <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: dt.text }}>${price.toFixed(2)}</span>}
              {changePct != null && price != null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: changePct >= 0 ? dt.green : dt.red }}>
                  {changePct >= 0 ? '▲' : '▼'} ${Math.abs(price * changePct / (100 + changePct)).toFixed(2)} ({Math.abs(changePct).toFixed(2)}%)
                </span>
              )}
              {verdict && <VerdictBadge verdict={verdict} statusColor={statusColor} />}
              {agreementBadge && (
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '1px 6px', borderRadius: 10, border: `1px solid ${
                  agreementBadge.includes('STRONG') ? 'rgba(16,185,129,0.4)' :
                  agreementBadge === 'CONFLICT' ? 'rgba(239,68,68,0.35)' :
                  agreementBadge === 'PARTIAL_AGREEMENT' ? 'rgba(56,189,248,0.35)' :
                  'rgba(107,114,128,0.3)'
                }`, color: agreementBadge.includes('STRONG') ? '#6EE7B7' : agreementBadge === 'CONFLICT' ? '#FCA5A5' : agreementBadge === 'PARTIAL_AGREEMENT' ? '#7DD3FC' : dt.muted,
                background: 'transparent',
                }} title="Cross-engine agreement from Signal Feed">
                  {agreementBadge.replace(/_/g, ' ')}
                </span>
              )}
              {confidence != null && (
                <span style={{ fontSize: 11, color: dt.muted, fontFamily: 'monospace' }}>
                  <span style={{ color: statusColor ?? dt.green, fontWeight: 700 }}>{confidence}</span>
                  {sigScore != null && <span>  ·  {sigScore}/10</span>}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <a href={detailHref} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: dt.accent, border: `1px solid ${dt.accent}40`, borderRadius: 6, padding: '3px 8px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                <ExternalLink size={11} /> Details
              </a>
              <button onClick={onRemove} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'none', border: `1px solid ${dt.border}`, cursor: 'pointer', color: dt.muted }}>
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Friday 0DTE warning */}
          {!isSwing && new Date().getDay() === 5 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '6px 10px', marginBottom: 8, fontSize: 10 }}>
              <span style={{ background: '#dc2626', color: '#fff', fontWeight: 900, fontSize: 8, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.08em', flexShrink: 0, marginTop: 1 }}>FRIDAY</span>
              <span style={{ color: '#fca5a5', lineHeight: 1.4 }}>No 0DTE day trades today. Use 3–4 DTE minimum or switch to Swing.</span>
            </div>
          )}

          {/* Reason */}
          {unified?.reason && (
            <div style={{ fontSize: 11, color: dt.muted, lineHeight: 1.5, marginBottom: 10, borderLeft: `2px solid ${dt.border}`, paddingLeft: 8 }}>
              {unified.reason}
            </div>
          )}

          {/* Key levels */}
          {unified && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              {unified.entry_price != null && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Entry</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.green }}>${unified.entry_price.toFixed(2)}</div>
                </div>
              )}
              {unified.stop_price != null && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stop</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.red }}>${unified.stop_price.toFixed(2)}</div>
                </div>
              )}
              {unified.rr_ratio && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>R/R</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.text }}>{unified.rr_ratio}</div>
                </div>
              )}
              {unified.risk_level && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: unified.risk_level === 'LOW' ? dt.green : unified.risk_level === 'HIGH' ? dt.red : dt.amber }}>
                    {unified.risk_level}
                  </div>
                </div>
              )}
              {!isSwing && (result as DayTradeScanResult)?.signal_quality && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signal</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.text }}>{(result as DayTradeScanResult).signal_quality}</div>
                </div>
              )}
              {isSwing && (result as SwingTradeScanResult)?.trade_quality_score != null && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quality</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.text }}>{(result as SwingTradeScanResult).trade_quality_score}/10</div>
                </div>
              )}
            </div>
          )}

          {tab === 'scalp' && scalpState && (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, padding: '7px 9px', border: `1px solid ${dt.border}`, borderRadius: 9, background: dt.bg2 }}>
              <span style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: String(scalpState.action).includes('GO') ? dt.green : String(scalpState.action).includes('NO') || String(scalpState.action).includes('CHASE') ? dt.red : dt.amber }}>
                {String(scalpState.action || scalpState.status || 'WAIT').replace(/_/g, ' ')}
              </span>
              <span style={{ fontSize: 11, color: dt.muted }}>Quality {String(scalpState.trade_quality ?? '—')} · DTE {String(scalpState.recommended_dte || '5-10 DTE')}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8, marginBottom: 10 }}>
              {[
                ['Entry', num(scalpState.entry_price), dt.green],
                ['Stop', num(scalpState.stop_level), dt.red],
                ['T1', num(scalpState.target_1), dt.accent],
                ['Risk', num(scalpState.risk_per_share), dt.red],
              ].map(([label, value, color]) => (
                <div key={String(label)} style={{ border: `1px solid ${dt.border}`, borderRadius: 8, padding: '6px 8px', background: dt.bg2 }}>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>{String(label)}</div>
                  <div style={{ marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, fontWeight: 800, color: String(color) }}>
                    {typeof value === 'number' ? `$${value.toFixed(2)}` : '—'}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}

          {/* Chart */}
          {hasChart ? (
            <div onClick={onExpand} title="Click to expand chart" style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in' }}>
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '3px 7px', pointerEvents: 'none' }}>
                <Maximize2 size={11} color="#fff" />
                <span style={{ fontSize: 9, color: '#fff', fontWeight: 700, letterSpacing: '0.04em' }}>EXPAND</span>
              </div>
              {isSwing && metrics ? (
                <SwingTradeMetricCharts metrics={metrics} mode="price" />
              ) : tab === 'scalp' && chartBars ? (
                <div onClick={e => e.stopPropagation()}>
                  <div onClick={onExpand} style={{ cursor: 'zoom-in' }}>
                    <ScalpTradingChart bars={chartBars} scalp={scalpState} isDark={isDark} />
                  </div>
                </div>
              ) : (
                <div onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: dt.bg2, border: `1px solid ${dt.border}`, borderBottom: 'none', borderRadius: '8px 8px 0 0' }}>
                    <span style={{ fontSize: 10, color: dt.muted, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Session Chart</span>
                    {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                      <button
                        key={iv}
                        type="button"
                        onClick={() => setChartInterval(iv)}
                        style={{ padding: '2px 9px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 800, cursor: 'pointer', border: `1px solid ${chartInterval === iv ? dt.green : dt.border}`, background: chartInterval === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent', color: chartInterval === iv ? dt.green : dt.muted }}
                      >
                        {iv}
                      </button>
                    ))}
                  </div>
                  <div onClick={onExpand} style={{ cursor: 'zoom-in' }}>
                    <DayTradeIntradayChart bars={displayChartBars!} orHigh={orHigh!} orLow={orLow!} orMinutes={displayOrMin} sessionDate={sessionDate} entryPoints={entryPoints.length > 0 ? entryPoints : undefined} dimEntries={dimEntries} showScalpStudy={tab === 'scalp'} isDark={isDark} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: dt.muted, fontSize: 11, border: `1px dashed ${dt.border}`, borderRadius: 8 }}>
              No chart data available
            </div>
          )}

          {tile.loading && tile.result && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: dt.muted, marginTop: 6 }}>
              <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> Refreshing…
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Ticker input bar ──────────────────────────────────────────────────────
function TickerBar({ tickers, onAdd, onRemove, dt, accentColor }: {
  tickers: string[]; onAdd: (sym: string) => void; onRemove: (sym: string) => void
  dt: Record<string, string>; accentColor: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const sym = input.trim().toUpperCase()
    if (!sym || sym.length > 12 || tickers.includes(sym) || tickers.length >= MAX_TICKERS) return
    onAdd(sym); setInput('')
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={input} onChange={e => setInput(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add ticker (e.g. NVDA)" maxLength={12}
        style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 8, color: dt.text, padding: '7px 12px', outline: 'none', width: 160 }} />
      <button onClick={add} disabled={!input.trim() || tickers.length >= MAX_TICKERS}
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: !input.trim() || tickers.length >= MAX_TICKERS ? 'not-allowed' : 'pointer', background: dt.bg, color: accentColor, border: `1px solid ${accentColor}50`, opacity: !input.trim() || tickers.length >= MAX_TICKERS ? 0.5 : 1 }}>
        <Plus size={14} /> Add
      </button>
      <span style={{ fontSize: 11, color: dt.muted }}>{tickers.length}/{MAX_TICKERS}</span>
      {tickers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 4 }}>
          {tickers.map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'monospace', fontWeight: 700, background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 6, padding: '3px 8px', color: dt.text }}>
              {t}
              <button onClick={() => onRemove(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dt.muted, padding: 0, display: 'flex', alignItems: 'center' }}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function DayTradeDashboardPage() {
  const { theme } = useApp()
  const isDark = theme !== 'light'

  const dt = {
    bg: isDark ? '#111318' : '#FFFFFF', bg2: isDark ? '#0A0C10' : '#F3F4F6',
    border: isDark ? '#1E2330' : '#E5E7EB', text: isDark ? '#E8EBF0' : '#111827',
    muted: isDark ? '#5A6478' : '#6B7280', green: isDark ? '#00E5A0' : '#00A86B',
    red: isDark ? '#FF4D6D' : '#DC2626', amber: isDark ? '#F5A623' : '#D97706',
    accent: '#4A7CFF', violet: '#6B7FD4',
  }

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    try { return (localStorage.getItem(SK_ACTIVE_TAB) as Tab) ?? 'day' } catch { return 'day' }
  })
  useEffect(() => { try { localStorage.setItem(SK_ACTIVE_TAB, activeTab) } catch { /* quota */ } }, [activeTab])

  const loadTickers = (key: string) => {
    try { return normalizeTickerList(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { return [] }
  }
  const [dayTickers,   setDayTickers]   = useState<string[]>(() => loadTickers(SK_DAY_TICKERS))
  const [swingTickers, setSwingTickers] = useState<string[]>(() => loadTickers(SK_SWING_TICKERS))
  useEffect(() => { try { localStorage.setItem(SK_DAY_TICKERS,   JSON.stringify(dayTickers))   } catch { /* quota */ } }, [dayTickers])
  useEffect(() => { try { localStorage.setItem(SK_SWING_TICKERS, JSON.stringify(swingTickers)) } catch { /* quota */ } }, [swingTickers])

  // Load dashboard tickers from backend on mount (cross-browser sync).
  // Falls back to localStorage if the API call fails.
  const [tickersLoadedFromApi, setTickersLoadedFromApi] = useState(false)
  useEffect(() => {
    getDashboardTickers()
      .then(resp => {
        setDayTickers(normalizeTickerList(resp.day))
        setSwingTickers(normalizeTickerList(resp.swing))
        setTickersLoadedFromApi(true)
      })
      .catch(() => { /* use localStorage fallback */ })
  }, [])

  // Debounced save to backend whenever tickers change (after initial API load).
  const dashboardSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!tickersLoadedFromApi) return
    if (dashboardSaveTimer.current) clearTimeout(dashboardSaveTimer.current)
    dashboardSaveTimer.current = setTimeout(() => {
      saveDashboardTickers({ day: dayTickers, swing: swingTickers }).catch(() => {})
    }, 500)
    return () => { if (dashboardSaveTimer.current) clearTimeout(dashboardSaveTimer.current) }
  }, [dayTickers, swingTickers, tickersLoadedFromApi])

  const [dayTiles,   setDayTiles]   = useState<Record<string, TileData>>({})
  const [swingTiles, setSwingTiles] = useState<Record<string, TileData>>({})
  const [expandedChart, setExpandedChart] = useState<ExpandedChart | null>(null)

  const dataTab: DataTab = activeTab === 'swing' ? 'swing' : 'day'
  const tickers    = dataTab === 'day' ? dayTickers   : swingTickers
  const setTickers = dataTab === 'day' ? setDayTickers : setSwingTickers
  const tiles      = dataTab === 'day' ? dayTiles     : swingTiles

  const [lastRefreshed, setLastRefreshed] = useState<Record<DataTab, Date | null>>({ day: null, swing: null })
  const [refreshing,    setRefreshing]    = useState(false)
  const [agreementMap,  setAgreementMap]  = useState<Record<string, string>>({})

  // Scan a single ticker — force_refresh bypasses all caches
  const scanTicker = useCallback(async (sym: string, tab: DataTab, forceRefresh = false) => {
    sym = sym.trim().toUpperCase()
    if (!sym) return
    const requestId = Date.now() + Math.random()
    const setter = tab === 'day' ? setDayTiles : setSwingTiles
    setter(prev => ({ ...prev, [sym]: { ...(prev[sym] ?? { ticker: sym, result: null, unified: null, error: null }), loading: true, error: null, requestId } }))
    try {
      const data = tab === 'swing' ? await analyzeSwingTrade(sym) : await analyzeDayTrade(sym, forceRefresh)
      setter(prev => {
        if (prev[sym]?.requestId !== requestId) return prev
        return { ...prev, [sym]: { ...prev[sym]!, result: data, loading: false } }
      })
      try {
        const v2 = await analyzeV2(sym, tab, { forceRefresh })
        setter(prev => {
          if (prev[sym]?.requestId !== requestId) return prev
          return { ...prev, [sym]: { ...prev[sym]!, unified: v2.data } }
        })
      } catch { /* non-fatal */ }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Scan failed'
      setter(prev => {
        if (prev[sym]?.requestId !== requestId) return prev
        return { ...prev, [sym]: { ...prev[sym]!, loading: false, error: String(msg) } }
      })
    }
  }, [])

  const scanAll = useCallback(async (syms: string[], tab: DataTab, forceRefresh = false) => {
    if (!syms.length) return
    setRefreshing(true)
    await Promise.allSettled(syms.map(s => scanTicker(s, tab, forceRefresh)))
    setLastRefreshed(prev => ({ ...prev, [tab]: new Date() }))
    setRefreshing(false)
  }, [scanTicker])

  // Initial scan
  useEffect(() => {
    if (dayTickers.length)   void scanAll(dayTickers,   'day')
    if (swingTickers.length) void scanAll(swingTickers, 'swing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch Signal Feed once for cross-engine agreement badges
  useEffect(() => {
    fetchSignalFeed({ page: 1, page_size: 100 })
      .then(env => {
        const map: Record<string, string> = {}
        for (const row of env.data?.rows ?? []) {
          const badge = String(row.agreement_badge || row.agreement_state || '').toUpperCase()
          if (badge) map[row.ticker.toUpperCase()] = badge
        }
        setAgreementMap(map)
      })
      .catch(() => {/* non-fatal */})
  }, [])

  // Auto-refresh every 30s — also refresh when tab becomes visible again
  useEffect(() => {
    if (!tickers.length) return
    const id = setInterval(() => void scanAll(tickers, dataTab, true), AUTO_REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void scanAll(tickers, dataTab, true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [tickers, dataTab, scanAll])

  // Expand chart — force fresh scan first
  const handleExpand = useCallback(async (sym: string, tab: Tab) => {
    const scanTab: DataTab = tab === 'swing' ? 'swing' : 'day'
    await scanTicker(sym, scanTab, true)
    const setter = scanTab === 'day' ? setDayTiles : setSwingTiles
    setter(prev => {
      const tile = prev[sym]
      if (!tile?.result) return prev
      const metrics = tile.result.metrics as Record<string, unknown> | undefined
      if (!metrics) return prev
      const isSwing = scanTab === 'swing'
      const entryPoints = !isSwing
        ? buildEntryPoints(tile.result as DayTradeScanResult, metrics)
        : undefined
      setExpandedChart({ ticker: sym, tab, metrics, entryPoints: entryPoints?.length ? entryPoints : undefined, unified: tile.unified })
      return prev
    })
  }, [scanTicker])

  const addTicker = (sym: string) => {
    sym = sym.trim().toUpperCase()
    if (!sym) return
    setTickers(prev => normalizeTickerList([sym, ...prev]))
    void scanTicker(sym, dataTab, true)
  }

  const removeTicker = (sym: string) => {
    setTickers(prev => prev.filter(t => t !== sym))
    const setter = dataTab === 'day' ? setDayTiles : setSwingTiles
    setter(prev => { const n = { ...prev }; delete n[sym]; return n })
  }

  const reorder = (from: string, to: string) => {
    setTickers(prev => {
      const next = [...prev]
      const fi = next.indexOf(from), ti = next.indexOf(to)
      if (fi < 0 || ti < 0) return prev
      next.splice(fi, 1); next.splice(ti, 0, from)
      return next
    })
  }

  // Drag-and-drop state
  const dragSrc     = useRef<string | null>(null)
  const [dragging,    setDragging]    = useState<string | null>(null)
  const [dropTarget,  setDropTarget]  = useState<string | null>(null)
  const makeHandleProps = (sym: string): React.HTMLAttributes<HTMLDivElement> => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { dragSrc.current = sym; setDragging(sym); e.dataTransfer.effectAllowed = 'move' },
    onDragEnd:   () => { dragSrc.current = null; setDragging(null); setDropTarget(null) },
  })

  const fmtTime   = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const tabAccent = activeTab === 'swing' ? dt.violet : dt.accent

  return (
    <div style={{ minHeight: '100vh', background: isDark ? '#07090d' : '#F3F4F6', color: dt.text, padding: '10px 8px 36px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 1440, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12, border: `1px solid ${dt.border}`, background: dt.bg, borderRadius: 14, padding: '12px 14px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: dt.text, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <LayoutDashboard size={20} style={{ color: dt.accent, flexShrink: 0 }} />
              Trade Dashboard
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: dt.muted }}>Trading terminal for intraday execution and swing monitoring · auto-refreshes every 60s</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Link to={ROUTES.tradeCommandCenter} style={{ fontSize: 12, color: dt.muted, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${dt.border}`, borderRadius: 8, padding: '6px 10px' }}>
              Command Center
            </Link>
            <Link to={ROUTES.dayTrade} style={{ fontSize: 12, color: dt.accent, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${dt.accent}55`, borderRadius: 8, padding: '6px 10px' }}>
              DayTrade Page <ExternalLink size={12} />
            </Link>
            {lastRefreshed[dataTab] && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: dt.muted }}>
                <Clock size={11} /> Updated {fmtTime(lastRefreshed[dataTab]!)}
              </div>
            )}
            <button onClick={() => void scanAll(tickers, dataTab, true)} disabled={refreshing || !tickers.length}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: refreshing || !tickers.length ? 'not-allowed' : 'pointer', background: tabAccent, color: '#fff', border: 'none', opacity: refreshing || !tickers.length ? 0.5 : 1 }}>
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
          <DashboardStatCard dt={dt} label="Intraday Symbols" value={String(dayTickers.length)} sub="Session chart + MTF gates" tone={dt.accent} />
          <DashboardStatCard dt={dt} label="Swing Symbols" value={String(swingTickers.length)} sub="Daily trend workspace" tone={dt.violet} />
          <DashboardStatCard dt={dt} label="Active Workspace" value={activeTab === 'swing' ? 'Swing' : activeTab === 'table' ? 'Intraday Table' : activeTab === 'scalp' ? 'Scalp' : 'Intraday'} sub={`${tickers.length}/${MAX_TICKERS} symbols`} />
          <DashboardStatCard dt={dt} label="Chart Engine" value={activeTab === 'scalp' ? 'Scalp' : 'Session'} sub={activeTab === 'scalp' ? 'EMA trend · Momentum · Volume' : 'VWAP · OR · sigma bands'} tone={dt.green} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14, border: `1px solid ${dt.border}`, borderRadius: 12, background: dt.bg, padding: 6 }}>
          {([
            { id: 'table' as Tab, label: 'Intraday Table', icon: <Table2 size={14} />,  accent: dt.accent },
            { id: 'day'   as Tab, label: 'Intraday Charts', icon: <CandlestickChart size={14} />, accent: dt.accent },
            { id: 'scalp' as Tab, label: 'Scalp Trading', icon: <Activity size={14} />, accent: dt.green },
            { id: 'swing' as Tab, label: 'Swing Trade',     icon: <TrendingUp size={14} />, accent: dt.violet },
          ]).map(({ id, label, icon, accent }) => {
            const active = activeTab === id
            return (
              <button key={id} onClick={() => setActiveTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: active ? 800 : 600, color: active ? accent : dt.muted, background: active ? `${accent}16` : 'transparent', border: `1px solid ${active ? `${accent}55` : 'transparent'}`, borderRadius: 9, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                {icon} {label}
                <span style={{ fontSize: 10, fontFamily: 'monospace', background: active ? `${accent}20` : 'transparent', color: active ? accent : dt.muted, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>
                  {id === 'swing' ? swingTickers.length : dayTickers.length}
                </span>
              </button>
            )
          })}
        </div>

        {/* Add ticker bar */}
        <TickerBar tickers={tickers} onAdd={addTicker} onRemove={removeTicker} dt={dt} accentColor={tabAccent} />

        {/* Tile grid / ticker table */}
        {tickers.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 20px', border: `2px dashed ${dt.border}`, borderRadius: 16, color: dt.muted, textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>{activeTab === 'swing' ? '📈' : activeTab === 'table' ? '📋' : activeTab === 'scalp' ? '🎯' : '⚡'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: dt.text }}>No tickers added yet</div>
            <div style={{ fontSize: 13 }}>Add up to {MAX_TICKERS} tickers above to monitor them all at once</div>
          </div>
        ) : activeTab === 'table' ? (
          <DayTickerTable tickers={dayTickers} tiles={tiles} dt={dt} isDark={isDark} />
        ) : activeTab === 'swing' ? (
          <SwingTickerTable tickers={swingTickers} tiles={tiles} dt={dt} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 16 }}>
            {tickers.map(sym => (
              <div key={sym}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragSrc.current && dragSrc.current !== sym) setDropTarget(sym) }}
                onDragLeave={() => setDropTarget(prev => prev === sym ? null : prev)}
                onDrop={e => { e.preventDefault(); const src = dragSrc.current; if (src && src !== sym) reorder(src, sym); setDropTarget(null) }}
              >
                <TickerTile
                  tile={tiles[sym] ?? { ticker: sym, result: null, unified: null, loading: true, error: null }}
                  tab={activeTab} dt={dt} isDark={isDark}
                  onRemove={() => removeTicker(sym)}
                  onExpand={() => void handleExpand(sym, activeTab)}
                  dragHandleProps={makeHandleProps(sym)}
                  isDragging={dragging === sym}
                  isDropTarget={dropTarget === sym}
                  agreementBadge={agreementMap[sym.toUpperCase()]}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart modal */}
      {expandedChart && (
        <ChartModal
          data={expandedChart}
          isDark={isDark}
          dt={dt}
          onClose={() => setExpandedChart(null)}
        />
      )}
    </div>
  )
}
