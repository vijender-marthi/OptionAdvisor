import React, { useState, useEffect, useRef } from 'react'
import { Search, Database, Layers, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { analyzeOptions, analyzeV2 } from '../api/client'
import type { AnalyzeResponse, StrategyMode, TickerCacheEntry, UnifiedAnalysis } from '../api/client'
import { isCacheFresh, cacheAge } from '../types'
import TickerInput from '../components/TickerInput'
import MarketOverview from '../components/MarketOverview'
import SignalPanel from '../components/SignalPanel'
import PriceChart from '../components/PriceChart'
import OptionProfitCalculator from '../components/OptionProfitCalculator'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'
import { OA_LAST_OPTION_ANALYSIS_KEY } from '../constants/storageKeys'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  violet:    '#7C5CFC',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
  purple:    '#6B7FD4',
  text:      '#E8EBF0',
}

const VALID_SAVED_WEEKS = new Set<number>(MULTI_WEEK_TARGETS as readonly number[])

interface LastAnalysisRequest {
  ticker: string
  weeksOut: number
  spreadWidth: number | null
  strategyMode: StrategyMode
  chainExpiry?: string | null
}

function analyzeErrorDetail(e: unknown): string {
  return (
    (e as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail ??
    (e as { message?: string })?.message ??
    'Something went wrong'
  )
}

function normalizeLastAnalysisRequest(raw: unknown): LastAnalysisRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<LastAnalysisRequest>
  const ticker = typeof value.ticker === 'string' ? value.ticker.trim().toUpperCase() : ''
  const weeksOut = Number(value.weeksOut)
  const strategyMode = value.strategyMode ?? 'all'
  if (!ticker || !Number.isFinite(weeksOut) || !VALID_SAVED_WEEKS.has(weeksOut)) return null
  if (!['all', 'long_only', 'credit_only', 'short_or_covered', 'straddle_only'].includes(strategyMode)) return null
  let chainExpiry: string | undefined
  const ceRaw = value.chainExpiry
  if (typeof ceRaw === 'string' && ceRaw.trim()) {
    const ce = ceRaw.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(ce)) chainExpiry = ce
  }
  return {
    ticker,
    weeksOut,
    spreadWidth: value.spreadWidth ?? null,
    strategyMode,
    ...(chainExpiry ? { chainExpiry } : {}),
  }
}

