import React, { useState, useEffect, useRef } from 'react'
import { Search, Database, Layers, AlertTriangle, BookOpen } from 'lucide-react'
import { analyzeOptions, analyzeV2 } from '../api/client'
import type { UnifiedAnalysis } from '../api/client'
import type { AnalyzeResponse, StrategyMode, TickerCacheEntry } from '../types'
import RecommendationCard, { deriveRegularTradeState } from '../components/RecommendationCard'
import { isCacheFresh, cacheAge } from '../types'
import TickerInput from '../components/TickerInput'
import MarketOverview from '../components/MarketOverview'
import SignalPanel from '../components/SignalPanel'
import PriceChart from '../components/PriceChart'
import OptionProfitCalculator from '../components/OptionProfitCalculator'
import UnifiedVerdictCard from '../components/UnifiedVerdictCard'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'
import { OA_LAST_OPTION_ANALYSIS_KEY } from '../constants/storageKeys'

type Palette = {
  bgPage: string; bgPanel: string; bgCard: string
  border: string; borderSub: string
  muted: string; accent: string; violet: string
  green: string; red: string; amber: string; purple: string
  text: string; textInv: string; glassHover: string
}

const C_DARK: Palette = {
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
  textInv:   '#111827',
  glassHover:'rgba(255,255,255,0.04)',
}

const C_LIGHT: Palette = {
  bgPage:    '#F0F2F5',
  bgPanel:   '#FFFFFF',
  bgCard:    '#F8F9FB',
  border:    '#E5E7EB',
  borderSub: '#D1D5DB',
  muted:     '#6B7280',
  accent:    '#4A7CFF',
  violet:    '#7C5CFC',
  green:     '#00A86B',
  red:       '#DC2626',
  amber:     '#D97706',
  purple:    '#6B7FD4',
  text:      '#111827',
  textInv:   '#FFFFFF',
  glassHover:'rgba(0,0,0,0.03)',
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
  if (!['all', 'long_only', 'credit_only', 'short_or_covered', 'straddle_only', 'calendar_only'].includes(strategyMode)) return null
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

const scoreColor = (s: number, C: Palette) =>
  s >= 75 ? C.green : s >= 55 ? C.amber : C.red

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
    const verdicts = entry.data.recommendations.map((r: typeof entry.data.recommendations[0]) =>
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
      const verdicts = d.recommendations.map((r: typeof d.recommendations[0]) => deriveVerdict(buildChecklist(r, d.signals)))
      slots.set(label, { weeksOut: Number(weeksOut), label, dte, verdict: bestVerdict(verdicts), recCount: verdicts.length, hasData: true })
    }
  }

  return MULTI_WEEK_TARGETS.map((w: number) => {
    const label = `${w}w`
    return slots.get(label) ?? { weeksOut: w, label, dte: null, verdict: null, recCount: 0, hasData: false }
  })
}

