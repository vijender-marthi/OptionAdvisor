import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate as useRouterNavigate } from 'react-router-dom'
import { Search, Database, Layers, AlertTriangle, BookOpen, ArrowUpRight } from 'lucide-react'
import { analyzeOptions } from '../api/client'
import type { AnalyzeResponse, Recommendation, Signals, StrategyMode, TickerCacheEntry } from '../types'
import { deriveRegularTradeState } from '../components/RecommendationCard'
import { isCacheFresh, cacheAge } from '../types'
import TickerInput from '../components/TickerInput'
import SignalPanel from '../components/SignalPanel'
import PriceChart from '../components/PriceChart'
import OptionProfitCalculator from '../components/OptionProfitCalculator'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'
import { OA_LAST_OPTION_ANALYSIS_KEY } from '../constants/storageKeys'
import { formatTickerTitle, useDocumentTitle } from '../hooks/useDocumentTitle'
import { getTradeWorksheetRoute } from '../routing/routes'

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

const fmtMoney = (v: number | null | undefined) =>
  Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'

const fmtPct = (v: number | null | undefined) =>
  Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(0)}%` : '—'

type DecisionAction = 'GO' | 'WAIT' | 'AVOID' | 'MANAGE POSITION'

interface RecommendationView {
  rec: Recommendation
  checklist: ReturnType<typeof buildChecklist>
  verdict: Verdict
  tradeState: ReturnType<typeof deriveRegularTradeState>
  hardFails: string[]
  softIssues: string[]
}

interface DecisionSummary {
  action: DecisionAction
  score: number
  confidence: number
  primaryReason: string
  blockingReason: string | null
  bestSetup: string
  whyItWorks: string[]
  mainRisk: string
  selected: RecommendationView | null
  rows: RecommendationView[]
}

const sentence = (value: string | undefined, fallback: string) => {
  const clean = (value ?? '').trim()
  if (!clean) return fallback
  return clean.split(/(?<=[.!?])\s+/)[0] || fallback
}

const strategyFamily = (strategy: string) => {
  if (/calendar|diagonal/i.test(strategy)) return 'Time Decay'
  if (/straddle|strangle/i.test(strategy)) return 'Volatility'
  if (/covered|cash secured|short put|short call/i.test(strategy)) return 'Stock Strategies'
  if (/credit|condor/i.test(strategy)) return 'Income'
  if (/call|put|debit/i.test(strategy)) return 'Directional'
  return 'Auto'
}

const eligibilityFor = (rec: Recommendation) => {
  const strategy = rec.strategy || ''
  if (/covered call/i.test(strategy)) return { label: 'Needs 100 shares', status: 'verify' as const }
  if (/cash secured put|short put/i.test(strategy)) return { label: 'Needs buying power', status: 'verify' as const }
  if (/spread|condor|calendar|diagonal/i.test(strategy)) return { label: 'Options approval', status: 'verify' as const }
  return { label: 'Eligible', status: 'ok' as const }
}

function buildDecisionSummary(data: AnalyzeResponse | null | undefined, selectedRank: number | null): DecisionSummary | null {
  if (!data) return null
  const rows = data.recommendations.map(rec => {
    const checklist = buildChecklist(rec, data.signals)
    const verdict = deriveVerdict(checklist)
    const tradeState = deriveRegularTradeState(rec, data.signals, verdict)
    return {
      rec,
      checklist,
      verdict,
      tradeState,
      hardFails: checklist.filter(item => item.status === 'fail' && item.hard).map(item => item.label),
      softIssues: checklist.filter(item => item.status !== 'pass').map(item => item.label),
    }
  })
  const selected = rows.find(row => row.rec.rank === selectedRank) ?? rows[0] ?? null
  const bestRow = rows.find(row => row.verdict === 'GO') ?? rows.find(row => row.verdict === 'CAUTION') ?? selected
  const allBlocked = rows.length > 0 && rows.every(row => row.verdict === 'NO GO')
  const action: DecisionAction =
    rows.length === 0 ? 'AVOID' :
    allBlocked ? 'AVOID' :
    rows.some(row => row.verdict === 'GO') ? 'GO' :
    rows.some(row => row.verdict === 'CAUTION') ? 'WAIT' :
    'AVOID'
  const hardFails = [...new Set(rows.flatMap(row => row.hardFails))]
  const softIssues = [...new Set(rows.flatMap(row => row.softIssues))]
  const score = Math.round(Math.max(0, ...rows.map(row => row.rec.scores?.total_score ?? 0)))
  const confidence = Math.round(data.signals.bias_confidence ?? score)
  const bestSetup = bestRow?.rec.strategy ?? 'No valid setup'
  const whyItWorks = bestRow
    ? bestRow.checklist.filter(item => item.status === 'pass').slice(0, 3).map(item => item.label)
    : []
  const riskItem = bestRow?.checklist.find(item => item.status === 'fail') ?? bestRow?.checklist.find(item => item.status === 'warn')
  const blockingReason =
    hardFails[0] ??
    (allBlocked ? (softIssues[0] ?? 'Checklist did not clear') : null)
  const primaryReason =
    action === 'GO'
      ? sentence(bestRow?.rec.rationale, `${bestSetup} has the strongest current setup.`)
      : action === 'WAIT'
      ? `${bestSetup} is forming, but confirmation is not complete.`
      : blockingReason
      ? `Trade blocked by ${blockingReason}.`
      : 'No recommendation currently clears the engine filters.'
  return {
    action,
    score,
    confidence,
    primaryReason,
    blockingReason,
    bestSetup,
    whyItWorks,
    mainRisk: riskItem?.detail ?? bestRow?.rec.warnings?.[0] ?? 'Standard options decay, liquidity, and execution risk.',
    selected,
    rows,
  }
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
  strategy: string
  marketView: string
  bestCase: string
  whenToUse: string
  iv: string
  earnings: string
  dte: string
  avoid: string
  diagram: 'longCall' | 'longPut' | 'debitSpread' | 'creditSpread' | 'calendar' | 'straddle' | 'ironCondor'
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
    if (type === 'straddle') return 'M18 18 L76 78 L136 18'
    if (type === 'ironCondor') return 'M18 76 L44 76 L60 34 L96 34 L112 76 L136 76'
    return 'M18 68 C46 34 72 22 92 34 C110 45 122 63 136 68'
  })()
  const label = type === 'longCall' ? 'Long Call'
    : type === 'longPut' ? 'Long Put'
    : type === 'debitSpread' ? 'Debit Spread'
    : type === 'creditSpread' ? 'Credit Spread'
    : type === 'straddle' ? 'Straddle'
    : type === 'ironCondor' ? 'Iron Condor'
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
      strategy: 'Long Call',
      marketView: 'Bullish',
      bestCase: 'Strong uptrend with room to run',
      whenToUse: 'Use when price is above MA20/MA50, momentum is rising, and you want uncapped upside. Example: breakout with low IV and strong volume.',
      iv: 'Low to moderate IV, ideally below 50.',
      earnings: 'Avoid before earnings unless the event move is intentional.',
      dte: '21-45 DTE regular trades.',
      avoid: 'Avoid in high IV, flat trend, weak volume, or when price is already extended far above MA20.',
      diagram: 'longCall',
      color: C.green,
    },
    {
      strategy: 'Long Put',
      marketView: 'Bearish',
      bestCase: 'Clean downtrend or failed bounce',
      whenToUse: 'Use when price is below MA20/MA50, rallies reject resistance, and market/sector confirms downside pressure.',
      iv: 'Low to moderate IV, ideally below 50.',
      earnings: 'Avoid pre-earnings unless trading event risk.',
      dte: '21-45 DTE; bearish moves often happen in bursts.',
      avoid: 'Avoid after panic candles, at major support, or with RSI deeply oversold.',
      diagram: 'longPut',
      color: C.red,
    },
    {
      strategy: 'Call / Put Debit Spread',
      marketView: 'Bullish or bearish',
      bestCase: 'Directional move to a realistic target',
      whenToUse: 'Use when direction is good but the outright option is expensive. Example: buy 190 call and sell 200 call when target is near 200.',
      iv: 'Moderate IV, roughly 40-70.',
      earnings: 'Defined risk, but still exposed to gap and IV crush.',
      dte: '21-45 DTE; match short strike to target.',
      avoid: 'Avoid when bid/ask spreads are wide or max profit depends on an unrealistic move.',
      diagram: 'debitSpread',
      color: C.violet,
    },
    {
      strategy: 'Bull Put / Bear Call Credit Spread',
      marketView: 'Directional income',
      bestCase: 'Price respects support or resistance',
      whenToUse: 'Use when IV is elevated and price is unlikely to breach the short strike. Example: sell bull put below support after a pullback holds.',
      iv: 'Best when IV rank is 50+.',
      earnings: 'Only with defined risk, smaller size, and acceptance of gap risk.',
      dte: '14-45 DTE; 21-45 is smoother.',
      avoid: 'Avoid low credit, poor liquidity, binary events without edge, or selling too close to price.',
      diagram: 'creditSpread',
      color: C.amber,
    },
    {
      strategy: 'Calendar Spread',
      marketView: 'Range / time decay',
      bestCase: 'Price pins near one strike',
      whenToUse: 'Use when you expect price to stay near a target strike while the front option decays faster than the back option.',
      iv: 'Best when back-month IV is reasonable and front-month decay is attractive.',
      earnings: 'Advanced only around earnings; term structure and gap risk matter.',
      dte: 'Sell near expiry, buy later expiry.',
      avoid: 'Avoid strong trend days, poor liquidity, or when price is likely to move far away from the short strike.',
      diagram: 'calendar',
      color: C.purple,
    },
    {
      strategy: 'Long Straddle',
      marketView: 'Big move, direction unknown',
      bestCase: 'Large move expected either way',
      whenToUse: 'Use when a catalyst may create a large move but direction is unclear. Example: major earnings, FDA, legal ruling, or macro event.',
      iv: 'Best before IV becomes too expensive; compare expected move to premium paid.',
      earnings: 'Common earnings structure, but IV crush is the main risk.',
      dte: 'Use expiry that covers the catalyst, often 7-30 DTE.',
      avoid: 'Avoid when IV is already extreme and expected move is smaller than total premium paid.',
      diagram: 'straddle',
      color: C.accent,
    },
    {
      strategy: 'Iron Condor',
      marketView: 'Neutral range',
      bestCase: 'Price stays between short strikes',
      whenToUse: 'Use when trend is flat, RSI is mid-range, IV is elevated, and support/resistance define a clear range.',
      iv: 'Best when IV rank is high enough to collect worthwhile credit.',
      earnings: 'Avoid earnings unless very small and defined-risk; gaps can jump over wings.',
      dte: '21-45 DTE is preferred.',
      avoid: 'Avoid strong trend, breakout setups, low credit, or when one side is too close to current price.',
      diagram: 'ironCondor',
      color: C.amber,
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

      <div style={{ ...cell, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1180, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ background: C.bgPanel }}>
                {['Strategy', 'Best Case', 'When To Use', 'IV / DTE', 'Earnings', 'Avoid', 'Diagram'].map(h => (
                  <th key={h} style={{ color: C.muted, fontSize: 10, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '11px 12px', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strategies.map(strategy => (
                <tr key={strategy.strategy}>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', width: 170 }}>
                    <div style={{ color: strategy.color, fontWeight: 900, fontSize: 13 }}>{strategy.strategy}</div>
                    <div style={{ marginTop: 5, display: 'inline-flex', color: strategy.color, border: `1px solid ${strategy.color}55`, background: `${strategy.color}14`, borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{strategy.marketView}</div>
                  </td>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', color: C.text, fontSize: 12, lineHeight: 1.45, width: 160 }}>{strategy.bestCase}</td>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', color: C.text, fontSize: 12, lineHeight: 1.45, width: 280 }}>{strategy.whenToUse}</td>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', color: C.text, fontSize: 12, lineHeight: 1.45, width: 190 }}>
                    <div><span style={{ color: C.muted }}>IV:</span> {strategy.iv}</div>
                    <div style={{ marginTop: 6 }}><span style={{ color: C.muted }}>DTE:</span> {strategy.dte}</div>
                  </td>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', color: C.text, fontSize: 12, lineHeight: 1.45, width: 180 }}>{strategy.earnings}</td>
                  <td style={{ padding: 12, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', color: C.text, fontSize: 12, lineHeight: 1.45, width: 220 }}>{strategy.avoid}</td>
                  <td style={{ padding: 10, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', width: 170 }}>
                    <StrategyPayoffDiagram type={strategy.diagram} color={strategy.color} C={C} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <GuideRule C={C} label="Big Move, Direction Unknown" value="Long Straddle only if expected move exceeds total premium" color={C.accent} />
          <GuideRule C={C} label="Flat Range + High IV" value="Iron Condor between support and resistance" color={C.amber} />
          <GuideRule C={C} label="Earnings Imminent" value="Defined risk only; smaller size; avoid naked long premium" color={C.red} />
        </div>
      </div>
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
    fetchAllWeeks, fetchingAllWeeks,
    theme, navigate,
  } = useApp()
  const routerNavigate = useRouterNavigate()

  const C = theme === 'light' ? C_LIGHT : C_DARK

  const [data,          setData]          = useState<AnalyzeResponse | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'chart' | 'calculator' | null>(null)
  const [pageTab,       setPageTab]       = useState<'active' | 'strategy'>('active')
  const [fromCache,     setFromCache]     = useState<{ age: number; fresh: boolean } | null>(null)
  const [staleSnapshotInfo, setStaleSnapshotInfo] = useState<{ cachedAt: number; errorDetail: string } | null>(null)
  const [lastWeeks,     setLastWeeks]     = useState(4)
  const [lastWidth,     setLastWidth]     = useState<number | null>(null)
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
    spreadWidth: number | null = null,
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
    spreadWidth: number | null = null,
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
      const spreadWidth = pendingAnalysisOptions?.spreadWidth ?? null
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
  const selectedData = data
  const displayData = data
  useDocumentTitle(formatTickerTitle(displayData?.ticker || inputTicker, 'Position Trading'))
  const preTradeRoute = useMemo(() => {
    const rec = displayData?.recommendations?.find(r => r.rank === selectedRank) ?? displayData?.recommendations?.[0]
    const rawBias = rec?.bias || displayData?.signals?.directional_bias || ''
    const direction = /bear|put|short/i.test(rawBias) ? 'Bearish' : /bull|call|long/i.test(rawBias) ? 'Bullish' : null
    const strategy = rec?.strategy || (direction === 'Bearish' ? 'Long Put' : direction === 'Bullish' ? 'Long Call' : null)
    return getTradeWorksheetRoute({ ticker: displayData?.ticker || inputTicker, direction, strategy, source: 'regular' })
  }, [displayData, inputTicker, selectedRank])
  const decisionSummary = useMemo(() => buildDecisionSummary(displayData, selectedRank), [displayData, selectedRank])

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
  const [advancedSignalsOpen, setAdvancedSignalsOpen] = useState(false)

  return (
    <div className="ticker-page min-h-screen p-4 md:p-6" style={{ background: C.bgPage }}>
      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${C.violet}20`, border: `1px solid ${C.violet}60`, color: C.violet }}>
              <Layers size={17} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ color: C.text }}>Position Trading</h1>
              <p className="text-xs" style={{ color: C.muted }}>Position options workflow and strategy playbook.</p>
            </div>
          </div>
        </div>
        <div className="flex rounded-xl border p-1" style={{ borderColor: C.border, background: C.bgPanel }}>
          <button
            type="button"
            onClick={() => routerNavigate(preTradeRoute)}
            className="mr-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors"
            style={{ color: C.green, border: `1px solid ${C.green}55`, background: `${C.green}12` }}
            title="Open Pre-Trade Analysis"
          >
            <ArrowUpRight size={14} />
            Pre-Trade Analysis
          </button>
          {[
            { id: 'active' as const, label: 'Active Position Trading', icon: <Search size={14} /> },
            { id: 'strategy' as const, label: 'Strategy Guide', icon: <BookOpen size={14} /> },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPageTab(tab.id)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors"
              style={{
                background: pageTab === tab.id ? `${C.violet}20` : 'transparent',
                color: pageTab === tab.id ? C.text : C.muted,
                border: `1px solid ${pageTab === tab.id ? `${C.violet}55` : 'transparent'}`,
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {pageTab === 'strategy' ? (
        <div className="mx-auto max-w-6xl">
          <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-widest" style={{ color: C.violet }}>Strategy Guide</div>
                <h2 className="mt-1 text-2xl font-bold" style={{ color: C.text }}>Best structures for regular position trades</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6" style={{ color: C.muted }}>
                  Use this guide before selecting a contract. Match direction, IV, earnings risk, and expected hold period before choosing long options, debit spreads, credit spreads, or calendars.
                </p>
              </div>
            </div>
            <StrategyGuideTab C={C} />
          </div>
        </div>
      ) : (
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

            {decisionSummary && (() => {
              const verdictColor =
                decisionSummary.action === 'GO' ? C.green :
                decisionSummary.action === 'WAIT' ? C.amber :
                decisionSummary.action === 'MANAGE POSITION' ? C.accent :
                C.red
              const s = displayData.signals
              const selected = decisionSummary.selected
              const blocked = decisionSummary.action === 'AVOID' && !!decisionSummary.blockingReason
              const compactMetric: React.CSSProperties = {
                border: `1px solid ${C.border}`,
                background: C.bgCard,
                borderRadius: 10,
                padding: '10px 12px',
                minHeight: 64,
              }
              return (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ background: C.bgPanel, border: `1px solid ${verdictColor}55`, borderRadius: 16, padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 220, flex: 1 }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>Final Verdict</div>
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ color: verdictColor, fontSize: '2rem', lineHeight: 1, fontWeight: 900, letterSpacing: '-0.03em' }}>{decisionSummary.action}</span>
                          <span style={{ color: C.text, fontSize: '0.95rem', fontWeight: 800 }}>{decisionSummary.bestSetup}</span>
                        </div>
                        <p style={{ margin: '10px 0 0', color: C.text, fontSize: '0.92rem', lineHeight: 1.55 }}>{decisionSummary.primaryReason}</p>
                        {decisionSummary.blockingReason && (
                          <div style={{ marginTop: 10, color: C.red, fontSize: '0.8rem', fontWeight: 800 }}>
                            Blocking reason: {decisionSummary.blockingReason}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(96px, 1fr))', gap: 8, minWidth: 220 }}>
                        <div style={compactMetric}>
                          <div style={{ color: C.muted, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Score</div>
                          <div style={{ color: scoreColor(decisionSummary.score, C), fontSize: '1.25rem', fontWeight: 900, fontFamily: 'monospace' }}>{decisionSummary.score || '—'}</div>
                        </div>
                        <div style={compactMetric}>
                          <div style={{ color: C.muted, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Confidence</div>
                          <div style={{ color: C.text, fontSize: '1.25rem', fontWeight: 900, fontFamily: 'monospace' }}>{decisionSummary.confidence}%</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    <div style={compactMetric}>
                      <div style={{ color: C.muted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Best Setup</div>
                      <div style={{ color: C.text, fontSize: '0.98rem', fontWeight: 850, marginTop: 5 }}>{decisionSummary.bestSetup}</div>
                      <div style={{ color: C.muted, fontSize: '0.72rem', marginTop: 4 }}>{strategyFamily(decisionSummary.bestSetup)}</div>
                    </div>
                    <div style={compactMetric}>
                      <div style={{ color: C.muted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Why It Works</div>
                      <div style={{ color: C.text, fontSize: '0.78rem', marginTop: 5, lineHeight: 1.45 }}>
                        {decisionSummary.whyItWorks.length ? decisionSummary.whyItWorks.join(' · ') : 'No confirmation has cleared yet.'}
                      </div>
                    </div>
                    <div style={compactMetric}>
                      <div style={{ color: C.muted, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Main Risk</div>
                      <div style={{ color: C.text, fontSize: '0.78rem', marginTop: 5, lineHeight: 1.45 }}>{sentence(decisionSummary.mainRisk, 'Standard options decay and execution risk.')}</div>
                    </div>
                  </div>

                  {blocked && selected && (
                    <div style={{ borderRadius: 12, border: `1px solid ${C.red}66`, background: 'rgba(208,49,45,0.07)', padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: C.red, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Trade Blocked</div>
                      <div style={{ marginTop: 5, color: C.text, fontSize: '0.84rem', fontWeight: 800 }}>{decisionSummary.blockingReason}</div>
                      <div style={{ marginTop: 5, color: C.muted, fontSize: '0.76rem', lineHeight: 1.5 }}>
                        What must improve: {selected.softIssues.slice(0, 3).join(' · ') || 'Checklist confirmation'}.
                        Recheck after liquidity, trend, or risk conditions update.
                      </div>
                    </div>
                  )}

                  <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.violet }}>AI Reasoning</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10 }}>
                      {[
                        ['Trend', s.trend || s.directional_bias || 'Mixed'],
                        ['IV Rank', `${(s.iv_rank ?? 0).toFixed(0)}% ${s.iv_environment ?? ''}`.trim()],
                        ['Liquidity', selected?.rec.passes_liquidity_filter ? 'Pass' : 'Needs work'],
                        ['Expected Value', selected ? fmtMoney(selected.rec.expected_value * 100) : '—'],
                        ['Best Strategy', decisionSummary.bestSetup],
                        ['Final Decision', decisionSummary.action],
                      ].map(([label, value]) => (
                        <div key={label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                          <div style={{ color: C.muted, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 800 }}>{label}</div>
                          <div style={{ color: C.text, fontSize: '0.78rem', fontWeight: 800, marginTop: 3 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <p style={{ color: C.muted, fontSize: '0.78rem', margin: '10px 0 0', lineHeight: 1.5 }}>{decisionSummary.primaryReason}</p>
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
                  <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.accent }}>Strategy Rankings</span>
                  <span style={{ fontSize: '11px', color: C.muted, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 20, padding: '2px 10px' }}>
                    {selectedData?.recommendations.length ?? 0} trades passed all filters
                  </span>
                </div>

              {displayData.recommendations.length === 0 ? (
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
                <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto', background: C.bgPanel }}>
                  <table style={{ minWidth: 980, width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.78rem', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ background: C.bgPanel }}>
                        {['Rank', 'Strategy', 'Eligibility', 'Action', 'Strike / Expiry', 'Credit / Debit', 'Max Profit', 'Max Loss', 'Breakeven', 'PoP', 'Status'].map((header, idx) => (
                          <th key={header} style={{
                            width: idx === 1 ? '18%' : idx === 4 ? '14%' : idx === 8 ? '12%' : '8%',
                            padding: '10px 10px',
                            textAlign: idx >= 5 && idx <= 9 ? 'right' : idx === 10 ? 'center' : 'left',
                            color: C.muted,
                            fontWeight: 800,
                            fontSize: '0.66rem',
                            letterSpacing: '0.07em',
                            textTransform: 'uppercase',
                            borderBottom: `1px solid ${C.border}`,
                            whiteSpace: 'nowrap',
                          }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.recommendations.map(rec => {
                        const isCredit = (rec.net_credit ?? 0) > 0
                        const score = rec.scores?.total_score ?? 0
                        const _v = deriveVerdict(buildChecklist(rec, displayData.signals))
                        const tradeState = deriveRegularTradeState(rec, displayData.signals, _v)
                        const status = _v === 'NO GO' ? 'AVOID' : tradeState.num === 'STATE 2' ? 'GO' : tradeState.num === 'STATE 1' ? 'WAIT' : tradeState.num
                        const statusColor = status === 'GO' ? C.green : status === 'SETUP' ? '#3B82F6' : status === 'WAIT' ? C.amber : status === 'WATCH' ? C.purple : C.red
                        const isExpanded = selectedRank === rec.rank
                        const eligibility = eligibilityFor(rec)
                        const firstLeg = rec.legs[0]
                        const breakeven = rec.breakeven_lower && rec.breakeven_upper && Math.abs(rec.breakeven_lower - rec.breakeven_upper) > 0.01
                          ? `${fmtMoney(rec.breakeven_lower)} - ${fmtMoney(rec.breakeven_upper)}`
                          : fmtMoney(rec.breakeven_lower || rec.breakeven_upper)
                        return (
                          <React.Fragment key={rec.rank}>
                              <tr onClick={() => setSelectedRank(isExpanded ? null : rec.rank)} style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: isExpanded ? 'rgba(74,124,255,0.07)' : undefined }}>
                                <td style={{ padding: '11px 10px', color: C.violet, fontWeight: 900, fontFamily: 'monospace' }}>{rec.rank}</td>
                                <td style={{ padding: '11px 10px' }}>
                                  <div style={{ color: C.text, fontWeight: 600, fontSize: '0.82rem' }}>{rec.strategy}</div>
                                  <div style={{ color: C.muted, fontSize: '0.66rem', marginTop: 2 }}>{strategyFamily(rec.strategy)} · Score <span style={{ color: scoreColor(score, C), fontFamily: 'monospace', fontWeight: 800 }}>{score || '—'}</span></div>
                                </td>
                                <td style={{ padding: '11px 10px' }}>
                                  <span style={{ color: eligibility.status === 'ok' ? C.green : C.amber, border: `1px solid ${eligibility.status === 'ok' ? C.green : C.amber}55`, background: eligibility.status === 'ok' ? 'rgba(0,229,160,0.08)' : 'rgba(245,166,35,0.08)', borderRadius: 999, padding: '2px 8px', fontSize: '0.66rem', fontWeight: 800, whiteSpace: 'nowrap' }}>{eligibility.label}</span>
                                </td>
                                <td style={{ padding: '11px 10px', fontFamily: 'monospace', fontWeight: 800, color: isCredit ? C.green : C.red }}>{isCredit ? 'SELL' : 'BUY'}</td>
                                <td style={{ padding: '11px 10px', fontFamily: 'monospace', color: C.text }}>
                                  {firstLeg ? `${firstLeg.strike.toFixed(0)} ${firstLeg.option_type}` : '—'}
                                  <div style={{ color: C.muted, fontSize: '0.66rem', marginTop: 2 }}>{rec.expiry.slice(5)} · {rec.dte} DTE</div>
                                </td>
                                <td style={{ padding: '11px 10px', fontFamily: 'monospace', fontWeight: 900, color: isCredit ? C.green : C.red, textAlign: 'right' }}>{isCredit ? 'Cr' : 'Dr'} ${Math.abs(rec.net_credit ?? 0).toFixed(2)}</td>
                                <td style={{ padding: '11px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: C.green }}>{fmtMoney(rec.max_profit * 100)}</td>
                                <td style={{ padding: '11px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: C.red }}>{fmtMoney(rec.max_loss * 100)}</td>
                                <td style={{ padding: '11px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{breakeven}</td>
                                <td style={{ padding: '11px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: C.amber }}>{fmtPct(rec.prob_of_profit)}</td>
                                <td style={{ padding: '11px 10px', textAlign: 'center' }}>
                                  <span
                                    title={tradeState.missing.length > 0 ? `${tradeState.sublabel} · Missing: ${tradeState.missing.join(', ')}` : tradeState.sublabel}
                                    style={{ display: 'inline-block', borderRadius: 999, padding: '3px 9px', fontSize: '0.66rem', fontWeight: 900, fontFamily: 'monospace', color: statusColor, border: `1px solid ${statusColor}`, background: status === 'GO' ? 'rgba(0,229,160,0.08)' : status === 'WAIT' ? 'rgba(245,166,35,0.08)' : status === 'WATCH' ? 'rgba(107,127,212,0.08)' : 'rgba(255,77,109,0.08)', cursor: 'help' }}
                                  >{status}</span>
                                </td>
                              </tr>
                            {isExpanded && (
                              <tr style={{ background: 'rgba(74,124,255,0.02)', borderBottom: `1px solid ${C.border}` }}>
                                <td colSpan={11} style={{ padding: '12px 14px' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                                    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
                                      <div style={{ color: C.muted, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Option Legs</div>
                                      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                                        {rec.legs.map((leg, idx) => (
                                          <div key={`${rec.rank}-leg-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: C.text, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                            <span style={{ color: leg.action === 'BUY' ? C.green : C.red }}>{leg.action} {leg.option_type}</span>
                                            <span>{fmtMoney(leg.strike)} · {leg.expiry.slice(5)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
                                      <div style={{ color: C.muted, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Greeks / Liquidity</div>
                                      <div style={{ marginTop: 6, color: C.text, fontSize: '0.75rem', lineHeight: 1.7 }}>
                                        Delta {rec.short_leg_delta?.toFixed(2) ?? '—'} · OI {rec.legs.reduce((sum, leg) => sum + (leg.oi ?? 0), 0).toLocaleString()} · Vol {rec.legs.reduce((sum, leg) => sum + (leg.volume ?? 0), 0).toLocaleString()}
                                      </div>
                                    </div>
                                    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
                                      <div style={{ color: C.muted, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Margin / Risk</div>
                                      <div style={{ marginTop: 6, color: C.text, fontSize: '0.75rem', lineHeight: 1.7 }}>
                                        Max loss {fmtMoney(rec.max_loss * 100)} · EV {fmtMoney(rec.expected_value * 100)} · R:R {rec.risk_reward_ratio ? `1:${rec.risk_reward_ratio.toFixed(1)}` : '—'}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {decisionSummary?.selected && (() => {
                  const rec = decisionSummary.selected.rec
                  const isCredit = (rec.net_credit ?? 0) > 0
                  const breakeven = rec.breakeven_lower && rec.breakeven_upper && Math.abs(rec.breakeven_lower - rec.breakeven_upper) > 0.01
                    ? `${fmtMoney(rec.breakeven_lower)} - ${fmtMoney(rec.breakeven_upper)}`
                    : fmtMoney(rec.breakeven_lower || rec.breakeven_upper)
                  const payoffColor = decisionSummary.action === 'GO' ? C.green : decisionSummary.action === 'WAIT' ? C.amber : C.red
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(260px, 0.9fr)', gap: 12 }}>
                      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                        <div style={{ color: C.muted, fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Selected Strategy Details</div>
                        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                          {[
                            ['Breakeven', breakeven],
                            ['Current Price', fmtMoney(displayData.signals.current_price)],
                            ['Max Profit', fmtMoney(rec.max_profit * 100)],
                            ['Max Loss', fmtMoney(rec.max_loss * 100)],
                            ['PoP', fmtPct(rec.prob_of_profit)],
                            ['Expected Value', fmtMoney(rec.expected_value * 100)],
                          ].map(([label, value]) => (
                            <div key={label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ color: C.muted, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 800 }}>{label}</div>
                              <div style={{ color: C.text, fontSize: '0.82rem', fontWeight: 850, marginTop: 3, fontFamily: /Price|Profit|Loss|Value|Breakeven/.test(label) ? 'monospace' : undefined }}>{value}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 10, color: C.text, fontSize: '0.8rem', lineHeight: 1.55 }}>
                          <strong>Exit plan:</strong> {rec.exit_plan || (isCredit ? 'Take profits near 50% of credit received and exit if loss reaches 2x credit.' : 'Scale profits into strength and exit if premium loses 30-50%.')}
                        </div>
                      </div>
                      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                        <div style={{ color: C.muted, fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Payoff Snapshot</div>
                        <svg viewBox="0 0 320 140" style={{ width: '100%', height: 150, marginTop: 6, display: 'block' }}>
                          <line x1="20" y1="82" x2="300" y2="82" stroke={C.borderSub} strokeWidth="1" />
                          <line x1="160" y1="18" x2="160" y2="122" stroke={C.borderSub} strokeDasharray="4 4" />
                          <polyline
                            points={isCredit ? '25,42 110,52 160,82 235,96 298,104' : '25,112 105,103 160,82 230,48 298,28'}
                            fill="none"
                            stroke={payoffColor}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <circle cx="160" cy="82" r="4" fill={C.accent} />
                          <text x="160" y="134" fill={C.muted} fontSize="11" textAnchor="middle">Current</text>
                          <text x="24" y="22" fill={C.green} fontSize="11">Profit</text>
                          <text x="24" y="126" fill={C.red} fontSize="11">Loss</text>
                        </svg>
                        <div style={{ color: C.muted, fontSize: '0.74rem', lineHeight: 1.45 }}>
                          Payoff uses the selected strategy shape for quick context. Use Pre-Trade Analysis for full scenario modeling.
                        </div>
                      </div>
                    </div>
                  )
                })()}
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
                  {(['chart', 'calculator'] as const).map(t => (
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
                  📊 Show Chart &amp; P&amp;L Calculator
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
          <button
            type="button"
            onClick={() => setAdvancedSignalsOpen(p => !p)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: C.muted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.76rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: 0,
            }}
          >
            Advanced signal details
            <span style={{ color: C.accent }}>{advancedSignalsOpen ? 'Hide' : 'Show'}</span>
          </button>
          {advancedSignalsOpen && (
            <div style={{ marginTop: 12 }}>
              <SignalPanel signals={displayData.signals} />
            </div>
          )}
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
      )}
    </div>
  )
}