function loadLastAnalysisRequest(): LastAnalysisRequest | null {
  try {
    return normalizeLastAnalysisRequest(JSON.parse(localStorage.getItem(OA_LAST_OPTION_ANALYSIS_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function saveLastAnalysisRequest(request: LastAnalysisRequest) {
  try {
    localStorage.setItem(OA_LAST_OPTION_ANALYSIS_KEY, JSON.stringify(request))
  } catch { /* ignore storage failures */ }
}

// ─── Week selector helpers ─────────────────────────────────────────────────

function bestVerdict(vs: Verdict[]): Verdict | null {
  if (vs.includes('GO'))      return 'GO'
  if (vs.includes('CAUTION')) return 'CAUTION'
  if (vs.includes('NO GO'))   return 'NO GO'
  return null
}

const scoreColor = (s: number) =>
  s >= 75 ? '#00E5A0' : s >= 55 ? '#F5A623' : '#FF4D6D'

const C_VERDICT = {
  enter: { label: 'ENTER NOW', color: '#00E5A0', bg: 'rgba(0,229,160,0.06)' },
  watch: { label: 'WATCH',     color: '#F5A623', bg: 'rgba(245,166,35,0.06)' },
  wait:  { label: 'WAIT',      color: '#6B7FD4', bg: 'rgba(107,127,212,0.06)' },
  avoid: { label: 'AVOID',     color: '#FF4D6D', bg: 'rgba(255,77,109,0.06)' },
}

function RegularVerdictCard({ analysis }: { analysis: UnifiedAnalysis }) {
  const v = C_VERDICT[analysis.verdict] ?? C_VERDICT.wait
  return (
    <div style={{ background: v.bg, border: `1px solid ${v.color}40`, borderRadius: 14, borderTop: `3px solid ${v.color}`, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontFamily: "'Syne', 'Inter', system-ui, sans-serif", fontSize: '2.8rem', fontWeight: 800, color: v.color, letterSpacing: '-0.02em', lineHeight: 1, textTransform: 'uppercase' }}>{v.label}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 700, color: v.color }}>{analysis.confidence}</div>
          <div style={{ fontSize: '0.6rem', color: '#5A6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>CONF</div>
        </div>
      </div>
      <div style={{ fontSize: '0.88rem', color: '#E8EBF0', opacity: 0.85, lineHeight: 1.6, marginBottom: 12 }}>{analysis.reason}</div>
      {analysis.conditions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 4 }}>
          {analysis.conditions.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borderSub}`, color: c.type === 'pass' ? '#E8EBF0' : c.type === 'warn' ? '#F5A623' : '#FF4D6D' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.type === 'pass' ? '#00E5A0' : c.type === 'warn' ? '#F5A623' : '#FF4D6D', flexShrink: 0 }} />
              {c.label}
            </span>
          ))}
        </div>
      )}

      {analysis.structure && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: '#5A6478' }}>Best structure: <span style={{ color: '#E8EBF0', fontWeight: 600 }}>{analysis.structure}</span></span>
          {analysis.rr_ratio && <span style={{ fontSize: '0.75rem', color: '#5A6478' }}>R/R: <span style={{ color: '#00E5A0', fontWeight: 600, fontFamily: 'monospace' }}>{analysis.rr_ratio}</span></span>}
        </div>
      )}
    </div>
  )
}

const VERDICT_DOT_COLOR: Record<Verdict, string> = {
  'GO':      C.green,
  'CAUTION': C.amber,
  'NO GO':   C.red,
}
const VERDICT_ICON: Record<Verdict, React.ReactNode> = {
  'GO':      <CheckCircle2 size={11} style={{ color: C.green }} />,
  'CAUTION': <AlertTriangle size={11} style={{ color: C.amber }} />,
  'NO GO':   <XCircle size={11} style={{ color: C.red }} />,
}
const VERDICT_TEXT_COLOR: Record<Verdict, string> = {
  'GO':      C.green,
  'CAUTION': C.amber,
  'NO GO':   C.red,
}

interface WeekSlot {
  weeksOut: number
  label: string
  dte: number | null
  verdict: Verdict | null
  recCount: number
  hasData: boolean
}

function buildWeekSlots(entry: TickerCacheEntry): WeekSlot[] {
  const slots = new Map<string, WeekSlot>()

  if (entry.data.recommendations.length > 0) {
    const dte = entry.data.recommendations[0].dte
    const label = `${entry.weeksOut}w`
    const verdicts = entry.data.recommendations.map(r =>
      deriveVerdict(buildChecklist(r, entry.data.signals))
    )
    slots.set(label, { weeksOut: entry.weeksOut, label, dte, verdict: bestVerdict(verdicts), recCount: verdicts.length, hasData: true })
  } else {
    slots.set(`${entry.weeksOut}w`, { weeksOut: entry.weeksOut, label: `${entry.weeksOut}w`, dte: null, verdict: null, recCount: 0, hasData: true })
  }

  if (entry.multiWeekData) {
    for (const [weeksOut, mdata] of Object.entries(entry.multiWeekData)) {
      const d = mdata as AnalyzeResponse
      const dte = d.recommendations[0]?.dte ?? null
      const label = `${weeksOut}w`
      if (slots.has(label)) continue
      const verdicts = d.recommendations.map(r => deriveVerdict(buildChecklist(r, d.signals)))
      slots.set(label, { weeksOut: Number(weeksOut), label, dte, verdict: bestVerdict(verdicts), recCount: verdicts.length, hasData: true })
    }
  }

  return MULTI_WEEK_TARGETS.map(w => {
    const label = `${w}w`
    return slots.get(label) ?? { weeksOut: w, label, dte: null, verdict: null, recCount: 0, hasData: false }
  })
}

function WeekSelector({ entry, selectedWeeksOut, onSelect, onFetch, fetching, loadingWeeks }: {
  entry: TickerCacheEntry
  selectedWeeksOut: number
  onSelect: (weeksOut: number) => void
  onFetch: () => void
  fetching: boolean
  loadingWeeks: Set<number>
}) {
  const slots = buildWeekSlots(entry)
  const hasFetched = !!entry.multiWeekData
  const goCount = slots.filter(s => s.verdict === 'GO').length
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null)

  return (
    <div style={{
      background: C.bgPanel,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '8px 12px',
      marginTop: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, flexShrink: 0,
        }}>
          Week
        </span>
        {goCount > 0 && (
          <span style={{
            background: 'rgba(0,229,160,0.1)', border: `1px solid rgba(0,229,160,0.2)`,
            color: C.green, fontSize: '0.55rem', fontWeight: 700,
            borderRadius: 20, padding: '1px 6px', flexShrink: 0,
          }}>
            {goCount}
          </span>
        )}

        {/* Slots */}
        <div style={{ display: 'flex', gap: 4, flex: 1, overflowX: 'auto' }}>
          {slots.map(slot => {
            const active = selectedWeeksOut === slot.weeksOut
            const isLoading = loadingWeeks.has(slot.weeksOut)
            const dotColor = isLoading
              ? C.violet
              : slot.verdict
              ? VERDICT_DOT_COLOR[slot.verdict]
              : slot.hasData ? C.muted : C.borderSub

            return (
              <button
                key={slot.label}
                type="button"
                onClick={() => onSelect(slot.weeksOut)}
                disabled={isLoading}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: `1px solid ${active ? C.accent : C.borderSub}`,
                  background: active ? 'rgba(74,124,255,0.1)' : isLoading ? 'rgba(124,92,252,0.05)' : 'transparent',
                  cursor: isLoading ? 'wait' : 'pointer',
                  opacity: !slot.hasData && !isLoading ? 0.4 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  flexShrink: 0,
                }}
              >
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                  animation: isLoading ? 'tdPulse 1.5s infinite' : undefined,
                }} />
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace',
                  color: active ? '#fff' : C.muted,
                }}>
                  {slot.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Fetch all weeks button */}
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching}
          aria-label={fetching ? 'Fetching all weeks' : hasFetched ? 'Re-fetch all expiry weeks' : 'Load all expiry weeks'}
          title={fetching ? 'Fetching…' : hasFetched ? 'Re-fetch all weeks' : 'Load all weeks (2w–6w)'}
          style={{
            background: C.violet,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: fetching ? 'wait' : 'pointer',
            opacity: fetching ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <Layers size={14} style={{ animation: fetching ? 'tdPulse 1.5s infinite' : undefined }} />
          {hasFetched ? 'Refresh' : 'All Weeks'}
        </button>
      </div>
      <style>{`@keyframes tdPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function TickerPage() {
  const {
    pendingTicker, pendingAnalysisOptions, clearPendingTicker,
    getCached, setCached, tickerCache,
    fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
  } = useApp()

  const [data,          setData]          = useState<AnalyzeResponse | null>(null)
  const [unifiedAnalysis, setUnifiedAnalysis] = useState<UnifiedAnalysis | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'chart' | 'calculator' | null>(null)
  const [fromCache,     setFromCache]     = useState<{ age: number; fresh: boolean } | null>(null)
  const [staleSnapshotInfo, setStaleSnapshotInfo] = useState<{ cachedAt: number; errorDetail: string } | null>(null)
  const [lastWeeks,     setLastWeeks]     = useState(4)
  const [lastWidth,     setLastWidth]     = useState<number | null>(5)
  const [lastMode,      setLastMode]      = useState<StrategyMode>('all')
  const [lastChainExpiry, setLastChainExpiry] = useState<string | null>(null)
  const [inputTicker,   setInputTicker]   = useState('')
  const [selectedWeeksOut, setSelectedWeeksOut] = useState(4)
  const [staleBannerOpen, setStaleBannerOpen] = useState(false)
  const [yahooBannerOpen, setYahooBannerOpen] = useState(false)

  const didRun = useRef(false)
  const didRestoreLastAnalysis = useRef(false)
  const pendingRecFocusRef = useRef<{ strategy: string; expiry: string } | null>(null)
  const [scrollFocusRank, setScrollFocusRank] = useState<number | null>(null)

  const handleAnalyze = async (
    ticker: string,
    weeksOut = 4,
    spreadWidth: number | null = 5,
    strategyMode: StrategyMode = 'all',
    chainExpiry: string | null = null,
  ) => {
    setInputTicker(ticker.trim().toUpperCase())
    const tickerUpper = ticker.trim().toUpperCase()
    setLoading(true)
    setError(null)
    setStaleSnapshotInfo(null)
    setFromCache(null)
    setLastWeeks(weeksOut)
    setLastWidth(spreadWidth)
    setLastMode(strategyMode)
    setSelectedWeeksOut(weeksOut)
    const ceRaw = chainExpiry?.trim().slice(0, 10) ?? null
    const ceKey = ceRaw && /^\d{4}-\d{2}-\d{2}$/.test(ceRaw) ? ceRaw : null
    setLastChainExpiry(ceKey)
    const saveReq = {
      ticker: tickerUpper, weeksOut, spreadWidth, strategyMode,
      ...(ceKey ? { chainExpiry: ceKey } : {}),
    }
    saveLastAnalysisRequest(saveReq)
    try {
      const result = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode, ceKey)
      setData(result)
      setActiveTab('chart')
      setCached(ticker, result, weeksOut, spreadWidth, strategyMode, ceKey)
      try {
        const v2res = await analyzeV2(ticker, 'regular', {
          weeksOut,
          spreadWidth: spreadWidth ?? 5,
          strategyMode,
        })
        setUnifiedAnalysis(v2res.data)
      } catch { /* non-fatal: verdict card will not show */ }
    } catch (e: unknown) {
      const msg = analyzeErrorDetail(e)
      const cached = getCached(tickerUpper)
      if (cached?.data) {
        setData(cached.data)
        setActiveTab('chart')
        setLastWeeks(cached.weeksOut)
        setLastWidth(cached.spreadWidth)
        setLastMode(cached.strategyMode ?? 'all')
        setSelectedWeeksOut(cached.weeksOut)
        setLastChainExpiry(cached.chainExpiry ?? null)
        setFromCache({ age: cacheAge(cached), fresh: false })
        setStaleSnapshotInfo({ cachedAt: cached.timestamp, errorDetail: msg })
        setError(null)
        saveLastAnalysisRequest({
          ticker: tickerUpper,
          weeksOut: cached.weeksOut,
          spreadWidth: cached.spreadWidth,
          strategyMode: cached.strategyMode ?? 'all',
          ...(cached.chainExpiry ? { chainExpiry: cached.chainExpiry } : {}),
        })
      } else {
        setStaleSnapshotInfo(null)
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeWithCache = (
    ticker: string,
    weeksOut = 4,
    spreadWidth: number | null = 5,
    strategyMode: StrategyMode = 'all',
    chainExpiry: string | null = null,
  ) => {
    setInputTicker(ticker.trim().toUpperCase())
    const cached = getCached(ticker)
    const ce = chainExpiry?.trim().slice(0, 10) ?? null
    const ceKey = ce && /^\d{4}-\d{2}-\d{2}$/.test(ce) ? ce : null
    if (cached && isCacheFresh(cached) &&
        cached.weeksOut === weeksOut &&
        cached.spreadWidth === spreadWidth &&
        (cached.strategyMode ?? 'all') === strategyMode &&
        (cached.chainExpiry ?? null) === (ceKey ?? null)) {
      setData(cached.data)
      setActiveTab('chart')
      setFromCache({ age: cacheAge(cached), fresh: true })
      setError(null)
      setStaleSnapshotInfo(null)
      setLastWeeks(weeksOut)
      setLastWidth(spreadWidth)
      setLastMode(strategyMode)
      setSelectedWeeksOut(weeksOut)
      setLastChainExpiry(ceKey)
      saveLastAnalysisRequest({
        ticker: ticker.trim().toUpperCase(),
        weeksOut, spreadWidth, strategyMode,
        ...(ceKey ? { chainExpiry: ceKey } : {}),
      })
    } else {
      handleAnalyze(ticker, weeksOut, spreadWidth, strategyMode, chainExpiry)
    }
  }

  useEffect(() => {
    if (pendingTicker && !didRun.current) {
      didRun.current = true
      setInputTicker(pendingTicker)
      const weeksOut = pendingAnalysisOptions?.weeksOut ?? 4
      const spreadWidth = pendingAnalysisOptions?.spreadWidth ?? 5
      const strategyMode = pendingAnalysisOptions?.strategyMode ?? 'all'
      const force = pendingAnalysisOptions?.force ?? false
      const rawCe = pendingAnalysisOptions?.chainExpiry
      const chainExpiry = typeof rawCe === 'string' && rawCe.trim() ? rawCe.trim().slice(0, 10) : null
      const chainExpiryNorm = chainExpiry && /^\d{4}-\d{2}-\d{2}$/.test(chainExpiry) ? chainExpiry : null
      const fsRaw = pendingAnalysisOptions?.focusStrategy
      const feRaw = pendingAnalysisOptions?.focusExpiry
      const fs = typeof fsRaw === 'string' && fsRaw.trim() ? fsRaw.trim() : ''
      const fe = typeof feRaw === 'string' && feRaw.trim() ? feRaw.trim().slice(0, 10) : ''
      pendingRecFocusRef.current =
        fs && fe && /^\d{4}-\d{2}-\d{2}$/.test(fe) ? { strategy: fs, expiry: fe } : null
      setScrollFocusRank(null)
      clearPendingTicker()
      if (force) {
        handleAnalyze(pendingTicker, weeksOut, spreadWidth, strategyMode, chainExpiryNorm)
      } else {
        handleAnalyzeWithCache(pendingTicker, weeksOut, spreadWidth, strategyMode, chainExpiryNorm)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTicker, pendingAnalysisOptions])

  useEffect(() => {
    if (!pendingTicker) didRun.current = false
  }, [pendingTicker])

  useEffect(() => {
    if (pendingTicker || didRestoreLastAnalysis.current) return
    const last = loadLastAnalysisRequest()
    if (!last) return
    didRestoreLastAnalysis.current = true
    setInputTicker(last.ticker)
    setLastWeeks(last.weeksOut)
    setLastWidth(last.spreadWidth)
    setLastMode(last.strategyMode)
    setSelectedWeeksOut(last.weeksOut)
    setLastChainExpiry(last.chainExpiry ?? null)
    handleAnalyze(last.ticker, last.weeksOut, last.spreadWidth, last.strategyMode, last.chainExpiry ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTicker])

  const cacheEntry = data ? tickerCache[data.ticker] : null
  const selectedData =
    !cacheEntry
      ? data
      : cacheEntry.weeksOut === selectedWeeksOut
      ? cacheEntry.data
      : cacheEntry.multiWeekData?.[selectedWeeksOut] ?? null
  const displayData = selectedData ?? data

  useEffect(() => {
    const pending = pendingRecFocusRef.current
    if (!pending || loading) return
    const source = selectedData ?? data
    if (!source?.recommendations?.length) {
      pendingRecFocusRef.current = null
      return
    }
    const match = source.recommendations.find(
      r => r.strategy === pending.strategy && r.expiry.trim().slice(0, 10) === pending.expiry,
    )
    pendingRecFocusRef.current = null
    if (match) setScrollFocusRank(match.rank)
  }, [loading, selectedData, data])

  const cardStyle: React.CSSProperties = {
    background: C.bgPanel,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '16px 20px',
    marginTop: 14,
  }

  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="ticker-page min-h-screen p-4 md:p-6" style={{ background: C.bgPage }}>
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* Mobile/tablet search toggle */}
        <button
          type="button"
          onClick={() => setSearchOpen(p => !p)}
          className="lg:hidden w-full flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 text-sm font-semibold text-secondary"
        >
          <Search size={16} />
          {searchOpen ? 'Hide search' : 'Show search'}
        </button>

        {/* Left: Search panel */}
        <div className={`${searchOpen ? 'block' : 'hidden'} lg:block w-full lg:w-80 shrink-0 lg:sticky lg:top-6`}>
          {/* Badge strip */}
          {!loading && data && displayData && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {/* Live / cache badge */}
              {fromCache ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', color: C.purple, background: 'rgba(107,127,212,0.08)', border: `1px solid rgba(107,127,212,0.2)`, borderRadius: 20, padding: '2px 8px' }}>
                  <Database size={10} />
                  {fromCache.fresh ? `Cached · ${fromCache.age === 0 ? 'just now' : `${fromCache.age}m ago`}` : 'Stale cache'}
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', color: C.green, background: 'rgba(0,229,160,0.08)', border: `1px solid rgba(0,229,160,0.2)`, borderRadius: 20, padding: '2px 8px' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'tdPulse 2s infinite' }} />
                  Live
                </span>
              )}
              {/* Strategy mode badge */}
              {lastMode !== 'all' && (
                <span style={{ fontSize: '0.65rem', color: C.violet, background: 'rgba(124,92,252,0.08)', border: `1px solid rgba(124,92,252,0.2)`, borderRadius: 20, padding: '2px 8px' }}>
                  {lastMode === 'long_only'         ? '📈 Long Only'
                   : lastMode === 'credit_only'      ? '💰 Credit'
                   : lastMode === 'straddle_only'    ? '⚡ Straddle'
                   : lastMode === 'short_or_covered' ? '🎯 Short/Covered'
                   : 'Filter'}
                </span>
              )}
              {/* IV rank warning badge */}
              {lastMode === 'all' && displayData.signals.iv_rank >= 50 && (
                <span style={{ fontSize: '0.65rem', color: C.amber, background: 'rgba(245,166,35,0.08)', border: `1px solid rgba(245,166,35,0.2)`, borderRadius: 20, padding: '2px 8px' }}
                  title="IV Rank ≥ 50% — Long Call/Put suppressed in All Strategies mode">
                  ⚠️ IV {displayData.signals.iv_rank.toFixed(0)}%
                </span>
              )}
            </div>
          )}
          <TickerInput
            onAnalyze={handleAnalyzeWithCache}
            loading={loading}
            initialTicker={inputTicker}
            initialWeeks={lastWeeks}
            initialSpreadWidth={lastWidth}
            initialStrategyMode={lastMode}
          />
          {/* Data quality banners */}
          {!loading && data && displayData && (
            <div style={{ marginTop: 8 }}>
              {staleSnapshotInfo && (
                <div style={{ marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => setStaleBannerOpen(p => !p)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: C.amber, fontWeight: 600, fontSize: '0.72rem', padding: 0 }}
                  >
                    <AlertTriangle size={14} />
                    {staleBannerOpen ? 'Hide' : 'Market data stale — click for details'}
                  </button>
                  {staleBannerOpen && (
                    <div style={{ borderRadius: 8, border: `1px solid rgba(245,166,35,0.3)`, background: 'rgba(245,166,35,0.06)', padding: '8px 10px', marginTop: 4, fontSize: '0.72rem' }}>
                      <p style={{ color: 'rgba(245,166,35,0.8)', lineHeight: 1.5 }}>
                        Snapshot from{' '}
                        <span style={{ fontFamily: 'monospace', color: C.text }}>
                          {new Date(staleSnapshotInfo.cachedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                        . {staleSnapshotInfo.errorDetail}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {displayData.quote_quality_summary?.banner_show &&
                (displayData.quote_quality_summary.banner_lines?.length ?? 0) > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setYahooBannerOpen(p => !p)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: C.amber, fontWeight: 600, fontSize: '0.72rem', padding: 0 }}
                  >
                    <AlertTriangle size={14} />
                    {yahooBannerOpen ? 'Hide' : 'Yahoo data may be incomplete — click'}
                  </button>
                  {yahooBannerOpen && (
                    <div style={{ borderRadius: 8, border: `1px solid rgba(245,166,35,0.3)`, background: 'rgba(245,166,35,0.06)', padding: '8px 10px', marginTop: 4, fontSize: '0.72rem' }}>
                      <div style={{ fontWeight: 600, color: C.amber, marginBottom: 4 }}>Yahoo option data looks incomplete or stale</div>
                      <ul style={{ paddingLeft: 14, color: 'rgba(245,166,35,0.8)', lineHeight: 1.5, margin: 0 }}>
                        {displayData.quote_quality_summary.banner_lines.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                      <p style={{ fontSize: '0.68rem', color: 'rgba(245,166,35,0.5)', marginTop: 6 }}>
                        Tap refresh after a minute or confirm strikes with your broker.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Week selector + fetch */}
          {data && !loading && cacheEntry && (
            <WeekSelector
              entry={cacheEntry}
              selectedWeeksOut={selectedWeeksOut}
               onSelect={(w) => {
                 setSelectedWeeksOut(w)
                 const hasData = !!cacheEntry.multiWeekData?.[w] || cacheEntry.weeksOut === w
                 if (!hasData) fetchSingleWeek(data.ticker, w)
                 try { analyzeV2(data.ticker, 'regular', { weeksOut: w }).then(r => setUnifiedAnalysis(r.data)) } catch { /* non-fatal */ }
               }}
              onFetch={() => fetchAllWeeks(data.ticker)}
              fetching={fetchingAllWeeks.has(data.ticker)}
              loadingWeeks={fetchingWeeks.get(data.ticker) ?? new Set()}
            />
          )}
        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0 w-full">

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
            <svg style={{ animation: 'spin 1s linear infinite', width: 40, height: 40, color: C.violet }} fill="none" viewBox="0 0 24 24">
              <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span style={{ color: C.text, fontSize: '1.05rem' }}>Running systematic analysis…</span>
            <span style={{ color: C.muted, fontSize: '0.85rem' }}>Fetching options chain · Computing signals · Scoring trades</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            background: 'rgba(255,77,109,0.08)', border: `1px solid rgba(255,77,109,0.25)`,
            borderRadius: 12, padding: '16px 20px', marginTop: 14,
          }}>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 6 }}>⚠️ Analysis Failed</div>
            <div style={{ color: 'rgba(255,77,109,0.8)', fontSize: '0.875rem' }}>{error}</div>
            <div style={{ color: C.muted, fontSize: '0.75rem', marginTop: 8 }}>
              Common issues: Invalid ticker · No options available · Market closed
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && data && displayData && (
          <>




            {/* Market Overview */}
            <div style={cardStyle}>
              <MarketOverview
                ticker={displayData.ticker}
                companyName={displayData.company_name}
                sector={displayData.sector}
                marketCap={displayData.market_cap}
                signals={displayData.signals}
              />
            </div>

            {/* Verdict card (unified analysis) */}
            {unifiedAnalysis && (
              <RegularVerdictCard analysis={unifiedAnalysis} />
            )}

            {/* Context line: rec breakdown — uses selectedData for accurate counts */}
            {selectedData?.recommendations && selectedData.recommendations.length > 0 && (
            (() => {
              const entryCount = selectedData.recommendations.filter(r => (r.scores?.total_score ?? 0) >= 70).length
              const setupCount = selectedData.recommendations.filter(r => (r.scores?.total_score ?? 0) >= 55 && (r.scores?.total_score ?? 0) < 70).length
              return (
                <div style={{ marginTop: 6, marginBottom: 10, fontSize: '11px', color: '#5A6478', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {entryCount > 0 && <span style={{ background: 'rgba(0,229,160,0.1)', color: '#00E5A0', border: '1px solid rgba(0,229,160,0.25)', borderRadius: 4, padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>{entryCount} ready to enter</span>}
                  {setupCount > 0 && <span style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 4, padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>{setupCount} setting up</span>}
                  {entryCount === 0 && setupCount === 0 && <span style={{ color: '#5A6478' }}>No structures ready yet — conditions still forming</span>}
                </div>
              )
            })()
            )}

            {/* Recommendations */}
             <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.accent }}>Trade recommendations · {selectedWeeksOut}w</span>
                  <span style={{ fontSize: '11px', color: C.muted, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 20, padding: '2px 10px' }}>
                    {selectedData?.recommendations.length ?? 0} trades passed all filters
                  </span>
                </div>

              {!selectedData ? (
                <div style={{
                  background: C.bgPanel, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: 20, textAlign: 'center',
                }}>
                  <div style={{ color: C.text, fontWeight: 600, marginBottom: 6 }}>
                    No {selectedWeeksOut}w scan loaded yet
                  </div>
                  <div style={{ color: C.muted, fontSize: '0.85rem', marginBottom: 14 }}>
                    Fetch all weeks to load this expiry window, then use the week tabs to compare trades.
                  </div>
                  <button
                    onClick={() => fetchAllWeeks(data.ticker)}
                    disabled={fetchingAllWeeks.has(data.ticker)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: C.violet, color: '#fff', border: 'none',
                      borderRadius: 8, padding: '8px 16px',
                      fontSize: '0.82rem', fontWeight: 600,
                      cursor: fetchingAllWeeks.has(data.ticker) ? 'wait' : 'pointer',
                      opacity: fetchingAllWeeks.has(data.ticker) ? 0.6 : 1,
                    }}
                  >
                    <Layers size={13} />
                    {fetchingAllWeeks.has(data.ticker) ? 'Fetching all weeks…' : 'Fetch All Weeks'}
                  </button>
                </div>
              ) : selectedData.recommendations.length === 0 ? (
                <div style={{
                  background: 'rgba(245,166,35,0.06)', border: `1px solid rgba(245,166,35,0.2)`,
                  borderRadius: 12, padding: 20, textAlign: 'center',
                }}>
                  <div style={{ color: C.amber, fontWeight: 600, marginBottom: 6 }}>
                    No trades passed all filters
                  </div>
                  <div style={{ color: 'rgba(245,166,35,0.6)', fontSize: '0.82rem' }}>
                    Try a more liquid ticker (SPY, AAPL, TSLA, QQQ) or adjust the spread width / strategy mode.
                  </div>
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto' }}>
                  <table style={{ minWidth: 800, width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ background: C.bgPanel }}>
                        <th style={{ width: '3%', padding: '8px 6px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>#</th>
                        <th style={{ width: '22%', padding: '8px 10px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Strategy</th>
                        <th style={{ width: '8%', padding: '8px 6px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Action</th>
                        <th style={{ width: '6%', padding: '8px 6px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Type</th>
                        <th style={{ width: '8%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Strike</th>
                        <th style={{ width: '8%', padding: '8px 6px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Expiry</th>
                        <th style={{ width: '8%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Cost</th>
                        <th style={{ width: '9%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Max Profit</th>
                        <th style={{ width: '6%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>R:R</th>
                        <th style={{ width: '6%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Score</th>
                        <th style={{ width: '6%', padding: '8px 6px', textAlign: 'right', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>PoP</th>
                        <th style={{ width: '10%', padding: '8px 6px', textAlign: 'center', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedData.recommendations.map(rec => {
                        const isCredit = (rec.net_credit ?? 0) > 0
                        const score = rec.scores?.total_score ?? 0
                        const rr = rec.risk_reward_ratio ?? 0
                        const allFilters = (rec.passes_rr_filter ?? false) && (rec.passes_liquidity_filter ?? false) && (isCredit ? (rec.passes_credit_filter ?? false) : true)
                        const status = score >= 70 && allFilters ? 'ENTER' : score >= 55 && rec.passes_liquidity_filter ? 'SETUP' : score >= 40 ? 'WATCH' : 'AVOID'
                        const statusColor = status === 'ENTER' ? C.green : status === 'SETUP' ? C.amber : status === 'WATCH' ? C.purple : C.red
                        return (
                          <React.Fragment key={rec.rank}>
                            {rec.legs.map((leg, li) => (
                              <tr key={`${rec.rank}-${li}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', verticalAlign: 'top', color: C.violet, fontWeight: 700, fontFamily: 'monospace' }}>{rec.rank}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.82rem' }}>{rec.strategy}</div>
                                  <div style={{ color: isCredit ? C.green : C.red, fontSize: '0.7rem', fontFamily: 'monospace', marginTop: 2 }}>{isCredit ? `Credit $${Math.abs(rec.net_credit!).toFixed(2)}` : `Debit $${Math.abs(rec.net_credit!).toFixed(2)}`}</div>
                                  <div style={{ color: C.muted, fontSize: '0.65rem', marginTop: 1 }}>{rec.expiry.slice(5)} · {rec.dte}dte</div>
                                </td>)}
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600, color: leg.action === 'BUY' ? C.green : C.red }}>{leg.action}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#fff' }}>{leg.option_type}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#fff', textAlign: 'right' }}>${leg.strike.toFixed(2)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: C.muted, fontSize: '0.72rem' }}>{leg.expiry.slice(5)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: leg.action === 'BUY' ? C.red : C.green, textAlign: 'right' }}>${(leg.mid_price * 100).toFixed(2)}</td>
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: C.green }}>${(rec.max_profit * 100).toFixed(2)}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: rr > 0 && rr <= 3 ? C.green : rr > 0 ? C.amber : C.muted }}>{rr > 0 ? `1:${rr.toFixed(1)}` : '—'}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: scoreColor(score) }}>{score || '—'}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: C.amber }}>{(rec.prob_of_profit * 100).toFixed(0)}%</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'top' }}>
                                  <span style={{ display: 'inline-block', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: statusColor, border: `1px solid ${statusColor}`, background: status === 'ENTER' ? 'rgba(0,229,160,0.08)' : status === 'SETUP' ? 'rgba(245,166,35,0.08)' : status === 'WATCH' ? 'rgba(107,127,212,0.08)' : 'rgba(255,77,109,0.08)' }}>{status}</span>
                                </td>)}
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Chart / Calculator (collapsed by default) */}
            <div style={{
              background: C.bgPanel, border: `1px solid ${C.border}`,
              borderRadius: 14, overflow: 'hidden', marginTop: 14,
            }}>
              {activeTab ? (
                <>
                <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                  {(['chart', 'calculator'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      style={{
                        flex: 1,
                        padding: '10px 16px',
                        background: activeTab === t ? 'rgba(74,124,255,0.05)' : 'transparent',
                        border: 'none',
                        borderBottom: activeTab === t ? `2px solid ${C.accent}` : '2px solid transparent',
                        color: activeTab === t ? '#fff' : C.muted,
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {t === 'chart' ? '📉 Candlestick' : '📈 P&L Calculator'}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '16px 20px' }}>
                  {activeTab === 'chart' ? (
                    <PriceChart history={displayData.price_history} />
                  ) : (
                    <OptionProfitCalculator
                      recommendations={selectedData?.recommendations ?? []}
                      currentPrice={displayData.signals.current_price}
                    />
                  )}
                </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('chart')}
                  style={{
                    width: '100%', padding: '10px 16px',
                    background: 'transparent', border: 'none',
                    color: C.muted, fontSize: '0.78rem', fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6,
                  }}
                >
                  📊 Show Chart &amp; P&L Analysis
                </button>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !error && !data && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>📊</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Systematic Options Analysis
            </div>
            <div style={{ fontSize: '0.85rem', color: C.muted, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
              Enter any US stock ticker above. The engine fetches live options data,
              runs multi-signal analysis, and recommends specific trades with exact strikes,
              delta-based selection, R:R filtering, and expected value scoring.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              {['Delta-based strikes', 'R:R & credit % filters', 'Expected Value scoring'].map(pill => (
                <span key={pill} style={{
                  fontSize: '0.7rem', color: C.muted,
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  ✓ {pill}
                </span>
              ))}
            </div>
          </div>
        )}

        {!loading && data && displayData && (
        <div style={cardStyle}>
          <SignalPanel signals={displayData.signals} />
        </div>
        )}

        {/* Disclaimer */}
        <div style={{
          textAlign: 'center', fontSize: '0.65rem', color: C.muted, opacity: 0.5,
          padding: '12px 0', borderTop: `1px solid ${C.border}`, marginTop: 16,
        }}>
          ⚠️ For educational purposes only. Not financial advice. Options trading involves significant risk of loss.
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes tdPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
        `}</style>
      </div>
    </div>
    </div>
  )
}
