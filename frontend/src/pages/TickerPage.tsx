import { useState, useEffect, useRef } from 'react'
import { Star, StarOff, RefreshCw, Database, Layers, CheckCircle2, AlertTriangle, XCircle, ChevronDown } from 'lucide-react'
import { analyzeOptions } from '../api/client'
import type { AnalyzeResponse, StrategyMode, TickerCacheEntry } from '../types'
import { isCacheFresh, cacheAge } from '../types'
import TickerInput from '../components/TickerInput'
import MarketOverview from '../components/MarketOverview'
import SignalPanel from '../components/SignalPanel'
import RecommendationCard from '../components/RecommendationCard'
import OptionsChainTable from '../components/OptionsChainTable'
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
      borderRadius: 14,
      padding: '14px 16px',
      marginTop: 14,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {/* Label + GO count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted,
          }}>
            Week Filter
          </span>
          {goCount > 0 && (
            <span style={{
              background: 'rgba(0,229,160,0.1)', border: `1px solid rgba(0,229,160,0.2)`,
              color: C.green, fontSize: '0.6rem', fontWeight: 700,
              borderRadius: 20, padding: '1px 8px',
            }}>
              {goCount} GO
            </span>
          )}
        </div>

        {/* Slots */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
          {slots.map(slot => {
            const active = selectedWeeksOut === slot.weeksOut
            const isLoading = loadingWeeks.has(slot.weeksOut)
            const hovered = hoveredSlot === slot.label
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
                onMouseEnter={() => setHoveredSlot(slot.label)}
                onMouseLeave={() => setHoveredSlot(null)}
                disabled={isLoading}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${active ? C.accent : hovered && !isLoading ? C.accent : C.borderSub}`,
                  background: active ? 'rgba(74,124,255,0.1)' : isLoading ? 'rgba(124,92,252,0.05)' : C.bgCard,
                  cursor: isLoading ? 'wait' : 'pointer',
                  minWidth: 70,
                  textAlign: 'center',
                  opacity: !slot.hasData && !isLoading ? 0.4 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                    animation: isLoading ? 'tdPulse 1.5s infinite' : undefined,
                  }} />
                  <span style={{
                    fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace',
                    color: active ? '#fff' : C.muted,
                  }}>
                    {slot.label}
                  </span>
                  {slot.dte !== null && (
                    <span style={{ fontSize: '0.6rem', color: C.muted, opacity: 0.5 }}>
                      · {slot.dte}d
                    </span>
                  )}
                </div>
                {isLoading ? (
                  <span style={{ fontSize: '0.6rem', color: C.violet }}>loading…</span>
                ) : slot.hasData ? (
                  slot.verdict ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: VERDICT_TEXT_COLOR[slot.verdict] }}>
                      {VERDICT_ICON[slot.verdict]}
                      <span style={{ fontSize: '0.6rem', fontWeight: 700 }}>{slot.verdict}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.6rem', color: C.muted, opacity: 0.5 }}>no trades</span>
                  )
                ) : (
                  <span style={{ fontSize: '0.6rem', color: C.muted, opacity: 0.5 }}>tap to load</span>
                )}
                {slot.recCount > 0 && (
                  <span style={{ fontSize: '0.6rem', color: C.muted, opacity: 0.4 }}>
                    {slot.recCount} trade{slot.recCount !== 1 ? 's' : ''}
                  </span>
                )}
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
    addToWatchlist, removeFromWatchlist, isWatched,
    pendingTicker, pendingAnalysisOptions, clearPendingTicker,
    getCached, setCached, tickerCache,
    fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
  } = useApp()

  const [data,          setData]          = useState<AnalyzeResponse | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'chart' | 'calculator' | 'chain'>('chart')
  const [fromCache,     setFromCache]     = useState<{ age: number; fresh: boolean } | null>(null)
  const [staleSnapshotInfo, setStaleSnapshotInfo] = useState<{ cachedAt: number; errorDetail: string } | null>(null)
  const [lastWeeks,     setLastWeeks]     = useState(4)
  const [lastWidth,     setLastWidth]     = useState<number | null>(5)
  const [lastMode,      setLastMode]      = useState<StrategyMode>('all')
  const [lastChainExpiry, setLastChainExpiry] = useState<string | null>(null)
  const [inputTicker,   setInputTicker]   = useState('')
  const [selectedWeeksOut, setSelectedWeeksOut] = useState(4)
  const [signalOpen,    setSignalOpen]    = useState(false)
  const [chevronHover,  setChevronHover]  = useState(false)
  const [refreshHover,  setRefreshHover]  = useState(false)
  const [watchHover,    setWatchHover]    = useState(false)

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

  const watched = data ? isWatched(data.ticker) : false

  const toggleWatchlist = () => {
    if (!data) return
    if (watched) {
      removeFromWatchlist(data.ticker)
    } else {
      if (!addToWatchlist({
        ticker: data.ticker,
        companyName: data.company_name,
        sector: data.sector,
        lastPrice: data.signals.current_price,
      })) return
    }
  }

  const handleRefresh = () => {
    if (data) handleAnalyze(data.ticker, lastWeeks, lastWidth, lastMode, lastChainExpiry)
  }

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

  const L = 280

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', background: C.bgPage, minHeight: '100vh', padding: '20px 24px' }}>
      {/* Left: Search panel */}
      <div style={{ width: L, flexShrink: 0, position: 'sticky', top: 20 }}>
        <TickerInput
          onAnalyze={handleAnalyzeWithCache}
          loading={loading}
          initialTicker={inputTicker}
          initialWeeks={lastWeeks}
          initialSpreadWidth={lastWidth}
          initialStrategyMode={lastMode}
        />
      </div>

      {/* Right: Content */}
      <div style={{ flex: 1, minWidth: 0 }}>

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
            {staleSnapshotInfo && (
              <div style={{
                borderRadius: 12, border: `1px solid rgba(245,166,35,0.3)`,
                background: 'rgba(245,166,35,0.06)', padding: '12px 16px',
                display: 'flex', gap: 12, marginTop: 14,
              }}>
                <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, fontSize: '0.875rem' }}>
                  <div style={{ fontWeight: 600, color: C.amber }}>Latest market data did not load</div>
                  <p style={{ color: 'rgba(245,166,35,0.8)', marginTop: 6, lineHeight: 1.6 }}>
                    Showing your last successful analysis snapshot from{' '}
                    <span style={{ fontFamily: 'monospace', color: C.text }}>
                      {new Date(staleSnapshotInfo.cachedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    . Cached data was kept until a new request succeeds.
                  </p>
                  <p style={{ color: 'rgba(245,166,35,0.5)', fontSize: '0.72rem', marginTop: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {staleSnapshotInfo.errorDetail}
                  </p>
                </div>
              </div>
            )}

            {displayData.quote_quality_summary?.banner_show &&
              (displayData.quote_quality_summary.banner_lines?.length ?? 0) > 0 && (
              <div style={{
                borderRadius: 12, border: `1px solid rgba(245,166,35,0.3)`,
                background: 'rgba(245,166,35,0.06)', padding: '12px 16px',
                display: 'flex', gap: 12, marginTop: 14,
              }}>
                <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, fontSize: '0.875rem' }}>
                  <div style={{ fontWeight: 600, color: C.amber }}>Yahoo option data looks incomplete or stale</div>
                  <ul style={{ marginTop: 8, paddingLeft: 16, color: 'rgba(245,166,35,0.8)', lineHeight: 1.6 }}>
                    {displayData.quote_quality_summary.banner_lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  <p style={{ fontSize: '0.72rem', color: 'rgba(245,166,35,0.5)', marginTop: 10 }}>
                    Data comes from Yahoo Finance — when bid/ask are missing or Yahoo serves cached last prices,
                    mids and signals can drift. Tap refresh after a minute or confirm strikes with your broker.
                  </p>
                </div>
              </div>
            )}

            {/* Header: live/cache badge + mode badge + action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Live / cache badge */}
                {fromCache ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: '0.7rem', color: C.purple,
                    background: 'rgba(107,127,212,0.08)', border: `1px solid rgba(107,127,212,0.2)`,
                    borderRadius: 20, padding: '3px 10px',
                  }}>
                    <Database size={11} />
                    {fromCache.fresh
                      ? `Cached · ${fromCache.age === 0 ? 'just now' : `${fromCache.age}m ago`}`
                      : 'Stale cache'}
                  </div>
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: '0.7rem', color: C.green,
                    background: 'rgba(0,229,160,0.08)', border: `1px solid rgba(0,229,160,0.2)`,
                    borderRadius: 20, padding: '3px 10px',
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', background: C.green,
                      animation: 'tdPulse 2s infinite',
                    }} />
                    Live data
                  </div>
                )}

                {/* Strategy mode badge */}
                {lastMode !== 'all' && (
                  <div style={{
                    fontSize: '0.7rem', color: C.violet,
                    background: 'rgba(124,92,252,0.08)', border: `1px solid rgba(124,92,252,0.2)`,
                    borderRadius: 20, padding: '3px 10px',
                  }}>
                    {lastMode === 'long_only'         ? '📈 Long Options Only'
                     : lastMode === 'credit_only'      ? '💰 Credit Spreads Only'
                     : lastMode === 'straddle_only'    ? '⚡ Straddles Only'
                     : lastMode === 'short_or_covered' ? '🎯 Short / Covered Only'
                     : 'Strategy filter'}
                  </div>
                )}

                {lastMode === 'all' &&
                  displayData.signals.iv_rank >= 50 && (
                    displayData.signals.directional_bias.toLowerCase().includes('bullish') ||
                    displayData.signals.directional_bias.toLowerCase().includes('bearish')
                  ) && (
                  <div style={{
                    fontSize: '0.7rem', color: C.amber,
                    background: 'rgba(245,166,35,0.08)', border: `1px solid rgba(245,166,35,0.2)`,
                    borderRadius: 20, padding: '3px 10px',
                  }}
                    title="In All Strategies mode, naked Long Calls/Puts are suppressed when IV Rank ≥ 50 to prevent buying expensive premium that can be crushed post-catalyst. Switch to Long Options mode to override.">
                    ⚠️ IV Rank {displayData.signals.iv_rank.toFixed(0)}% — Long Call/Put suppressed
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  aria-label="Refresh analysis"
                  onMouseEnter={() => setRefreshHover(true)}
                  onMouseLeave={() => setRefreshHover(false)}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: C.bgCard,
                    border: `1px solid ${refreshHover ? C.borderSub : C.border}`,
                    color: refreshHover ? C.text : C.muted,
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: loading ? 0.5 : 1,
                    transition: 'all 0.12s',
                  }}
                >
                  <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
                </button>
                <button
                  type="button"
                  onClick={toggleWatchlist}
                  aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                  onMouseEnter={() => setWatchHover(true)}
                  onMouseLeave={() => setWatchHover(false)}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: watched ? 'rgba(245,166,35,0.1)' : C.bgCard,
                    border: `1px solid ${watched ? C.amber : watchHover ? C.borderSub : C.border}`,
                    color: watched ? C.amber : watchHover ? C.text : C.muted,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.12s',
                  }}
                >
                  {watched ? <StarOff size={16} /> : <Star size={16} />}
                </button>
              </div>
            </div>

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

            {/* Signal Panel (collapsible) */}
            <div style={cardStyle}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSignalOpen(p => !p)}
                onKeyDown={e => e.key === 'Enter' && setSignalOpen(p => !p)}
                onMouseEnter={() => setChevronHover(true)}
                onMouseLeave={() => setChevronHover(false)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: chevronHover ? C.text : C.text }}>
                  📊 Full Signal Breakdown
                </span>
                <ChevronDown
                  size={16}
                  style={{
                    color: C.muted,
                    transform: signalOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                  }}
                />
              </div>
              {signalOpen && (
                <div style={{ marginTop: 14 }}>
                  <SignalPanel signals={displayData.signals} />
                </div>
              )}
            </div>

            {/* Week selector */}
            {cacheEntry && (
              <WeekSelector
                entry={cacheEntry}
                selectedWeeksOut={selectedWeeksOut}
                onSelect={(w) => {
                  setSelectedWeeksOut(w)
                  const hasData = !!cacheEntry.multiWeekData?.[w] || cacheEntry.weeksOut === w
                  if (!hasData) fetchSingleWeek(data.ticker, w)
                }}
                onFetch={() => fetchAllWeeks(data.ticker)}
                fetching={fetchingAllWeeks.has(data.ticker)}
                loadingWeeks={fetchingWeeks.get(data.ticker) ?? new Set()}
              />
            )}

            {/* Recommendations */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: C.violet }}>
                  🎯 Trade Recommendations · {selectedWeeksOut}w
                </h2>
                <span style={{
                  fontSize: '0.65rem', color: C.muted,
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: 20, padding: '2px 10px',
                }}>
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
                selectedData.recommendations.map(rec => (
                  <div key={rec.rank} style={{ marginBottom: 10 }}>
                    <RecommendationCard
                      rec={rec}
                      ticker={selectedData.ticker}
                      companyName={selectedData.company_name}
                      currentPrice={selectedData.signals.current_price}
                      signals={selectedData.signals}
                      onFetchAllWeeks={() => fetchAllWeeks(data.ticker)}
                      fetchingAllWeeks={fetchingAllWeeks.has(data.ticker)}
                      scrollFocusRank={scrollFocusRank}
                      onScrollFocusConsumed={() => setScrollFocusRank(null)}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Chart / Calculator / Chain tabs */}
            <div style={{
              background: C.bgPanel, border: `1px solid ${C.border}`,
              borderRadius: 14, overflow: 'hidden', marginTop: 14,
            }}>
              <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                {(['chart', 'calculator', 'chain'] as const).map(t => (
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
                    {t === 'chart' ? '📉 Candlestick' : t === 'calculator' ? '📈 P&L Calculator' : '📋 Options Chain'}
                  </button>
                ))}
              </div>
              <div style={{ padding: '16px 20px' }}>
                {activeTab === 'chart' ? (
                  <PriceChart history={displayData.price_history} />
                ) : activeTab === 'calculator' ? (
                  <OptionProfitCalculator
                    recommendations={selectedData?.recommendations ?? []}
                    currentPrice={displayData.signals.current_price}
                  />
                ) : (
                  <OptionsChainTable
                    calls={displayData.calls_chain}
                    puts={displayData.puts_chain}
                    currentPrice={displayData.signals.current_price}
                    expiry={displayData.filters_applied?.chain_expiry as string | undefined}
                  />
                )}
              </div>
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
  )
}
