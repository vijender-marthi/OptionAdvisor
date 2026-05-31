import axios from 'axios'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Command,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchMarketPosition, fetchTradeCommandCenter } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { getDetailsRoute } from '../routing/routes'
import type {
  ApiEnvelope,
  OverallDecision,
  TradeCommandCenterPayload,
  TccRec,
} from '../types/commandCenter'

// ── Palette ───────────────────────────────────────────────────────────────────
type Palette = {
  page: string; card: string; cardHover: string
  border: string; borderSubtle: string; borderFaint: string
  text: string; textSub: string; textMuted: string; textFaint: string
  dot: string
}

const C_DARK: Palette = {
  page:        '#0A0C10',
  card:        '#111318',
  cardHover:   'rgba(255,255,255,0.03)',
  border:      '#1E2330',
  borderSubtle:'#252C3A',
  borderFaint: 'rgba(255,255,255,0.06)',
  text:        '#E8EBF0',
  textSub:     '#94A3B8',
  textMuted:   '#64748B',
  textFaint:   '#374151',
  dot:         '#1E2330',
}

const C_LIGHT: Palette = {
  page:        '#F0F2F5',
  card:        '#FFFFFF',
  cardHover:   'rgba(0,0,0,0.02)',
  border:      '#E5E7EB',
  borderSubtle:'#D1D5DB',
  borderFaint: '#E5E7EB',
  text:        '#111827',
  textSub:     '#4B5563',
  textMuted:   '#6B7280',
  textFaint:   '#9CA3AF',
  dot:         '#E5E7EB',
}

// ── Error formatting ──────────────────────────────────────────────────────────
function axiosErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { detail?: unknown } | undefined
    if (typeof d?.detail === 'string') return d.detail
    if (err.response?.status === 401) return 'Session expired — sign in again.'
    if (err.response?.status === 404) return 'Command Center API not found (is the backend running on port 9000?).'
    return err.message || 'Request failed'
  }
  if (err instanceof Error) return err.message
  return 'Failed to load Trade Command Center'
}

// ── Display formatting ────────────────────────────────────────────────────────
function fmtTimestamp(value?: string): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}

// ── Semantic color helpers (tone-based, work on both themes) ─────────────────
function verdictBadgeStyle(tone: string, isDark: boolean): React.CSSProperties {
  if (tone === 'bullish') return { background: isDark ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.12)', color: isDark ? '#6EE7B7' : '#065F46', border: '1px solid rgba(16,185,129,0.35)' }
  if (tone === 'warning') return { background: isDark ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.1)', color: isDark ? '#FCD34D' : '#92400E', border: '1px solid rgba(245,158,11,0.35)' }
  if (tone === 'bearish') return { background: isDark ? 'rgba(239,68,68,0.13)' : 'rgba(239,68,68,0.09)', color: isDark ? '#FCA5A5' : '#991B1B', border: '1px solid rgba(239,68,68,0.3)' }
  return { background: isDark ? 'rgba(71,85,105,0.5)' : 'rgba(107,114,128,0.12)', color: isDark ? '#94A3B8' : '#4B5563', border: isDark ? '1px solid rgba(71,85,105,0.4)' : '1px solid #D1D5DB' }
}

function engineChipStyle(eng: string, isDark: boolean): React.CSSProperties {
  if (eng === 'day')   return { borderColor: isDark ? 'rgba(249,115,22,0.3)' : 'rgba(249,115,22,0.4)', color: isDark ? '#FB923C' : '#C2410C', background: isDark ? 'rgba(124,45,18,0.18)' : 'rgba(255,237,213,0.7)' }
  if (eng === 'swing') return { borderColor: isDark ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.4)', color: isDark ? '#C4B5FD' : '#6D28D9', background: isDark ? 'rgba(76,29,149,0.18)' : 'rgba(237,233,254,0.7)' }
  return                      { borderColor: isDark ? 'rgba(20,184,166,0.3)' : 'rgba(20,184,166,0.4)', color: isDark ? '#5EEAD4' : '#0F766E', background: isDark ? 'rgba(19,78,74,0.18)' : 'rgba(204,251,241,0.7)' }
}

function engineBorderAccent(eng: string): string {
  if (eng === 'day')   return '#F97316'
  if (eng === 'swing') return '#8B5CF6'
  return '#14B8A6'
}

