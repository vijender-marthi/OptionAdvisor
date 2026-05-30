import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Plus, X, ExternalLink, Clock, GripVertical, Zap, TrendingUp, Maximize2, Gauge } from 'lucide-react'
import { analyzeDayTrade, analyzeSwingTrade, analyzeV2 } from '../api/client'
import type { DayTradeScanResult, SwingTradeScanResult, UnifiedAnalysis } from '../api/client'
import DayTradeIntradayChart, { parseChartBars, type ChartEntryPoint } from '../components/DayTradeIntradayChart'
import SwingTradeMetricCharts from '../components/SwingTradeMetricCharts'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'

const SK_DAY_TICKERS   = 'oa_dashboard_tickers_day'
const SK_SWING_TICKERS = 'oa_dashboard_tickers_swing'
const SK_ACTIVE_TAB    = 'oa_dashboard_active_tab'
const AUTO_REFRESH_MS  = 60 * 1000
const MAX_TICKERS      = 8

type Tab = 'day' | 'swing'

interface TileData {
  ticker: string
  result: DayTradeScanResult | SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  loading: boolean
  error: string | null
}

interface ExpandedChart {
  ticker: string
  tab: Tab
  metrics: Record<string, unknown>
  entryPoints?: ChartEntryPoint[]
  unified: UnifiedAnalysis | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const VERDICT_COLORS: Record<string, string> = {
  STRONG_GO: '#00A86B', GO: '#00A86B', WATCH: '#D97706',
  WAIT: '#6B7280', AVOID: '#DC2626', NO_EDGE: '#6B7280',
}

function buildEntryPoints(result: DayTradeScanResult, metrics: Record<string, unknown>): ChartEntryPoint[] {
  const eg = result.entry_guidance, ac = result.ai_coach
  const orHigh  = metrics.or_high as number | undefined
  const orLow   = metrics.or_low  as number | undefined
  const mVwap   = typeof metrics.vwap === 'number' && isFinite(metrics.vwap) ? metrics.vwap as number : null
  const isShort = result.bias === 'short'
  const sf      = isShort ? orHigh : orLow
  const direction = isShort ? 'short' : 'long' as const
  const exitPrice = typeof eg?.scalp_target === 'number' && isFinite(eg.scalp_target) ? eg.scalp_target : undefined
  const seen = new Set<number>()
  const pts: ChartEntryPoint[] = []
  const add = (price: number | null | undefined, trigger: string, stop?: number) => {
    if (!price || !isFinite(price) || price <= 0 || seen.has(price)) return
    seen.add(price)
    pts.push({ label: `E${pts.length + 1}`, price, trigger, stop, direction, exitPrice })
  }
  add(ac?.entry_gate?.trigger_price, ac?.entry_gate?.trigger_condition ?? 'Gate trigger', eg?.risk_below ?? sf)
  add(ac?.trade?.entry_price, ac?.trade ? `AI Coach · ${ac.trade.direction} (R/R ${ac.trade.risk_reward.toFixed(1)}×)` : 'AI Coach', ac?.trade?.stop ?? sf)
  add((eg?.breakout_level ?? (isShort ? orLow : orHigh)) as number, isShort ? 'OR low breakout' : 'OR high breakout', isShort ? orHigh : orLow)
  add((eg?.vwap ?? mVwap) as number | null, 'VWAP re-test', eg?.risk_below ?? sf)
  return pts
}

// ─── Verdict badge ─────────────────────────────────────────────────────────
function VerdictBadge({ verdict, statusColor }: { verdict: string; statusColor?: string }) {
  const c = statusColor ?? VERDICT_COLORS[verdict] ?? '#6B7280'
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 9px', borderRadius: 20, border: `1.5px solid ${c}`, color: c, background: `${c}18`, whiteSpace: 'nowrap' }}>
      {verdict.replace('_', ' ')}
    </span>
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
  const verdict    = data.unified?.verdict ?? ''
  const statusColor = data.unified?.verdict_presentation?.status_color
  const dimEntries = (() => {
    const fd = String(verdict || '').toUpperCase()
    return fd === 'WAIT' || fd === 'CONFLICT' || fd === 'AVOID_CHASE' || fd === 'AVOID' || fd === 'NO_EDGE'
  })()
  const price      = data.unified?.price
  const changePct  = data.unified?.change_pct

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
            {changePct != null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: changePct >= 0 ? dt.green : dt.red }}>
                {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
              </span>
            )}
            {verdict && <VerdictBadge verdict={verdict} statusColor={statusColor} />}
            <span style={{ fontSize: 11, color: dt.muted }}>
              {isSwing ? 'Swing · Daily Chart' : 'Intraday · 6:30 AM – 1:00 PM PT'}
            </span>
          </div>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: isDark ? '#1E2330' : '#F3F4F6', border: 'none', cursor: 'pointer', color: dt.muted, flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, minWidth: 0, width: '100%', overflowY: 'auto', padding: '16px 20px 20px' }}>
          {isSwing ? (
            <SwingTradeMetricCharts metrics={data.metrics} mode="price" />
          ) : chartBars && chartBars.length > 0 && orHigh != null && orLow != null ? (
            <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
              <DayTradeIntradayChart bars={chartBars} orHigh={orHigh} orLow={orLow} orMinutes={orMin} sessionDate={sessionDate} entryPoints={data.entryPoints && data.entryPoints.length > 0 ? data.entryPoints : undefined} dimEntries={dimEntries} />
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
function TickerTile({ tile, tab, dt, isDark, onRemove, onExpand, dragHandleProps, isDragging, isDropTarget }: {
  tile: TileData; tab: Tab; dt: Record<string, string>; isDark: boolean
  onRemove: () => void
  onExpand: () => void
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>
  isDragging: boolean; isDropTarget: boolean
}) {
  const { result, unified } = tile
  const isSwing  = tab === 'swing'
  const metrics  = result?.metrics as Record<string, unknown> | undefined
  const chartBars = !isSwing && metrics ? parseChartBars(metrics.chart_bars) : null
  const orHigh   = metrics?.or_high as number | undefined
  const orLow    = metrics?.or_low  as number | undefined
  const orMin    = (metrics?.or_minutes as number | undefined) ?? 15
  const sessionDate = String(metrics?.session_date ?? '')

  const entryPoints = !isSwing && result && metrics
    ? buildEntryPoints(result as DayTradeScanResult, metrics)
    : []

  const detailHref = isSwing
    ? `${ROUTES.swingTrade}?ticker=${encodeURIComponent(tile.ticker)}`
    : `${ROUTES.dayTrade}?ticker=${encodeURIComponent(tile.ticker)}`

  const ticker    = unified?.ticker ?? result?.ticker ?? tile.ticker
  const company   = unified?.company ?? result?.company_name ?? ''
  const price     = unified?.price
  const changePct = unified?.change_pct
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
              {changePct != null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: changePct >= 0 ? dt.green : dt.red }}>
                  {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
                </span>
              )}
              {verdict && <VerdictBadge verdict={verdict} statusColor={statusColor} />}
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

          {/* Chart */}
          {hasChart ? (
            <div onClick={onExpand} title="Click to expand chart" style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in' }}>
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.45)', borderRadius: 6, padding: '3px 7px', pointerEvents: 'none' }}>
                <Maximize2 size={11} color="#fff" />
                <span style={{ fontSize: 9, color: '#fff', fontWeight: 600, letterSpacing: '0.04em' }}>EXPAND</span>
              </div>
              {isSwing && metrics ? (
                <SwingTradeMetricCharts metrics={metrics} mode="price" />
              ) : (
                <DayTradeIntradayChart bars={chartBars!} orHigh={orHigh!} orLow={orLow!} orMinutes={orMin} sessionDate={sessionDate} entryPoints={entryPoints.length > 0 ? entryPoints : undefined} />
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
    bg: isDark ? '#111318' : '#FFFFFF', bgDeep: isDark ? '#0A0C10' : '#F3F4F6',
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
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[] } catch { return [] }
  }
  const [dayTickers,   setDayTickers]   = useState<string[]>(() => loadTickers(SK_DAY_TICKERS))
  const [swingTickers, setSwingTickers] = useState<string[]>(() => loadTickers(SK_SWING_TICKERS))
  useEffect(() => { try { localStorage.setItem(SK_DAY_TICKERS,   JSON.stringify(dayTickers))   } catch { /* quota */ } }, [dayTickers])
  useEffect(() => { try { localStorage.setItem(SK_SWING_TICKERS, JSON.stringify(swingTickers)) } catch { /* quota */ } }, [swingTickers])

  const [dayTiles,   setDayTiles]   = useState<Record<string, TileData>>({})
  const [swingTiles, setSwingTiles] = useState<Record<string, TileData>>({})
  const [expandedChart, setExpandedChart] = useState<ExpandedChart | null>(null)

  const tickers    = activeTab === 'day' ? dayTickers   : swingTickers
  const setTickers = activeTab === 'day' ? setDayTickers : setSwingTickers
  const tiles      = activeTab === 'day' ? dayTiles     : swingTiles

  const [lastRefreshed, setLastRefreshed] = useState<Record<Tab, Date | null>>({ day: null, swing: null })
  const [refreshing,    setRefreshing]    = useState(false)

  // Scan a single ticker — force_refresh bypasses all caches
  const scanTicker = useCallback(async (sym: string, tab: Tab, forceRefresh = false) => {
    const setter = tab === 'day' ? setDayTiles : setSwingTiles
    setter(prev => ({ ...prev, [sym]: { ...(prev[sym] ?? { ticker: sym, result: null, unified: null, error: null }), loading: true, error: null } }))
    try {
      const data = tab === 'swing' ? await analyzeSwingTrade(sym) : await analyzeDayTrade(sym, forceRefresh)
      setter(prev => ({ ...prev, [sym]: { ...prev[sym]!, result: data, loading: false } }))
      try {
        const v2 = await analyzeV2(sym, tab)
        setter(prev => ({ ...prev, [sym]: { ...prev[sym]!, unified: v2.data } }))
      } catch { /* non-fatal */ }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Scan failed'
      setter(prev => ({ ...prev, [sym]: { ...prev[sym]!, loading: false, error: String(msg) } }))
    }
  }, [])

  const scanAll = useCallback(async (syms: string[], tab: Tab, forceRefresh = false) => {
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

  // Auto-refresh every 60s — also refresh when tab becomes visible again
  useEffect(() => {
    if (!tickers.length) return
    const id = setInterval(() => void scanAll(tickers, activeTab, true), AUTO_REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void scanAll(tickers, activeTab, true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [tickers, activeTab, scanAll])

  // Expand chart — force fresh scan first
  const handleExpand = useCallback(async (sym: string, tab: Tab) => {
    await scanTicker(sym, tab, true)
    const setter = tab === 'day' ? setDayTiles : setSwingTiles
    setter(prev => {
      const tile = prev[sym]
      if (!tile?.result) return prev
      const metrics = tile.result.metrics as Record<string, unknown> | undefined
      if (!metrics) return prev
      const isSwing = tab === 'swing'
      const entryPoints = !isSwing
        ? buildEntryPoints(tile.result as DayTradeScanResult, metrics)
        : undefined
      setExpandedChart({ ticker: sym, tab, metrics, entryPoints: entryPoints?.length ? entryPoints : undefined, unified: tile.unified })
      return prev
    })
  }, [scanTicker])

  const addTicker = (sym: string) => {
    setTickers(prev => [...prev, sym])
    void scanTicker(sym, activeTab, true)
  }

  const removeTicker = (sym: string) => {
    setTickers(prev => prev.filter(t => t !== sym))
    const setter = activeTab === 'day' ? setDayTiles : setSwingTiles
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
    <div style={{ minHeight: '100vh', background: dt.bgDeep, color: dt.text, padding: '20px 16px 40px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: dt.text, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gauge size={20} style={{ color: dt.accent, flexShrink: 0 }} />
              Trade Dashboard
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: dt.muted }}>Monitor up to {MAX_TICKERS} tickers · auto-refreshes every 60s</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {lastRefreshed[activeTab] && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: dt.muted }}>
                <Clock size={11} /> Updated {fmtTime(lastRefreshed[activeTab]!)}
              </div>
            )}
            <button onClick={() => void scanAll(tickers, activeTab, true)} disabled={refreshing || !tickers.length}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: refreshing || !tickers.length ? 'not-allowed' : 'pointer', background: tabAccent, color: '#fff', border: 'none', opacity: refreshing || !tickers.length ? 0.5 : 1 }}>
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: `1px solid ${dt.border}` }}>
          {([
            { id: 'day'   as Tab, label: 'Intraday',    icon: <Zap size={14} />,       accent: dt.accent },
            { id: 'swing' as Tab, label: 'Swing Trade', icon: <TrendingUp size={14} />, accent: dt.violet },
          ]).map(({ id, label, icon, accent }) => {
            const active = activeTab === id
            return (
              <button key={id} onClick={() => setActiveTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: active ? 700 : 500, color: active ? accent : dt.muted, background: 'none', border: 'none', borderBottom: active ? `2px solid ${accent}` : '2px solid transparent', marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s' }}>
                {icon} {label}
                <span style={{ fontSize: 10, fontFamily: 'monospace', background: active ? `${accent}20` : 'transparent', color: active ? accent : dt.muted, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>
                  {id === 'day' ? dayTickers.length : swingTickers.length}
                </span>
              </button>
            )
          })}
        </div>

        {/* Add ticker bar */}
        <TickerBar tickers={tickers} onAdd={addTicker} onRemove={removeTicker} dt={dt} accentColor={tabAccent} />

        {/* Tile grid */}
        {tickers.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 20px', border: `2px dashed ${dt.border}`, borderRadius: 16, color: dt.muted, textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>{activeTab === 'swing' ? '📈' : '⚡'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: dt.text }}>No tickers added yet</div>
            <div style={{ fontSize: 13 }}>Add up to {MAX_TICKERS} tickers above to monitor them all at once</div>
          </div>
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