function WeekSelector({ entry, selectedWeeksOut, onSelect, onFetch, fetching, loadingWeeks, C }: {
  entry: TickerCacheEntry
  selectedWeeksOut: number
  onSelect: (weeksOut: number) => void
  onFetch: () => void
  fetching: boolean
  loadingWeeks: Set<number>
  C: Palette
}) {
  const slots = buildWeekSlots(entry)
  const hasFetched = !!entry.multiWeekData
  const goCount = slots.filter((s: WeekSlot) => s.verdict === 'GO').length
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null)
  const VERDICT_DOT_COLOR: Record<Verdict, string> = { 'GO': C.green, 'CAUTION': C.amber, 'NO GO': C.red }

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
          {slots.map((slot: WeekSlot) => {
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
                  color: active ? C.accent : C.muted,
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
            color: C.textInv,
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
          <Layers size={14} />
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

type StrategyGuideItem = {
  title: string
  bias: string
  bestWhen: string
  iv: string
  earnings: string
  dte: string
  risk: string
  avoid: string
  diagram: 'longCall' | 'longPut' | 'debitSpread' | 'creditSpread' | 'calendar'
  color: string
}

function StrategyPayoffDiagram({ type, color, C }: { type: StrategyGuideItem['diagram']; color: string; C: Palette }) {
  const axis = C.muted
  const stroke = color
  const fill = `${color}18`
  const path = (() => {
    if (type === 'longCall') return 'M18 78 L72 78 L136 18'
    if (type === 'longPut') return 'M18 18 L82 78 L136 78'
    if (type === 'debitSpread') return 'M18 78 L62 78 L104 28 L136 28'
    if (type === 'creditSpread') return 'M18 30 L58 30 L102 78 L136 78'
    return 'M18 68 C46 34 72 22 92 34 C110 45 122 63 136 68'
  })()
  const label = type === 'longCall' ? 'Long Call'
    : type === 'longPut' ? 'Long Put'
    : type === 'debitSpread' ? 'Debit Spread'
    : type === 'creditSpread' ? 'Credit Spread'
    : 'Calendar'
  return (
    <svg viewBox="0 0 154 96" role="img" aria-label={`${label} payoff diagram`} style={{ width: '100%', height: 96, display: 'block' }}>
      <rect x="1" y="1" width="152" height="94" rx="10" fill={C.bgCard} stroke={C.border} />
      <line x1="16" x2="140" y1="78" y2="78" stroke={axis} strokeOpacity="0.45" />
      <line x1="76" x2="76" y1="14" y2="84" stroke={axis} strokeOpacity="0.25" strokeDasharray="3 4" />
      <path d={`${path} L136 78 L18 78 Z`} fill={fill} opacity="0.8" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="16" fill={axis} fontSize="9" fontWeight="700">P/L</text>
      <text x="112" y="91" fill={axis} fontSize="9" fontWeight="700">Price</text>
    </svg>
  )
}

function StrategyGuideTab({ C }: { C: Palette }) {
  const strategies: StrategyGuideItem[] = [
    {
      title: 'Long Call',
      bias: 'Bullish directional',
      bestWhen: 'Price is above MA20/MA50, momentum is rising, and the setup needs unlimited upside participation.',
      iv: 'Best when IV rank is low to moderate, ideally below 50. Avoid overpaying for inflated premium.',
      earnings: 'Avoid right before earnings unless intentionally trading event risk. IV crush can erase gains even if direction is correct.',
      dte: 'Use 21-45 DTE for multi-week regular trades. Use shorter only when catalyst timing is clear.',
      risk: 'Defined risk: premium paid. Needs strong direction because theta works against you.',
      avoid: 'Avoid in high IV, flat trend, weak volume, or when price is already extended far above MA20.',
      diagram: 'longCall',
      color: C.green,
    },
    {
      title: 'Long Put',
      bias: 'Bearish directional',
      bestWhen: 'Price is below MA20/MA50, rallies reject resistance, and market/sector confirms downside pressure.',
      iv: 'Best when IV rank is below 50. If IV is elevated, prefer a put debit spread.',
      earnings: 'Avoid buying puts immediately before earnings unless event risk is the thesis.',
      dte: 'Use 21-45 DTE. Give bearish trades enough time because downside often moves in bursts.',
      risk: 'Defined risk: premium paid. Needs clean downside follow-through.',
      avoid: 'Avoid after panic candles, at major support, or with RSI deeply oversold.',
      diagram: 'longPut',
      color: C.red,
    },
    {
      title: 'Call / Put Debit Spread',
      bias: 'Directional with controlled cost',
      bestWhen: 'Directional thesis is good, but IV is moderate or the long option is expensive.',
      iv: 'Works well in moderate IV, roughly 40-70. You buy one option and sell another to reduce cost.',
      earnings: 'Safer than naked long options into earnings, but still exposed to gap and IV crush.',
      dte: 'Use 21-45 DTE. Pick spread width that gives realistic target, not fantasy max profit.',
      risk: 'Defined risk: net debit. Reward is capped, but breakeven is improved.',
      avoid: 'Avoid when bid/ask spreads are wide or max profit depends on an unrealistic move.',
      diagram: 'debitSpread',
      color: C.violet,
    },
    {
      title: 'Bull Put / Bear Call Credit Spread',
      bias: 'Directional or range with premium selling',
      bestWhen: 'IV is elevated, price respects support/resistance, and you want theta working for you.',
      iv: 'Best when IV rank is elevated, usually 50+. Higher IV improves credit and cushion.',
      earnings: 'Can work before earnings only with defined risk and small size. Event gaps can exceed expected move.',
      dte: 'Use 14-45 DTE. Shorter DTE gives faster theta but higher gamma risk.',
      risk: 'Defined risk: spread width minus credit. Win rate can be higher, but losses must be controlled.',
      avoid: 'Avoid low credit, poor liquidity, binary events without edge, or selling too close to price.',
      diagram: 'creditSpread',
      color: C.amber,
    },
    {
      title: 'Calendar Spread',
      bias: 'Time/volatility structure',
      bestWhen: 'You expect price to stay near a strike while front-month decay is faster than back-month decay.',
      iv: 'Best when near-term IV is not wildly overpriced versus back-month IV, unless intentionally trading event skew.',
      earnings: 'Useful around earnings only for advanced traders who understand term structure and gap risk.',
      dte: 'Sell near expiry, buy farther expiry. Keep the short strike near the expected pin/target zone.',
      risk: 'Defined risk: net debit. Sensitive to IV term structure and price moving away from strike.',
      avoid: 'Avoid strong trend days, poor liquidity, or when price is likely to move far away from the short strike.',
      diagram: 'calendar',
      color: C.purple,
    },
  ]

  const cell: React.CSSProperties = {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 12,
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[
          ['Low IV', 'Favor long calls/puts or debit spreads. You are buying premium when it is relatively cheaper.', C.green],
          ['High IV', 'Favor credit spreads or defined-risk premium selling. Avoid overpaying for long options.', C.amber],
          ['Earnings Soon', 'Treat as event risk. Prefer defined-risk structures and reduce size.', C.red],
          ['No Clear Trend', 'Use calendars only if price is expected to stay near a strike. Otherwise wait.', C.purple],
        ].map(([label, text, color]) => (
          <div key={label} style={cell}>
            <div style={{ color: color as string, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>{text}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {strategies.map(strategy => (
          <div key={strategy.title} style={{ ...cell, padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 154px', gap: 12, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ color: strategy.color, fontSize: 15, fontWeight: 800 }}>{strategy.title}</div>
                  <span style={{ color: strategy.color, border: `1px solid ${strategy.color}55`, background: `${strategy.color}14`, borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{strategy.bias}</span>
                </div>
                <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>{strategy.bestWhen}</div>
              </div>
              <StrategyPayoffDiagram type={strategy.diagram} color={strategy.color} C={C} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 12 }}>
              <GuideFact C={C} label="IV" value={strategy.iv} />
              <GuideFact C={C} label="Earnings" value={strategy.earnings} />
              <GuideFact C={C} label="DTE" value={strategy.dte} />
              <GuideFact C={C} label="Risk" value={strategy.risk} />
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10, color: C.red, fontSize: 12, lineHeight: 1.45 }}>
              Avoid: <span style={{ color: C.muted }}>{strategy.avoid}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...cell, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} style={{ color: C.amber }} />
          <span style={{ color: C.text, fontWeight: 800 }}>Quick Selection Rules</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <GuideRule C={C} label="Bullish + Low IV" value="Long Call or Call Debit Spread" color={C.green} />
          <GuideRule C={C} label="Bearish + Low IV" value="Long Put or Put Debit Spread" color={C.red} />
          <GuideRule C={C} label="Bullish + High IV" value="Bull Put Credit Spread" color={C.amber} />
          <GuideRule C={C} label="Bearish + High IV" value="Bear Call Credit Spread" color={C.amber} />
          <GuideRule C={C} label="Range + Time Decay" value="Calendar Spread near expected pin" color={C.purple} />
          <GuideRule C={C} label="Earnings Imminent" value="Defined risk only; smaller size; avoid naked long premium" color={C.red} />
        </div>
      </div>
    </div>
  )
}

function GuideFact({ C, label, value }: { C: Palette; label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.bgPanel, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
      <div style={{ color: C.text, fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function GuideRule({ C, label, value, color }: { C: Palette; label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.bgPanel, borderRadius: 9, padding: '9px 10px' }}>
      <div style={{ color, fontSize: 11, fontWeight: 800 }}>{label}</div>
      <div style={{ color: C.text, fontSize: 12, marginTop: 3 }}>{value}</div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function TickerPage() {
  const {
    pendingTicker, pendingAnalysisOptions, clearPendingTicker,
    getCached, setCached, tickerCache,
    fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
    theme, navigate,
  } = useApp()

  const C = theme === 'light' ? C_LIGHT : C_DARK

  const [data,          setData]          = useState<AnalyzeResponse | null>(null)
  const [unifiedAnalysis, setUnifiedAnalysis] = useState<UnifiedAnalysis | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'chart' | 'calculator' | 'guide' | null>(null)
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
  const [selectedRank, setSelectedRank] = useState<number | null>(null)

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
          {/* Page header */}
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${C.violet}20`, border: `1px solid ${C.violet}60`, color: C.violet }}>
                  <Layers size={16} />
                </div>
                <h1 className="text-sm font-bold tracking-tight" style={{ color: C.text }}>Position Trading</h1>
                <span className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ background: `${C.violet}15`, border: `1px solid ${C.violet}40`, color: C.violet }}>Regular</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug" style={{ color: C.muted }}>Multi-week options — strikes, spreads, R:R, EV scoring, and pre-trade checklist.</p>
            </div>
          </div>

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
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
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
                  ⚠️ IV {(displayData.signals.iv_rank ?? 0).toFixed(0)}%
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
              C={C}
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }
@keyframes tdPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
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




            {/* Ticker header bar */}
            <div className="dt-card" style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="dt-primary" style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: C.text }}>{displayData.ticker}</span>
                  {displayData.company_name && <span className="dt-muted" style={{ fontSize: '0.78rem', color: C.muted }}>{displayData.company_name}</span>}
                  <span className="dt-primary" style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: C.text }}>${(displayData.signals.current_price ?? 0).toFixed(2)}</span>
                  {displayData.signals.price_change != null && (
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: displayData.signals.price_change >= 0 ? '#00E5A0' : '#FF4D6D' }}>
                      {displayData.signals.price_change >= 0 ? '▲' : '▼'} {Math.abs(displayData.signals.price_change ?? 0).toFixed(2)} ({(displayData.signals.price_change_pct ?? 0) > 0 ? '+' : ''}{(displayData.signals.price_change_pct ?? 0).toFixed(2)}%)
                    </span>
                  )}
                  {!!displayData.signals.ext_market_price && (
                    <>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 20, border: '1px solid #6B7FD4', color: '#6B7FD4', background: 'rgba(107,127,212,0.08)' }}>
                        {displayData.signals.ext_market_type === 'pre' ? 'Pre' : 'AH'}
                      </span>
                      <span className="dt-primary" style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: C.text }}>${displayData.signals.ext_market_price.toFixed(2)}</span>
                      {!!displayData.signals.ext_market_change && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: (displayData.signals.ext_market_change ?? 0) >= 0 ? '#00A86B' : '#D0312D' }}>
                          {(displayData.signals.ext_market_change ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(displayData.signals.ext_market_change ?? 0).toFixed(2)} ({(displayData.signals.ext_market_change_pct ?? 0) >= 0 ? '+' : ''}{(displayData.signals.ext_market_change_pct ?? 0).toFixed(2)}%)
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: C.muted }}>Bias</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: displayData.signals.directional_bias?.includes('Bullish') ? '#00A86B' : displayData.signals.directional_bias?.includes('Bearish') ? '#D0312D' : '#6B7280' }}>{displayData.signals.directional_bias || '—'}</div>
                  <div style={{ fontSize: '0.6rem', color: C.muted }}>{displayData.signals.bias_confidence ?? 0}%</div>
                </div>
              </div>
            </div>

            {/* Verdict card + signals */}
            {unifiedAnalysis && (
              <UnifiedVerdictCard analysis={unifiedAnalysis} />
            )}
            {/* Checklist veto override — shown when ALL recommendations fail the pre-trade checklist */}
            {displayData.recommendations.length > 0 && displayData.recommendations.every(rec =>
              deriveVerdict(buildChecklist(rec, displayData.signals)) === 'NO GO'
            ) && (() => {
              const hardFails = [...new Set(displayData.recommendations.flatMap(rec =>
                buildChecklist(rec, displayData.signals)
                  .filter(i => i.status === 'fail' && i.hard)
                  .map(i => i.label)
              ))]
              return (
                <div style={{ marginTop: unifiedAnalysis ? -4 : 0, marginBottom: 10, borderRadius: 10, border: '1px solid rgba(208,49,45,0.5)', background: 'rgba(208,49,45,0.07)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span>🚫</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#D0312D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Checklist Veto — Verdict Overridden to AVOID
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: '#EF4444', margin: 0, lineHeight: 1.5 }}>
                    The engine sees a setup, but the pre-trade checklist blocks all {displayData.recommendations.length} recommendation{displayData.recommendations.length !== 1 ? 's' : ''}. Stand aside until the checklist clears.
                    {hardFails.length > 0 && ` Blocking: ${hardFails.join(' · ')}.`}
                  </p>
                </div>
              )
            })()}
            {(() => {
              const s = displayData.signals
              const rsiColor = s.rsi >= 70 ? '#D0312D' : s.rsi <= 30 ? '#00A86B' : C.text
              const ivColor = s.iv_rank >= 65 ? '#D0312D' : s.iv_rank < 35 ? '#00A86B' : '#D4A017'
              const pill: React.CSSProperties = { fontSize: '0.68rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontFamily: 'monospace', border: '1px solid rgba(148,163,184,0.2)' }
              return (
              <div className="dt-card" style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ ...pill, color: s.trend?.includes('Bullish') ? '#00A86B' : s.trend?.includes('Bearish') ? '#D0312D' : '#6B7280' }}>Trend: {s.trend}</span>
                  <span style={{ ...pill, color: rsiColor }}>RSI: {(s.rsi ?? 0).toFixed(1)} {s.rsi_signal}</span>
                  <span style={{ ...pill, color: ivColor }}>IV Rank: {(s.iv_rank ?? 0).toFixed(0)}% {s.iv_environment}</span>
                  <span style={{ ...pill, color: s.iv_vs_hv > 0 ? '#D0312D' : '#00A86B' }}>IV/HV: {s.iv_vs_hv > 0 ? '+' : ''}{(s.iv_vs_hv ?? 0).toFixed(1)}% ({s.iv_vs_hv > 0 ? 'rich' : 'cheap'})</span>
                  <span style={{ ...pill, color: s.pcr_signal === 'Bearish' ? '#D0312D' : s.pcr_signal === 'Bullish' ? '#00A86B' : '#6B7280' }}>P/C: {(s.put_call_ratio ?? 0).toFixed(2)} {s.pcr_signal}</span>
                  <span style={{ ...pill, color: s.volatility_regime === 'Sell Premium' ? '#D4A017' : s.volatility_regime === 'Buy Premium' ? '#00A86B' : C.text }}>Vol: {s.volatility_regime}</span>
                </div>
                {s.volatility_regime && (
                  <div style={{ marginTop: 6, fontSize: '0.72rem', color: s.volatility_regime === 'Sell Premium' ? '#D4A017' : '#00A86B' }}>
                    {s.volatility_regime === 'Sell Premium' ? '⚡' : '💰'} IV Rank {(s.iv_rank ?? 0).toFixed(0)}% · {s.volatility_regime === 'Sell Premium' ? `IV ${(s.iv_vs_hv ?? 0).toFixed(1)}% above HV · Credit strategies favored` : 'Options relatively cheap · Debit strategies favored'}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  <span style={{ fontSize: '0.68rem', color: C.muted, alignSelf: 'center' }}>MAs:</span>
                  <span style={{ ...pill, color: s.above_ma20 ? '#00A86B' : '#D0312D' }}>{s.above_ma20 ? '▲' : '▼'} MA20 ${(s.ma20 ?? 0).toFixed(0)}</span>
                  <span style={{ ...pill, color: s.above_ma50 ? '#00A86B' : '#D0312D' }}>{s.above_ma50 ? '▲' : '▼'} MA50 ${(s.ma50 ?? 0).toFixed(0)}</span>
                  <span style={{ ...pill, color: s.above_ma200 ? '#00A86B' : '#D0312D' }}>{s.above_ma200 ? '▲' : '▼'} MA200 ${(s.ma200 ?? 0).toFixed(0)}</span>
                  <span style={{ ...pill, color: s.ma50_slope > 0 ? '#00A86B' : '#D0312D' }}>MA50 slope: {s.ma50_slope > 0 ? '↑' : '↓'} {Math.abs(s.ma50_slope).toFixed(2)}%</span>
                  <span style={{ ...pill, color: s.macd_crossover === 'Bullish' ? '#00A86B' : s.macd_crossover === 'Bearish' ? '#D0312D' : '#6B7280' }}>MACD: {s.macd_crossover === 'None' ? 'No crossover' : s.macd_crossover + ' crossover'}</span>
                </div>
              </div>
              )
            })()}

            {/* Context line: rec breakdown — uses selectedData for accurate counts */}
            {selectedData?.recommendations && selectedData.recommendations.length > 0 && (
            (() => {
              const entryCount = selectedData.recommendations.filter(r => {
                const score = r.scores?.total_score ?? 0
                const rec = r as any
                const allFilters = rec.passes_liquidity_filter !== false && rec.passes_iv_filter !== false
                return score >= 70 && allFilters
              }).length
              const setupCount = selectedData.recommendations.filter(r => {
                const score = r.scores?.total_score ?? 0
                const rec = r as any
                if (score >= 70) return false // already counted as entry
                return score >= 55 && rec.passes_liquidity_filter
              }).length
              return (
                <div style={{ marginTop: 6, marginBottom: 10, fontSize: '11px', color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {entryCount > 0 && <span style={{ background: 'rgba(0,229,160,0.1)', color: '#00E5A0', border: '1px solid rgba(0,229,160,0.25)', borderRadius: 4, padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>{entryCount} ready to enter</span>}
                  {setupCount > 0 && <span style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 4, padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>{setupCount} setting up</span>}
                  {entryCount === 0 && setupCount === 0 && <span style={{ color: C.muted }}>No structures ready yet — conditions still forming</span>}
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
                      background: C.violet, color: C.textInv, border: 'none',
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

                        const ivRank = (selectedData as unknown as { signals?: { iv_rank?: number } })?.signals?.iv_rank ?? 0
                        const ivFit = isCredit ? ivRank >= 30 : ivRank < 50
                        // Single trade state — used for BOTH the table badge AND the expanded card.
                        const _v = deriveVerdict(buildChecklist(rec, displayData.signals))
                        const tradeState = deriveRegularTradeState(rec, displayData.signals, _v)
                        const status = tradeState.num === 'STATE 2' ? 'ENTER' : tradeState.num === 'STATE 1' ? 'SETUP' : tradeState.num
                        const statusColor = status === 'ENTER' ? C.green : status === 'SETUP' ? '#3B82F6' : status === 'WAIT' ? C.amber : status === 'WATCH' ? C.purple : C.red
                        const isExpanded = selectedRank === rec.rank
                        return (
                          <React.Fragment key={rec.rank}>
                            {rec.legs.map((leg, li: number) => (
                              <tr key={`${rec.rank}-${li}`} onClick={() => setSelectedRank(isExpanded ? null : rec.rank)} style={{ borderBottom: isExpanded && li === rec.legs.length - 1 ? 'none' : `1px solid ${C.border}`, cursor: 'pointer', background: isExpanded ? 'rgba(74,124,255,0.06)' : undefined }}>
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', verticalAlign: 'top', color: C.violet, fontWeight: 700, fontFamily: 'monospace' }}>{rec.rank}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                                  <div style={{ color: C.text, fontWeight: 600, fontSize: '0.82rem' }}>{rec.strategy}</div>
                                  <div style={{ color: isCredit ? C.green : C.red, fontSize: '0.7rem', fontFamily: 'monospace', marginTop: 2 }}>{isCredit ? `Credit $${Math.abs(rec.net_credit ?? 0).toFixed(2)}` : `Debit $${Math.abs(rec.net_credit ?? 0).toFixed(2)}`}</div>
                                  <div style={{ color: C.muted, fontSize: '0.65rem', marginTop: 1 }}>{rec.expiry.slice(5)} · {rec.dte}dte</div>
                                </td>)}
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600, color: leg.action === 'BUY' ? C.green : C.red }}>{leg.action}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: C.text }}>{leg.option_type}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: C.text, textAlign: 'right' }}>${(leg.strike ?? 0).toFixed(2)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: C.muted, fontSize: '0.72rem' }}>{leg.expiry.slice(5)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: leg.action === 'BUY' ? C.red : C.green, textAlign: 'right' }}>${(leg.mid_price * 100).toFixed(2)}</td>
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: C.green }}>${(rec.max_profit * 100).toFixed(2)}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: rr > 0 && rr <= 3 ? C.green : rr > 0 ? C.amber : C.muted }}>{rr > 0 ? `1:${rr.toFixed(1)}` : '—'}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: scoreColor(score, C) }}>{score || '—'}</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700, color: C.amber }}>{(rec.prob_of_profit * 100).toFixed(0)}%</td>)}
                                {li === 0 && (<td rowSpan={rec.legs.length} style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'top' }}>
                                  <span
                                    title={tradeState.missing.length > 0 ? `${tradeState.sublabel} · Missing: ${tradeState.missing.join(', ')}` : tradeState.sublabel}
                                    style={{ display: 'inline-block', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: statusColor, border: `1px solid ${statusColor}`, background: status === 'ENTER' ? 'rgba(0,229,160,0.08)' : status === 'SETUP' ? 'rgba(59,130,246,0.08)' : status === 'WATCH' ? 'rgba(107,127,212,0.08)' : status === 'AVOID' ? 'rgba(255,77,109,0.08)' : 'rgba(245,166,35,0.08)', cursor: 'help' }}
                                  >{status}</span>
                                </td>)}
                              </tr>
                            ))}
                            {isExpanded && (
                              <tr style={{ background: 'rgba(74,124,255,0.02)', borderBottom: `1px solid ${C.border}` }}>
                                <td colSpan={12} style={{ padding: '2px 0 0' }}>
                                  <RecommendationCard
                                    rec={rec}
                                    ticker={displayData.ticker}
                                    companyName={displayData.company_name ?? displayData.ticker}
                                    currentPrice={displayData.signals.current_price}
                                    signals={displayData.signals}
                                    initialOpen={true}
                                    detailOnly={true}
                                  />
                                </td>
                              </tr>
                            )}
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
                <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
                  {(['chart', 'calculator', 'guide'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      style={{
                        flex: 1,
                        minWidth: 140,
                        padding: '10px 16px',
                        background: activeTab === t ? 'rgba(74,124,255,0.05)' : 'transparent',
                        border: 'none',
                        borderBottom: activeTab === t ? `2px solid ${C.accent}` : '2px solid transparent',
                        color: activeTab === t ? C.text : C.muted,
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {t === 'chart' ? '📉 Candlestick' : t === 'calculator' ? '📈 P&L Calculator' : '📚 Strategy Guide'}
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
                    <StrategyGuideTab C={C} />
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
                  📊 Show Chart, P&amp;L &amp; Strategy Guide
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