function verdictAccentColor(tone: string): string {
  if (tone === 'bullish') return '#10B981'
  if (tone === 'warning') return '#F59E0B'
  if (tone === 'bearish') return '#EF4444'
  return '#6B7280'
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navForRec(rec: TccRec): string {
  return getDetailsRoute(rec.detail_route_key, rec.ticker)
}

function useRecNavigate() {
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()
  return (rec: TccRec) => {
    if (rec.detail_route_key === 'regular') {
      requestAnalysis(rec.ticker)
      navigate(navForRec(rec))
    } else {
      navigate(navForRec(rec))
    }
  }
}

// ── Sub-indicators ────────────────────────────────────────────────────────────
function SubIndicators({ indicators, C }: { indicators: TccRec['sub_indicators']; C: Palette }) {
  if (!indicators || indicators.length === 0) return null
  return (
    <div style={{ borderTop: `1px solid ${C.borderFaint}`, marginTop: 10, paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {indicators.map((ind, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted }}>{ind.label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            color: ind.tone === 'bullish' ? '#10B981' : ind.tone === 'bearish' ? '#EF4444' : ind.tone === 'warning' ? '#F59E0B' : C.textMuted,
          }}>{ind.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Market Position Widget ────────────────────────────────────────────────────
function MarketPositionWidget({ C, isDark }: { C: Palette; isDark: boolean }) {
  const [mpData, setMpData] = useState<MarketPositionData | null>(null)
  const [mpLoading, setMpLoading] = useState(true)
  const [mpError, setMpError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarketPosition()
      .then(env => {
        if (env.error) setMpError((env.error as { message?: string }).message ?? 'Error')
        else if (env.data) setMpData(env.data)
        else setMpError('No data')
      })
      .catch(err => setMpError(axiosErrorMessage(err)))
      .finally(() => setMpLoading(false))
  }, [])

  if (mpLoading) {
    return (
      <div style={{ marginTop: 16, borderTop: `1px solid ${C.borderFaint}`, paddingTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.textMuted }}>
        <RefreshCw size={11} className="animate-spin" /> Loading market position…
      </div>
    )
  }
  if (mpError || !mpData) {
    return <div style={{ marginTop: 16, borderTop: `1px solid ${C.borderFaint}`, paddingTop: 16, fontSize: 12, color: C.textMuted }}>Market position unavailable</div>
  }

  const tone = mpData.signal_tone
  const signalStyle: React.CSSProperties =
    tone === 'green'  ? { background: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.1)', color: isDark ? '#6EE7B7' : '#065F46', border: '1px solid rgba(16,185,129,0.35)' } :
    tone === 'red'    ? { background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.09)', color: isDark ? '#FCA5A5' : '#991B1B', border: '1px solid rgba(239,68,68,0.3)' } :
    tone === 'orange' ? { background: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.1)', color: isDark ? '#FCD34D' : '#92400E', border: '1px solid rgba(245,158,11,0.35)' } :
                        { background: isDark ? 'rgba(71,85,105,0.4)' : 'rgba(107,114,128,0.1)', color: C.textMuted, border: `1px solid ${C.border}` }
  const dotColor = tone === 'green' ? '#10B981' : tone === 'red' ? '#EF4444' : tone === 'orange' ? '#F59E0B' : C.textMuted
  const maBarPct = Math.min(100, Math.max(2, ((mpData.dist_200ma_pct + 5) / 20) * 100))
  const ddBarPct = Math.min(100, Math.max(2, (mpData.drawdown_pct / 25) * 100))
  const maBarColor = mpData.dist_200ma_pct >= 10 ? '#EF4444' : mpData.dist_200ma_pct < 0 ? '#F59E0B' : '#38BDF8'
  const ddBarColor = mpData.drawdown_pct >= 8 ? '#10B981' : C.textFaint

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.borderFaint}`, paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>
          <TrendingUp size={11} color="#8B5CF6" aria-hidden />
          Portfolio Reserve Signal
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'monospace' }}>
          <span style={{ color: C.textMuted }}>SPY</span>
          <span style={{ fontWeight: 700, color: C.text }}>${mpData.spy_price.toFixed(2)}</span>
          <span style={{ fontSize: 10, color: C.textFaint }}>|</span>
          <span style={{ fontSize: 10, color: C.textMuted }}>200-MA ${mpData.ma200.toFixed(0)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'vs 200-day MA', pct: maBarPct, barColor: maBarColor, val: `${mpData.dist_200ma_pct >= 0 ? '+' : ''}${mpData.dist_200ma_pct.toFixed(1)}%`, valColor: '#38BDF8' },
          { label: 'Off 52w High',  pct: ddBarPct, barColor: ddBarColor, val: `-${mpData.drawdown_pct.toFixed(1)}%`, valColor: '#10B981' },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 96, flexShrink: 0, fontWeight: 600, color: C.textMuted }}>{row.label}</span>
            <div style={{ flex: 1, height: 6, borderRadius: 9999, overflow: 'hidden', background: isDark ? 'rgba(71,85,105,0.3)' : '#E5E7EB' }}>
              <div style={{ height: '100%', borderRadius: 9999, background: row.barColor, width: `${row.pct}%` }} />
            </div>
            <span style={{ width: 56, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: row.valColor }}>{row.val}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, padding: '8px 12px', ...signalStyle }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: dotColor }} aria-hidden />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>{mpData.signal_label}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap' }}>25% reserve rule</span>
      </div>
    </div>
  )
}

// ── Rec Card (shared between Ready + Watch sections) ──────────────────────────
function RecCard({ rec, C, isDark, onPress }: { rec: TccRec; C: Palette; isDark: boolean; onPress: () => void }) {
  const eng  = rec.detail_route_key
  const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
  const chgPct = rec.price_change_pct
  const chgColor = chgPct != null ? (chgPct >= 0 ? '#10B981' : '#EF4444') : C.textMuted
  const accentColor = verdictAccentColor(rec.verdict_tone)
  const chipStyle = engineChipStyle(eng, isDark)

  return (
    <button
      type="button"
      onClick={onPress}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 12,
        padding: '14px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, transform 0.15s',
        width: '100%',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.transform = 'none' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: C.text }}>{rec.ticker}</span>
          <span style={{ border: '1px solid', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...chipStyle }}>{eng.toUpperCase()}</span>
        </div>
        <span style={{ borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', ...verdictBadgeStyle(rec.verdict_tone, isDark) }}>{rec.verdict_label}</span>
      </div>

      {/* Price row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {chgPct != null && (
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: chgColor }}>
            {chgPct >= 0 ? '▲' : '▼'} {Math.abs(chgPct).toFixed(1)}%
          </span>
        )}
        {rec.last_price != null && (
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.textMuted }}>${rec.last_price.toFixed(2)}</span>
        )}
        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 'auto', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.strategy || rec.direction || ''}</span>
      </div>

      {/* Entry / Target / Stop */}
      {(rec.entry_zone || rec.target || rec.stop_loss) && (
        <>
          <div style={{ borderTop: `1px solid ${C.borderFaint}`, marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 11, marginBottom: 8 }}>
            {[
              { label: 'Entry',  val: rec.entry_zone || '—', color: C.textSub },
              { label: 'Target', val: rec.target || '—',     color: '#10B981' },
              { label: 'Stop',   val: rec.stop_loss || '—',  color: '#EF4444' },
            ].map(col => (
              <div key={col.label}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, marginBottom: 2 }}>{col.label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: col.color }}>{col.val}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Confidence */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: conf >= 70 ? '#10B981' : '#38BDF8' }}>{conf}%</span>
      </div>
      <SubIndicators indicators={rec.sub_indicators} C={C} />
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TradeCommandCenter() {
  const { canAccessPage, theme } = useApp()
  const isDark = theme !== 'light'
  const C = isDark ? C_DARK : C_LIGHT
  const goToRec = useRecNavigate()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const [env, setEnv] = useState<ApiEnvelope<TradeCommandCenterPayload> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'warning' | 'info'; text: string } | null>(null)

  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setFetchError(null)
    try {
      const nextEnv = await fetchTradeCommandCenter({})
      if (seq !== loadSeqRef.current) return
      setEnv(nextEnv)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setEnv(null)
      setFetchError(axiosErrorMessage(err))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const payload = env?.data ?? null
  const market  = payload?.market_summary ?? {}

  const sections     = payload?.tcc_sections
  const topByEngine  = sections?.top_by_engine ?? { day: null, swing: null, regular: null }
  const readyNow     = sections?.ready_now ?? []
  const highConfWatch = sections?.high_conf_watch ?? []
  const lowSignals   = sections?.low_signals ?? []

  const engineOrder = (['day', 'swing', 'regular'] as const).filter(e => {
    if (e === 'day')   return canDay
    if (e === 'swing') return canSwing
    return true
  })

  const noticeStyle: React.CSSProperties =
    actionNotice?.tone === 'success'
      ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.08)', color: isDark ? '#6EE7B7' : '#065F46' }
      : actionNotice?.tone === 'warning'
        ? { borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', color: isDark ? '#FCD34D' : '#92400E' }
        : { borderColor: 'rgba(56,189,248,0.4)', background: 'rgba(56,189,248,0.08)', color: isDark ? '#7DD3FC' : '#0369A1' }

  return (
    <div style={{ background: C.page, minHeight: '100vh' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 112px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Command size={15} color="#8B5CF6" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.2, margin: 0 }}>Trade Command Center</h1>
              <p style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.2, margin: 0 }}>What to trade today</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn btn-outline"
            style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ── Notice ── */}
        {actionNotice ? (
          <div style={{ borderRadius: 12, border: '1px solid', padding: '12px 16px', fontSize: 14, ...noticeStyle }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontWeight: 500 }}>{actionNotice.text}</span>
              <button type="button" style={{ fontSize: 12, fontWeight: 600, opacity: 0.8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setActionNotice(null)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Loading / Errors ── */}
        {loading && !env ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, padding: '24px 16px', fontSize: 14, color: C.textMuted }}>
            <RefreshCw size={16} className="animate-spin" color="#8B5CF6" />
            Loading…
          </div>
        ) : null}
        {fetchError ? (
          <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', padding: '12px 16px', fontSize: 14, color: isDark ? '#FCA5A5' : '#991B1B' }}>{fetchError}</div>
        ) : null}
        {env?.error ? (
          <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', padding: '12px 16px', fontSize: 14, color: isDark ? '#FCA5A5' : '#991B1B' }}>{(env.error as { message?: string }).message ?? 'Error'}</div>
        ) : null}

        {payload ? (
          <>
            {/* ── Market Pulse Strip ── */}
            <section style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, padding: '10px 14px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 16px', fontSize: 12 }}>
                {[
                  { label: 'SPY', val: String(market.spy_trend ?? '—').toUpperCase(), bullish: String(market.spy_trend ?? '').toLowerCase().includes('bull'), bearish: String(market.spy_trend ?? '').toLowerCase().includes('bear') },
                  { label: 'QQQ', val: String(market.qqq_trend ?? '—').toUpperCase(), bullish: String(market.qqq_trend ?? '').toLowerCase().includes('bull'), bearish: String(market.qqq_trend ?? '').toLowerCase().includes('bear') },
                ].map(item => (
                  <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, color: C.textMuted }}>{item.label}</span>
                    <span style={{ fontWeight: 700, color: item.bullish ? '#10B981' : item.bearish ? '#EF4444' : C.textSub }}>{item.val}</span>
                  </span>
                ))}
                <span style={{ color: C.textFaint }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, color: C.textMuted }}>VIX</span>
                  <span style={{ fontWeight: 700, color: String(market.vix_risk ?? '').toLowerCase().includes('high') ? '#EF4444' : '#10B981' }}>{String(market.vix_risk ?? '—').toUpperCase()}</span>
                </span>
                <span style={{ color: C.textFaint }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, color: C.textMuted }}>Regime</span>
                  <span style={{ fontWeight: 700, color: '#8B5CF6' }}>{String(market.market_mode ?? '—').toUpperCase()}</span>
                </span>
                <span style={{ color: C.textFaint }}>·</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, color: C.textMuted }}>Best</span>
                  <span style={{ fontWeight: 700, color: C.textSub }}>{String(market.best_style_today ?? '—')}</span>
                </span>
                <span style={{ color: C.textFaint }}>·</span>
                <span style={{ fontWeight: 600, color: '#10B981' }}>{readyNow.length} ready</span>
                <span style={{ fontWeight: 600, color: '#F59E0B' }}>{highConfWatch.length} watching</span>
                {env?.fetched_at ? (
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={9} />
                    {new Date(env.fetched_at).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
            </section>

            {/* ── Today's Overall Verdict ── */}
            {payload.overall_decision && (() => {
              const od = payload.overall_decision as OverallDecision
              const v = String(od.verdict || '').toUpperCase().replace(/ /g, '_')
              const tone =
                v === 'STRONG_GO' ? 'bullish' :
                v === 'GO'        ? 'bullish' :
                v === 'WATCH'     ? 'warning' :
                v === 'AVOID'     ? 'bearish' : 'neutral'
              const bannerStyle: React.CSSProperties =
                tone === 'bullish' ? { border: '1px solid rgba(16,185,129,0.35)', background: isDark ? 'rgba(16,185,129,0.07)' : 'rgba(16,185,129,0.06)' } :
                tone === 'warning' ? { border: '1px solid rgba(245,158,11,0.3)', background: isDark ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.05)' } :
                tone === 'bearish' ? { border: '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.05)' } :
                                     { border: `1px solid ${C.border}`, background: C.card }
              const reasonDot = verdictAccentColor(tone)

              return (
                <section style={{ borderRadius: 16, padding: 16, ...bannerStyle }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                    <span style={{ borderRadius: 8, padding: '4px 12px', fontSize: 14, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em', ...verdictBadgeStyle(tone, isDark) }}>{v.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{od.label}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.textMuted }}>{od.confidence}% conf.</span>
                    {od.engines_agreeing.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        <span style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Aligned:</span>
                        {od.engines_agreeing.map(e => (
                          <span key={e} style={{ border: '1px solid', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...engineChipStyle(e, isDark) }}>{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ marginTop: 5, width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: reasonDot }} />
                    <p style={{ fontSize: 12, lineHeight: 1.6, color: C.textSub, margin: 0 }}>{od.reason}</p>
                  </div>
                  <p style={{ fontSize: 10, color: C.textFaint, margin: '6px 0 0', fontStyle: 'italic' }}>
                    GO = ready to trade · WATCH = setup forming, not yet triggered · AVOID = hard failure, stand aside
                  </p>
                </section>
              )
            })()}

            {/* ── Engine Overview: Best Pick Per Engine ── */}
            {engineOrder.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(engineOrder.length, 3)}, 1fr)`, gap: 12 }}
                className="tcc-engine-grid">
                {engineOrder.map(engKey => {
                  const top       = topByEngine[engKey]
                  const label     = engKey === 'day' ? 'Day Trade' : engKey === 'swing' ? 'Swing Trade' : 'Options'
                  const timeframe = engKey === 'day' ? 'Intraday' : engKey === 'swing' ? '5–21 days' : 'Multi-leg'
                  const chipStyle = engineChipStyle(engKey, isDark)
                  const accent    = engineBorderAccent(engKey)

                  if (!top) {
                    return (
                      <div key={engKey} style={{ borderRadius: 12, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.textFaint}`, background: C.card, padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ border: '1px solid', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...chipStyle }}>{engKey.toUpperCase()}</span>
                          <span style={{ fontSize: 10, color: C.textMuted }}>{timeframe}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted }}>No setup</div>
                        <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>{label} has no actionable signals</div>
                      </div>
                    )
                  }

                  const conf = top.display_confidence ?? (typeof top.confidence === 'number' ? top.confidence : 0)

                  return (
                    <button
                      key={engKey}
                      type="button"
                      onClick={() => goToRec(top)}
                      style={{
                        borderRadius: 12, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`,
                        background: C.card, padding: 16, textAlign: 'left', cursor: 'pointer',
                        transition: 'box-shadow 0.15s, transform 0.15s', width: '100%',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.transform = 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ border: '1px solid', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...chipStyle }}>{engKey.toUpperCase()}</span>
                          <span style={{ fontSize: 10, color: C.textMuted }}>{timeframe}</span>
                        </div>
                        <span style={{ borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', ...verdictBadgeStyle(top.verdict_tone, isDark) }}>{top.verdict_label}</span>
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>{top.ticker}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 12 }}>{top.strategy || top.direction || label}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Confidence</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: conf >= 70 ? '#10B981' : conf >= 50 ? '#F59E0B' : C.textMuted }}>{conf}%</div>
                      </div>
                      <SubIndicators indicators={top.sub_indicators} C={C} />
                    </button>
                  )
                })}
              </div>
            )}

            {/* ── Ready to Act: STRONG_GO + GO ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.borderFaint}`, paddingBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10B981' }} className="animate-pulse" />
                <h2 style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Ready to Act</h2>
                <span style={{ borderRadius: 9999, background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '1px 8px', fontSize: 10, fontWeight: 700, color: '#10B981' }}>{readyNow.length}</span>
                <span style={{ fontSize: 10, color: C.textMuted }}>Strong Go + Go · sorted by confidence</span>
              </div>

              {readyNow.length === 0 ? (
                <div style={{ borderRadius: 12, border: `1px dashed ${C.border}`, padding: '32px 16px', textAlign: 'center', fontSize: 14, color: C.textMuted }}>
                  No strong setups right now — check Watch list below
                </div>
              ) : (
                <div className="tcc-card-grid">
                  {readyNow.map(rec => (
                    <RecCard key={rec.id} rec={rec} C={C} isDark={isDark} onPress={() => goToRec(rec)} />
                  ))}
                </div>
              )}
            </section>

            {/* ── Watch: high-confidence WATCH setups ── */}
            {highConfWatch.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.borderFaint}`, paddingBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B' }} />
                  <h2 style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Watch — Entry Developing</h2>
                  <span style={{ borderRadius: 9999, background: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 8px', fontSize: 10, fontWeight: 700, color: '#F59E0B' }}>{highConfWatch.length}</span>
                  <span style={{ fontSize: 10, color: C.textMuted }}>not yet triggered</span>
                </div>
                <div className="tcc-card-grid">
                  {highConfWatch.map(rec => (
                    <RecCard key={rec.id} rec={rec} C={C} isDark={isDark} onPress={() => goToRec(rec)} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Monitoring: lower signals — grouped by ticker ── */}
            {lowSignals.length > 0 && (() => {
              // Group by ticker, sort alphabetically
              const byTicker = new Map<string, TccRec[]>()
              ;[...lowSignals]
                .sort((a, b) => a.ticker.localeCompare(b.ticker))
                .forEach(rec => {
                  const g = byTicker.get(rec.ticker) ?? []
                  g.push(rec)
                  byTicker.set(rec.ticker, g)
                })
              const groups = [...byTicker.entries()]

              return (
                <details className="group" style={{ borderRadius: 12 }}>
                  <summary style={{
                    display: 'flex', cursor: 'pointer', listStyle: 'none', alignItems: 'center', gap: 8,
                    border: `1px solid ${C.border}`, background: C.card, borderRadius: 12,
                    padding: '10px 16px', fontSize: 12, color: C.textSub, userSelect: 'none',
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.textFaint }} />
                    <span style={{ fontWeight: 600 }}>Monitoring</span>
                    <span style={{
                      background: isDark ? 'rgba(71,85,105,0.4)' : 'rgba(107,114,128,0.1)',
                      border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '0 6px', fontSize: 10, fontWeight: 700, color: C.textMuted,
                    }}>{groups.length} tickers · {lowSignals.length} signals</span>
                    <span style={{ color: C.textMuted, fontSize: 11 }}>Wait + lower-confidence Watch · sorted A→Z</span>
                    <ChevronDown size={12} color={C.textMuted} style={{ marginLeft: 'auto' }} className="group-open:rotate-180 transition-transform" />
                  </summary>

                  <div style={{
                    border: `1px solid ${C.border}`, borderTop: 'none',
                    borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
                    background: C.card, padding: '12px 14px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 10,
                  }}>
                    {groups.map(([ticker, recs]) => {
                      // Best verdict across all engines for this ticker
                      const bestRec = recs.reduce((best, r) => r.verdict_rank > best.verdict_rank ? r : best, recs[0])
                      const chgPct = bestRec.price_change_pct
                      const chgColor = chgPct != null ? (chgPct >= 0 ? '#10B981' : '#EF4444') : C.textMuted

                      return (
                        <div
                          key={ticker}
                          style={{
                            borderRadius: 10,
                            border: `1px solid ${C.border}`,
                            borderLeft: `3px solid ${verdictAccentColor(bestRec.verdict_tone)}`,
                            background: isDark ? 'rgba(15,23,42,0.6)' : '#FAFAFA',
                            overflow: 'hidden',
                          }}
                        >
                          {/* Ticker header */}
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderBottom: `1px solid ${C.borderFaint}`,
                            gap: 8,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
                                {ticker}
                              </span>
                              {bestRec.last_price != null && (
                                <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.textMuted }}>
                                  ${bestRec.last_price.toFixed(2)}
                                </span>
                              )}
                            </div>
                            {chgPct != null && (
                              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: chgColor, whiteSpace: 'nowrap' }}>
                                {chgPct >= 0 ? '▲' : '▼'} {Math.abs(chgPct).toFixed(1)}%
                              </span>
                            )}
                          </div>

                          {/* Engine rows */}
                          {recs.map(rec => {
                            const eng = rec.detail_route_key
                            const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                            const chipStyle = engineChipStyle(eng, isDark)
                            const badgeStyle = verdictBadgeStyle(rec.verdict_tone, isDark)
                            const signalLine = rec.execution_timing || rec.signal_quality || rec.reason || rec.strategy || ''
                            const dirLine = rec.direction || rec.strategy || ''

                            return (
                              <button
                                key={rec.id}
                                type="button"
                                onClick={() => goToRec(rec)}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  padding: '8px 12px', cursor: 'pointer', background: 'transparent',
                                  borderBottom: `1px solid ${C.borderFaint}`,
                                  transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.cardHover}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                              >
                                {/* Top row: engine chip + verdict + confidence */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <span style={{
                                    border: '1px solid', borderRadius: 4, padding: '1px 5px',
                                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...chipStyle,
                                  }}>{eng === 'regular' ? 'REG' : eng.toUpperCase()}</span>
                                  <span style={{
                                    borderRadius: 4, padding: '1px 6px',
                                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', ...badgeStyle,
                                  }}>{rec.verdict_label}</span>
                                  <span style={{
                                    marginLeft: 'auto', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                                    color: conf >= 70 ? '#10B981' : conf >= 50 ? '#F59E0B' : C.textMuted,
                                  }}>{conf}%</span>
                                </div>

                                {/* Direction / strategy */}
                                {dirLine && (
                                  <div style={{ fontSize: 10, color: C.textSub, marginBottom: 2, fontWeight: 600 }}>
                                    {dirLine}
                                  </div>
                                )}

                                {/* Signal / reason line */}
                                {signalLine && (
                                  <div style={{
                                    fontSize: 10, color: C.textMuted,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    maxWidth: '100%',
                                  }} title={signalLine}>
                                    {signalLine}
                                  </div>
                                )}

                                {/* Entry / Target / Stop — only if available */}
                                {(rec.entry_zone || rec.target || rec.stop_loss) && (
                                  <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10, fontFamily: 'monospace' }}>
                                    {rec.entry_zone && (
                                      <span style={{ color: C.textSub }}>
                                        <span style={{ fontSize: 9, color: C.textMuted }}>Entry </span>{rec.entry_zone}
                                      </span>
                                    )}
                                    {rec.target && (
                                      <span style={{ color: '#10B981' }}>
                                        <span style={{ fontSize: 9, color: C.textMuted }}>T </span>{rec.target}
                                      </span>
                                    )}
                                    {rec.stop_loss && (
                                      <span style={{ color: '#EF4444' }}>
                                        <span style={{ fontSize: 9, color: C.textMuted }}>S </span>{rec.stop_loss}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </button>
                            )
                          })}

                          {/* Footer: expiry / risk level from best rec */}
                          {(bestRec.expiry || bestRec.risk_level || bestRec.risk_category) && (
                            <div style={{
                              display: 'flex', gap: 10, padding: '5px 12px',
                              fontSize: 9, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                              {bestRec.expiry && <span>Exp {bestRec.expiry}</span>}
                              {(bestRec.risk_level || bestRec.risk_category) && (
                                <span style={{ color: bestRec.risk_level === 'HIGH' || bestRec.risk_category === 'HIGH' ? '#EF4444' : C.textFaint }}>
                                  {bestRec.risk_level || bestRec.risk_category} RISK
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.borderFaint}`, display: 'flex', justifyContent: 'flex-end' }}>
                    <Link to="/signal-feed" style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6', textDecoration: 'none' }}>
                      View all in Signal Feed →
                    </Link>
                  </div>
                </details>
              )
            })()}

          </>
        ) : null}
      </div>
    </div>
  )
}
