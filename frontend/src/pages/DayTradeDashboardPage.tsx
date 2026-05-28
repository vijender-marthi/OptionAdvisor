import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Plus, X, ExternalLink, Clock } from 'lucide-react'
import { analyzeDayTrade, analyzeV2 } from '../api/client'
import type { DayTradeScanResult, UnifiedAnalysis } from '../api/client'
import DayTradeIntradayChart, { parseChartBars } from '../components/DayTradeIntradayChart'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'

const STORAGE_KEY = 'oa_dt_dashboard_tickers'
const AUTO_REFRESH_MS = 5 * 60 * 1000

// ─── Per-tile state ────────────────────────────────────────────────────────
interface TileData {
  ticker: string
  result: DayTradeScanResult | null
  unified: UnifiedAnalysis | null
  loading: boolean
  error: string | null
}

// ─── Compact verdict badge ─────────────────────────────────────────────────
const VERDICT_COLORS: Record<string, string> = {
  STRONG_GO: '#00A86B',
  GO:        '#00A86B',
  WATCH:     '#D97706',
  WAIT:      '#6B7280',
  AVOID:     '#DC2626',
  NO_EDGE:   '#6B7280',
}

function verdictLabel(v: string) {
  return v?.replace('_', ' ') ?? v
}

function VerdictBadge({ verdict, status_color }: { verdict: string; status_color?: string }) {
  const color = status_color ?? VERDICT_COLORS[verdict] ?? '#6B7280'
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '2px 9px',
      borderRadius: 20,
      border: `1.5px solid ${color}`,
      color,
      background: `${color}18`,
      whiteSpace: 'nowrap',
    }}>
      {verdictLabel(verdict)}
    </span>
  )
}

// ─── Compact summary row above the chart ──────────────────────────────────
function TileHeader({ tile, isDark, dt, onRemove, onNavigate }: {
  tile: TileData
  isDark: boolean
  dt: Record<string, string>
  onRemove: () => void
  onNavigate: () => void
}) {
  const { unified, result } = tile

  if (!unified && !result) return null

  const ticker    = unified?.ticker ?? result?.ticker ?? tile.ticker
  const company   = unified?.company ?? result?.company_name ?? ''
  const price     = unified?.price
  const changePct = unified?.change_pct
  const verdict   = unified?.verdict ?? result?.verdict?.replace(' ', '_') ?? ''
  const statusColor = unified?.verdict_presentation.status_color
  const confidence  = unified?.confidence
  const signalScore = unified?.verdict_presentation.signal_quality.score

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      {/* Left: ticker + price + verdict */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 18, color: dt.text, letterSpacing: '-0.01em' }}>{ticker}</span>
        {company && <span style={{ fontSize: 11, color: dt.muted, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{company}</span>}
        {price != null && (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: dt.text }}>${price.toFixed(2)}</span>
        )}
        {changePct != null && (
          <span style={{ fontSize: 11, fontWeight: 600, color: changePct >= 0 ? dt.green : dt.red }}>
            {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
          </span>
        )}
        {verdict && <VerdictBadge verdict={verdict} status_color={statusColor} />}
        {confidence != null && (
          <span style={{ fontSize: 11, color: dt.muted, fontFamily: 'monospace' }}>
            <span style={{ color: statusColor ?? dt.green, fontWeight: 700 }}>{confidence}</span>
            {signalScore != null && <span style={{ color: dt.muted }}>  ·  {signalScore}/10</span>}
          </span>
        )}
      </div>

      {/* Right: detail link + remove */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={onNavigate}
          title="Full analysis"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: dt.accent, background: 'none', border: `1px solid ${dt.accent}40`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <ExternalLink size={11} /> Details
        </button>
        <button
          onClick={onRemove}
          title="Remove ticker"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'none', border: `1px solid ${dt.border}`, cursor: 'pointer', color: dt.muted }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Single ticker tile ────────────────────────────────────────────────────
function TickerTile({ tile, isDark, dt, onRemove }: {
  tile: TileData
  isDark: boolean
  dt: Record<string, string>
  onRemove: () => void
}) {
  const navigate = useNavigate()
  const { result } = tile

  const metrics    = result?.metrics as Record<string, unknown> | undefined
  const chartBars  = metrics ? parseChartBars(metrics.chart_bars) : null
  const orHigh     = metrics?.or_high as number | undefined
  const orLow      = metrics?.or_low as number | undefined
  const orMin      = (metrics?.or_minutes as number | undefined) ?? 15
  const sessionDate = String(metrics?.session_date ?? '')

  const goToDetail = () => navigate(`${ROUTES.dayTrade}?ticker=${encodeURIComponent(tile.ticker)}`)

  return (
    <div style={{
      background: dt.bg,
      border: `1px solid ${dt.border}`,
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      minWidth: 0,
    }}>
      {tile.loading && !tile.result && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: dt.muted, fontSize: 13 }}>
          <RefreshCw size={16} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} />
          Scanning {tile.ticker}…
        </div>
      )}

      {tile.error && !tile.result && (
        <div style={{ color: dt.red, fontSize: 12, padding: '16px 0' }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontFamily: 'monospace' }}>{tile.ticker}</div>
          {tile.error}
        </div>
      )}

      {(tile.result || tile.unified) && (
        <>
          <TileHeader
            tile={tile}
            isDark={isDark}
            dt={dt}
            onRemove={onRemove}
            onNavigate={goToDetail}
          />

          {/* Compact verdict reason */}
          {tile.unified?.reason && (
            <div style={{ fontSize: 11, color: dt.muted, lineHeight: 1.5, marginBottom: 10, borderLeft: `2px solid ${dt.border}`, paddingLeft: 8 }}>
              {tile.unified.reason}
            </div>
          )}

          {/* Key levels row */}
          {tile.unified && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              {tile.unified.entry_price != null && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Entry</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.green }}>${tile.unified.entry_price.toFixed(2)}</div>
                </div>
              )}
              {tile.unified.stop_price != null && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stop</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.red }}>${tile.unified.stop_price.toFixed(2)}</div>
                </div>
              )}
              {tile.unified.rr_ratio && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>R/R</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.text }}>{tile.unified.rr_ratio}</div>
                </div>
              )}
              {tile.unified.risk_level && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: tile.unified.risk_level === 'LOW' ? dt.green : tile.unified.risk_level === 'HIGH' ? dt.red : dt.amber }}>{tile.unified.risk_level}</div>
                </div>
              )}
              {tile.result?.signal_quality && (
                <div>
                  <div style={{ fontSize: 9, color: dt.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signal</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dt.text }}>{tile.result.signal_quality}</div>
                </div>
              )}
            </div>
          )}

          {/* Session chart */}
          {chartBars && chartBars.length > 0 && orHigh != null && orLow != null ? (
            <div style={{ overflow: 'hidden', borderRadius: 8, flex: 1 }}>
              <DayTradeIntradayChart
                bars={chartBars}
                orHigh={orHigh}
                orLow={orLow}
                orMinutes={orMin}
                sessionDate={sessionDate}
              />
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

// ─── Main dashboard page ───────────────────────────────────────────────────
export default function DayTradeDashboardPage() {
  const { theme } = useApp()
  const isDark = theme !== 'light'
  const dt = {
    bg:      isDark ? '#111318' : '#FFFFFF',
    bgDeep:  isDark ? '#0A0C10' : '#F3F4F6',
    bgInput: isDark ? '#181C23' : '#F8F9FB',
    border:  isDark ? '#1E2330' : '#E5E7EB',
    text:    isDark ? '#E8EBF0' : '#111827',
    muted:   isDark ? '#5A6478' : '#6B7280',
    green:   isDark ? '#00E5A0' : '#00A86B',
    red:     isDark ? '#FF4D6D' : '#DC2626',
    amber:   isDark ? '#F5A623' : '#D97706',
    accent:  '#4A7CFF',
  }

  const [tickers, setTickers] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  const [tiles, setTiles] = useState<Record<string, TileData>>({})
  const [addInput, setAddInput] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Persist tickers to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers))
  }, [tickers])

  const scanTicker = useCallback(async (sym: string) => {
    setTiles(prev => ({
      ...prev,
      [sym]: { ...(prev[sym] ?? { ticker: sym, result: null, unified: null, error: null }), loading: true, error: null },
    }))
    try {
      const data = await analyzeDayTrade(sym)
      setTiles(prev => ({
        ...prev,
        [sym]: { ...prev[sym], result: data, loading: false },
      }))
      try {
        const v2 = await analyzeV2(sym, 'day')
        setTiles(prev => ({
          ...prev,
          [sym]: { ...prev[sym], unified: v2.data },
        }))
      } catch { /* non-fatal */ }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Scan failed'
      setTiles(prev => ({
        ...prev,
        [sym]: { ...prev[sym], loading: false, error: String(msg) },
      }))
    }
  }, [])

  const scanAll = useCallback(async (syms: string[]) => {
    if (!syms.length) return
    setRefreshing(true)
    await Promise.allSettled(syms.map(s => scanTicker(s)))
    setLastRefreshed(new Date())
    setRefreshing(false)
  }, [scanTicker])

  // Initial scan
  useEffect(() => {
    if (tickers.length > 0) void scanAll(tickers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!tickers.length) return
    const id = setInterval(() => void scanAll(tickers), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [tickers, scanAll])

  const addTicker = () => {
    const sym = addInput.trim().toUpperCase()
    if (!sym || sym.length > 12) return
    if (tickers.includes(sym)) { setAddInput(''); return }
    if (tickers.length >= 8) return
    const next = [...tickers, sym]
    setTickers(next)
    setAddInput('')
    void scanTicker(sym)
  }

  const removeTicker = (sym: string) => {
    setTickers(prev => prev.filter(t => t !== sym))
    setTiles(prev => {
      const next = { ...prev }
      delete next[sym]
      return next
    })
  }

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  return (
    <div style={{ minHeight: '100vh', background: dt.bgDeep, color: dt.text, padding: '20px 16px 40px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: dt.text, letterSpacing: '-0.02em' }}>
              Day Trade Dashboard
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: dt.muted }}>
              Monitor up to 8 intraday tickers · refreshes every 5 min
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {lastRefreshed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: dt.muted }}>
                <Clock size={11} /> Updated {fmtTime(lastRefreshed)}
              </div>
            )}
            <button
              onClick={() => void scanAll(tickers)}
              disabled={refreshing || !tickers.length}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                padding: '6px 14px', borderRadius: 8, cursor: refreshing || !tickers.length ? 'not-allowed' : 'pointer',
                background: dt.accent, color: '#fff', border: 'none', opacity: refreshing || !tickers.length ? 0.5 : 1,
              }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              Refresh All
            </button>
          </div>
        </div>

        {/* ── Add ticker bar ──────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addTicker()}
            placeholder="Add ticker (e.g. NVDA)"
            maxLength={12}
            style={{
              fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.04em',
              background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 8,
              color: dt.text, padding: '7px 12px', outline: 'none', width: 160,
            }}
          />
          <button
            onClick={addTicker}
            disabled={!addInput.trim() || tickers.length >= 8}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
              padding: '7px 14px', borderRadius: 8, cursor: !addInput.trim() || tickers.length >= 8 ? 'not-allowed' : 'pointer',
              background: dt.bg, color: dt.accent, border: `1px solid ${dt.accent}50`,
              opacity: !addInput.trim() || tickers.length >= 8 ? 0.5 : 1,
            }}
          >
            <Plus size={14} /> Add
          </button>
          <span style={{ fontSize: 11, color: dt.muted }}>{tickers.length}/8 tickers</span>

          {/* Quick-remove chips */}
          {tickers.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 4 }}>
              {tickers.map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                  fontFamily: 'monospace', fontWeight: 700,
                  background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 6,
                  padding: '3px 8px', color: dt.text,
                }}>
                  {t}
                  <button onClick={() => removeTicker(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dt.muted, padding: 0, display: 'flex', alignItems: 'center' }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Empty state ─────────────────────────────────────────── */}
        {tickers.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '60px 20px',
            border: `2px dashed ${dt.border}`, borderRadius: 16, color: dt.muted, textAlign: 'center',
          }}>
            <div style={{ fontSize: 40 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: dt.text }}>No tickers added yet</div>
            <div style={{ fontSize: 13 }}>Add up to 8 tickers above to monitor them all at once</div>
          </div>
        )}

        {/* ── Tile grid ───────────────────────────────────────────── */}
        {tickers.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))',
            gap: 16,
          }}>
            {tickers.map(sym => (
              <TickerTile
                key={sym}
                tile={tiles[sym] ?? { ticker: sym, result: null, unified: null, loading: true, error: null }}
                isDark={isDark}
                dt={dt}
                onRemove={() => removeTicker(sym)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
