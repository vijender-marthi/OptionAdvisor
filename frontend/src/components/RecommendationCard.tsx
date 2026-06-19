import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle, Briefcase, Star, Check, TrendingUp, Layers, BookOpen, Zap, Bell } from 'lucide-react'
import type { Recommendation, Signals } from '../types'
import { useApp } from '../contexts/AppContext'
import PreTradeChecklist, { buildChecklist, deriveVerdict, type Verdict } from './PreTradeChecklist'
import { saveToJournal, executeTrade, deskApi, type DeskAlertCreate } from '../api/client'
import SetAlertDrawer from './desk/SetAlertDrawer'

const C = {
  bg:        'var(--surface-canvas)',
  panel:     'var(--surface-card)',
  card:      'var(--surface-elevated)',
  border:    'var(--border-default)',
  borderSub: 'var(--border-subtle)',
  text:      'var(--text-primary)',
  muted:     'var(--text-muted)',
  accent:    '#3B82F6',
  accentDim: 'rgba(59,130,246,0.12)',
  green:     '#00A86B',
  greenDim:  'rgba(0,168,107,0.1)',
  amber:     '#D4A017',
  amberDim:  'rgba(212,160,23,0.1)',
  red:       '#D0312D',
  redDim:    'rgba(208,49,45,0.1)',
  purple:    '#6B7280',
  purpleDim: 'rgba(107,114,128,0.1)',
}

const LABEL_DISPLAY: Record<string, string> = {
  'ENTRY': 'Entry',
  'SETUP': 'Setup',
  'WATCH': 'Watch',
  'AVOID': 'Avoid',
}

interface Props {
  rec: Recommendation
  ticker: string
  companyName: string
  currentPrice: number
  signals: Signals
  onFetchAllWeeks?: () => void
  fetchingAllWeeks?: boolean
  /** When set to this card's rank, scroll into view once and expand. */
  scrollFocusRank?: number | null
  onScrollFocusConsumed?: () => void
}


const biasBadgeClass = (b: string) =>
  b.includes('Bullish') ? 'bg-green-900/50 text-green-400 border-green-700' :
  b.includes('Bearish') ? 'bg-red-900/50 text-red-400 border-red-700' :
  'bg-amber-900/50 text-amber-400 border-amber-700'

const scoreColor = (s: number) =>
  s >= 75 ? 'text-green-400' : s >= 55 ? 'text-amber-400' : 'text-red-400'

// ─── Regular-trade 4-state entry system ────────────────────────────────────

export type RegularState = 2 | 1 | 0 | -1   // 2=ENTRY, 1=SETUP, 0=WATCH, -1=AVOID

export interface TradeStateInfo {
  state:    RegularState
  num:      string        // "STATE 2" | "STATE 1" | "WATCH" | "AVOID"
  label:    string        // "ENTRY" | "SETUP" | "WAIT" | "AVOID"
  sublabel: string        // one-line context
  color:    'emerald' | 'blue' | 'amber' | 'sky' | 'red'
  action:   string        // what to do right now
  missing:  string[]      // what's not yet aligned
}

const FALLBACK_TRADE_STATE: TradeStateInfo = {
  state: 0, num: 'WATCH', label: 'WATCH', color: 'sky',
  sublabel: 'Evaluating conditions',
  action: 'Monitor this setup. Re-evaluate when conditions align.',
  missing: [],
}

export function deriveRegularTradeState(
  rec: Recommendation,
  signals: Signals,
  verdict: Verdict,
): TradeStateInfo {
  const score    = rec.scores?.total_score ?? 0
  const isCredit = (rec.net_credit ?? 0) > 0
  const ivRank   = signals?.iv_rank ?? 0
  const ivFit    = isCredit ? ivRank >= 30 : ivRank < 50
  const allFilters = (rec.passes_rr_filter ?? false) &&
                     (rec.passes_liquidity_filter ?? false) &&
                     (isCredit ? (rec.passes_credit_filter ?? false) : true)

  const missing: string[] = []
  if (!rec.passes_rr_filter)        missing.push('R:R ratio')
  if (!rec.passes_liquidity_filter) missing.push('liquidity')
  if (isCredit && !rec.passes_credit_filter) missing.push('credit ≥25%')
  if (!ivFit) missing.push(isCredit ? `IV Rank ≥30 (now ${ivRank.toFixed(0)})` : `IV Rank <50 (now ${ivRank.toFixed(0)})`)
  if (score < 70) missing.push(`score ≥70 (now ${score})`)

  // Pre-trade checklist veto always wins — a high score does not soften a
  // failed checklist. AVOID in the table badge must match the DO NOT TRADE banner.
  if (verdict === 'NO GO') {
    return {
      state: -1, num: 'AVOID', label: 'AVOID', color: 'red',
      sublabel: `Score ${score} · Pre-trade checklist blocked`,
      action: 'Do not enter. Pre-trade checklist conditions are not met for this setup.',
      missing,
    }
  }

  // STATE 2: ENTRY — everything aligned, pull the trigger
  if (verdict === 'GO' && score >= 70 && allFilters && ivFit) {
    return {
      state: 2, num: 'STATE 2', label: 'ENTRY', color: 'emerald',
      sublabel: `Score ${score} · IV Rank ${ivRank.toFixed(0)}% · All filters pass`,
      action: isCredit
        ? 'Enter now. Sell the spread, set stop at 2× credit, target 50% profit.'
        : 'Enter now. Buy to open, set stop at 50% of premium paid, target 100%.',
      missing: [],
    }
  }

  // STATE 1: SETUP — conditions mostly there, one or two things to wait on
  if ((verdict === 'GO' || verdict === 'CAUTION') && score >= 55 && rec.passes_liquidity_filter) {
    return {
      state: 1, num: 'STATE 1', label: 'SETUP', color: 'blue',
      sublabel: `Score ${score} · Conditions forming`,
      action: 'Setup in progress. Wait for remaining conditions to align before entry.',
      missing,
    }
  }

  // Low score hard block
  if (score < 40) {
    return {
      state: -1, num: 'AVOID', label: 'AVOID', color: 'red',
      sublabel: `Score ${score} · Critical conditions not met`,
      action: 'Do not enter. Key conditions are not met for this setup.',
      missing,
    }
  }

  // WATCH — conditions building but not ready
  return {
    state: 0, num: 'WATCH', label: 'WATCH', color: 'sky',
    sublabel: `Score ${score} · Waiting for alignment`,
    action: 'Monitor this setup. Re-evaluate when score reaches 70 and IV fits.',
    missing,
  }
}

function FilterBadge({ label, pass }: { label: string; pass: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600, border: '1px solid', color: pass ? C.green : C.red, background: pass ? C.greenDim : C.redDim, borderColor: pass ? 'rgba(0,229,160,0.3)' : 'rgba(255,77,109,0.3)' }}>
      {pass ? <CheckCircle size={11} /> : <XCircle size={11} />} {label}
    </span>
  )
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: '0.72rem', color: C.muted, width: 80, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: C.card, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${(value / max) * 100}%`, backgroundColor: color }} />
      </div>
      <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: C.text, width: 40, textAlign: 'right' }}>{value}/{max}</span>
    </div>
  )
}

const RATIONALE_PREVIEW_LEN = 120

// ─── Exit Decision Tree ────────────────────────────────────────────────────

type ExitRule = { trigger: string; price: number; action: string; note: string }

function classifyRule(rule: ExitRule): {
  icon: string; typeLabel: string; kind: 'profit' | 'stop' | 'time'
  rowBg: string; badgeCls: string; labelCls: string; priceCls: string
} {
  const t = rule.trigger.toLowerCase()
  const body = (rule.action ?? '').toLowerCase()
  const combined = t + ' ' + body
  const isStop = t.includes('loss') || t.includes('stop') || t.includes('max loss')
  const isTime = t.includes('time') || t.includes('dte') || t.includes('expir') || t.includes('roll') || t.includes('gamma')
                 || (rule.price === 0 && combined.includes('dte'))
  const isT2   = t.includes('t2') || t.includes('target 2') || t.includes('extend') || t.includes('assignment')
  if (isStop) return {
    icon: '🛑', typeLabel: 'Stop Loss', kind: 'stop',
    rowBg: 'bg-red-950/20', badgeCls: 'bg-red-900/40 text-red-300 border-red-800',
    labelCls: 'text-red-400', priceCls: 'bg-red-950/60 text-red-300 border-red-800/60',
  }
  if (isTime) return {
    icon: '⏱', typeLabel: 'Time', kind: 'time',
    rowBg: 'bg-amber-950/20', badgeCls: 'bg-amber-900/40 text-amber-300 border-amber-800',
    labelCls: 'text-amber-400', priceCls: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  }
  if (isT2) return {
    icon: '🚀', typeLabel: 'Target 2', kind: 'profit',
    rowBg: 'bg-emerald-950/10', badgeCls: 'bg-emerald-900/30 text-emerald-300 border-emerald-800',
    labelCls: 'text-emerald-500', priceCls: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60',
  }
  return {
    icon: '🎯', typeLabel: 'Target 1', kind: 'profit',
    rowBg: 'bg-emerald-950/20', badgeCls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700',
    labelCls: 'text-emerald-400', priceCls: 'bg-emerald-950/60 text-emerald-400 border-emerald-700/60',
  }
}

// Splits a plain-text exit plan string into structured rows by detecting
// labelled sections like "Take profit:", "Stop loss:", "Time exit:", etc.
function parseExitPlanText(text: string): ExitRule[] {
  if (!text?.trim()) return []

  // Patterns that mark the start of a new section (case-insensitive)
  const SECTION_RE = /\b(take\s+profit|profit\s+target|target\s+[12]|stop\s+loss|max\s+loss|time\s+exit|time\s+stop|roll|expir|assignment|gamma)\s*:/gi

  const matches: Array<{ index: number; label: string }> = []
  let m: RegExpExecArray | null
  while ((m = SECTION_RE.exec(text)) !== null) {
    matches.push({ index: m.index, label: m[0].replace(':', '').trim() })
  }

  // No section markers — treat the whole string as a single "plan" entry
  if (matches.length === 0) {
    return [{ trigger: 'Exit plan', price: 0, action: text.trim(), note: '' }]
  }

  const rows: ExitRule[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index + matches[i]!.label.length + 1 // skip the colon
    const end   = matches[i + 1]?.index ?? text.length
    const body  = text.slice(start, end).replace(/^[\s:]+/, '').trim()

    // Extract first price-like token ($123.45) if present
    const priceMatch = body.match(/\$[\d,]+(?:\.\d+)?/)
    const price = priceMatch ? parseFloat(priceMatch[0].replace(/[$,]/g, '')) : 0

    rows.push({
      trigger: matches[i]!.label,
      price,
      action: body,
      note: '',
    })
  }
  return rows
}

function ExitDecisionTree({
  exitRules,
  exitPlan,
}: {
  exitRules?: ExitRule[]
  exitPlan?: string
}) {
  // Use structured rules when available; fall back to parsing the text plan
  const rules: ExitRule[] =
    exitRules && exitRules.length > 0
      ? exitRules
      : parseExitPlanText(exitPlan ?? '')

  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-xs text-gray-600 text-center">
        No exit plan available
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      {/* Column headers */}
      <div className="grid grid-cols-[80px_1fr_90px_1fr] gap-0 border-b border-gray-800 bg-gray-900/80">
        {['SCENARIO', 'IF THIS HAPPENS', 'AT PRICE', 'THEN DO THIS'].map(h => (
          <div key={h} className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-gray-600 border-r border-gray-800/60 last:border-r-0">
            {h}
          </div>
        ))}
      </div>

      {/* Decision rows */}
      <div className="divide-y divide-gray-800/60">
        {rules.map((rule, i) => {
          const c = classifyRule(rule)
          const dteMatch = (rule.action + ' ' + rule.trigger).match(/(\d+)\s*DTE/i)
          // Options contracts = 100 shares; show contract price
          const contractPrice = rule.price > 0 ? rule.price * 100 : 0
          const priceDisplay =
            contractPrice > 0
              ? `$${contractPrice % 1 === 0 ? contractPrice.toFixed(0) : contractPrice.toFixed(2)}`
              : dteMatch
                ? `${dteMatch[1]} DTE`
                : '—'
          const priceSubLabel = contractPrice > 0 ? 'per contract' : null

          return (
            <div key={i} className={`grid grid-cols-[80px_1fr_90px_1fr] gap-0 ${c.rowBg}`}>
              {/* Scenario badge */}
              <div className="px-2 py-2.5 border-r border-gray-800/60 flex flex-col items-center justify-center gap-0.5">
                <span className="text-base leading-none">{c.icon}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider text-center ${c.labelCls}`}>
                  {c.typeLabel}
                </span>
              </div>

              {/* IF column */}
              <div className="px-2.5 py-2.5 border-r border-gray-800/60 flex items-start">
                <div>
                  <div className="text-[11px] text-gray-200 font-medium leading-snug">{rule.trigger}</div>
                  {rule.note && (
                    <div className="text-[10px] text-gray-600 mt-0.5 italic leading-snug">{rule.note}</div>
                  )}
                </div>
              </div>

              {/* AT PRICE column */}
              <div className="px-2 py-2.5 border-r border-gray-800/60 flex flex-col items-center justify-center gap-0.5">
                <span className={`font-mono font-bold text-xs tabular-nums rounded-md px-2 py-1 border ${c.priceCls}`}>
                  {priceDisplay}
                </span>
                {priceSubLabel && (
                  <span className="text-[9px] text-gray-600">{priceSubLabel}</span>
                )}
              </div>

              {/* THEN column */}
              <div className="px-2.5 py-2.5 flex items-start">
                <div className="text-[11px] text-gray-300 font-medium leading-snug">{rule.action}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-800 bg-gray-950/40 flex items-center gap-1.5">
        <span className="text-[10px]">⚠️</span>
        <span className="text-[10px] text-gray-600">
          Set limit/stop orders before entry. Never move your stop against the position.
        </span>
      </div>
    </div>
  )
}

// ─── Rationale ──────────────────────────────────────────────────────────────

function RationaleBlock({ rationale }: { rationale: string }) {
  const [expanded, setExpanded] = useState(false)
  const needsTrunc = rationale.length > RATIONALE_PREVIEW_LEN
  const preview = needsTrunc ? rationale.slice(0, RATIONALE_PREVIEW_LEN).trimEnd() + '…' : rationale
  return (
    <div>
      <p className="text-sm text-gray-300 leading-relaxed">{expanded ? rationale : preview}</p>
      {needsTrunc && (
        <button type="button" onClick={() => setExpanded(e => !e)} className="mt-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          {expanded ? '▲ Show less' : '▼ Details'}
        </button>
      )}
    </div>
  )
}

const BASE_CONTRACT_OPTIONS = [1, 2, 3, 5, 10]

export default function RecommendationCard({
  rec, ticker, companyName, currentPrice, signals, onFetchAllWeeks, fetchingAllWeeks = false,
  scrollFocusRank = null, onScrollFocusConsumed, initialOpen = false, detailOnly = false,
}: Props & { initialOpen?: boolean; detailOnly?: boolean }) {
  const { addToPortfolio, addToWatchlist, isInPortfolio, isWatched, navigate, user, refreshJournalCount, accountSize, setAccountSize } = useApp()
  const [open, setOpen]                       = useState(initialOpen)
  const [exitOpen, setExitOpen]               = useState(false)
  const [addedPort, setAddedPort]             = useState(false)
  const [addedWatch, setAddedWatch]           = useState(false)
  const [savedJournal, setSavedJournal]       = useState(false)
  const [savingJournal, setSavingJournal]     = useState(false)
  const [executedTrade, setExecutedTrade]     = useState<{ orderId: string; status: string } | null>(null)
  const [executingTrade, setExecutingTrade]   = useState(false)
  const [tradeError, setTradeError]           = useState<string | null>(null)
  const [contractPickerOpen, setContractPickerOpen] = useState(false)
  const [selectedContracts, setSelectedContracts]   = useState(1)
  const [alertOpen, setAlertOpen]                   = useState(false)

  const inPortfolio = isInPortfolio(ticker, rec.strategy, rec.expiry) || addedPort
  const watched     = isWatched(ticker) || addedWatch

  const handleConfirmPortfolio = () => {
    addToPortfolio(rec, ticker, companyName, currentPrice, selectedContracts)
    setAddedPort(true)
    setContractPickerOpen(false)
    setTimeout(() => navigate('portfolio'), 800)
  }

  const handleAddWatchlist = () => {
    if (!addToWatchlist({ ticker, companyName, lastPrice: currentPrice })) return
    setAddedWatch(true)
  }

  const handleSaveJournal = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user?.email || savedJournal || savingJournal) return
    setSavingJournal(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await saveToJournal(user.email, {
        ticker,
        company_name: companyName,
        strategy: rec.strategy,
        bias: rec.bias,
        legs: rec.legs as object[],
        expiry: rec.expiry,
        entry_date: today,
        dte_at_entry: rec.dte,
        net_credit: rec.net_credit,
        max_profit: rec.max_profit,
        max_loss: rec.max_loss,
        underlying_entry: currentPrice,
        prob_of_profit: rec.prob_of_profit,
        expected_value: rec.expected_value,
        total_score: rec.scores.total_score,
      })
      setSavedJournal(true)
      void refreshJournalCount()
    } catch {
      // silently fail — user can retry
    } finally {
      setSavingJournal(false)
    }
  }

  const handleExecuteTrade = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user?.email || executedTrade || executingTrade) return
    setExecutingTrade(true)
    setTradeError(null)
    try {
      const result = await executeTrade({
        email:     user.email,
        ticker,
        strategy:  rec.strategy,
        legs:      rec.legs as object[],
        contracts: selectedContracts,
      })
      setExecutedTrade({ orderId: result.order_id ?? '—', status: result.status ?? 'pending' })
      setTimeout(() => setExecutedTrade(null), 20000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Trade execution failed'
      setTradeError(msg)
      setTimeout(() => setTradeError(null), 6000)
    } finally {
      setExecutingTrade(false)
    }
  }

  const openPortfolioPicker = () => {
    setOpen(true)
    setContractPickerOpen(true)
  }

  const checkItems      = buildChecklist(rec, signals)
  const verdict         = deriveVerdict(checkItems)
  const hardFailReasons = checkItems.filter(i => i.status === 'fail' && i.hard).map(i => i.label)
  const softFailReasons = checkItems.filter(i => i.status === 'fail' && !i.hard).map(i => i.label)
  const blockingReasons = [...hardFailReasons, ...softFailReasons].slice(0, 3)

  const isCredit = rec.net_credit > 0
  let tradeState = FALLBACK_TRADE_STATE
  try { tradeState = deriveRegularTradeState(rec, signals, verdict) } catch { /* never crash the card */ }
  const c = (val: number) => (val * 100)
  const fmt = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const rrRatio = rec.risk_reward_ratio

  // Checklist veto wins: if the pre-trade checklist says NO GO, the header badge
  // and left border must always reflect that — regardless of the score-based state.
  const checklistIsVeto  = verdict === 'NO GO'
  const checklistIsCaution = verdict === 'CAUTION'

  const statusStyle = (() => {
    if (checklistIsVeto)    return { bg: C.redDim,    color: C.red,   border: 'rgba(255,77,109,0.3)' }
    if (checklistIsCaution) return { bg: C.amberDim,  color: C.amber, border: 'rgba(245,166,35,0.3)' }
    if (tradeState.color === 'emerald') return { bg: C.greenDim, color: C.green, border: 'rgba(0,229,160,0.3)' }
    if (tradeState.color === 'blue')    return { bg: '#1E3A5F', color: '#3B82F6', border: 'rgba(59,130,246,0.3)' }
    if (tradeState.color === 'amber')   return { bg: C.amberDim, color: C.amber, border: 'rgba(245,166,35,0.3)' }
    if (tradeState.color === 'sky')     return { bg: C.purpleDim, color: C.purple, border: 'rgba(107,127,212,0.3)' }
    return { bg: C.redDim, color: C.red, border: 'rgba(255,77,109,0.3)' }
  })()

  const biasIsBull = rec.bias.includes('Bullish')
  const biasIsBear = rec.bias.includes('Bearish')
  const biasColor = biasIsBull ? C.green : biasIsBear ? C.red : C.amber
  const biasBg = biasIsBull ? C.greenDim : biasIsBear ? C.redDim : C.amberDim

  const expOrCredit = isCredit
    ? { label: 'Credit', value: `$${c(rec.net_credit).toFixed(2)}`, color: C.green }
    : { label: 'Expiry', value: rec.expiry.slice(5), color: C.text }

  // Checklist veto overrides the left border colour too
  const statusBorderColor = checklistIsVeto
    ? '#FF4D6D'
    : checklistIsCaution
    ? '#F5A623'
    : tradeState.state === 2 ? '#00E5A0'
    : tradeState.state === 1 ? '#6B7FD4'
    : tradeState.state === 0 ? '#F5A623'
    : '#FF4D6D'

  const rrColor = rrRatio >= 2 ? 'text-emerald-400' : rrRatio >= 1.5 ? 'text-lime-400' : rrRatio >= 1 ? 'text-yellow-400' : 'text-red-400'
  const evColor = rec.expected_value > 0 ? 'text-emerald-400' : rec.expected_value < 0 ? 'text-red-400' : 'text-gray-300'

  useEffect(() => {
    if (scrollFocusRank !== rec.rank) return
    setOpen(true)
    const id = `oa-rec-${rec.rank}`
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onScrollFocusConsumed?.()
    })
  }, [scrollFocusRank, rec.rank, onScrollFocusConsumed])

  if (detailOnly) {
    return (
      <div id={`oa-rec-${rec.rank}`} style={{ background: C.panel, borderRadius: 12, overflow: 'hidden' }}>
        {open && renderDetail()}
      </div>
    )
  }

  return (
    <div id={`oa-rec-${rec.rank}`} style={{ background: C.panel, border: `1px solid ${C.border}`, borderLeft: `3px solid ${statusBorderColor}`, borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}>

      {/* ── Collapsed header row ── */}
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: open ? `1px solid ${C.border}` : 'none', cursor: 'pointer', background: 'transparent', borderLeft: 'none', borderRight: 'none', borderTop: 'none', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: C.muted, marginRight: 4 }}>#{rec.rank}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{rec.strategy}</span>
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, color: biasColor, background: biasBg, marginLeft: 6 }}>{biasIsBull ? '↑' : biasIsBear ? '↓' : '↔'} {rec.bias}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 500, color: rec.scores.total_score >= 75 ? C.green : rec.scores.total_score >= 55 ? C.amber : C.red }}>{rec.scores.total_score}</span>
          <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 4, fontWeight: 500, border: `1px solid ${statusStyle.border}`, color: statusStyle.color, background: statusStyle.bg }}>
            {checklistIsVeto ? '🚫 NO TRADE' : checklistIsCaution ? '⚠ CAUTION' : (LABEL_DISPLAY[tradeState.label] || tradeState.label)}
          </span>
          {open ? <ChevronUp size={14} style={{ color: C.muted }} /> : <ChevronDown size={14} style={{ color: C.muted }} />}
        </div>
      </button>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '10px 16px', borderBottom: open ? `1px solid ${C.border}` : 'none' }}>
        {[
          { label: 'Max profit', value: `+$${fmt(c(rec.max_profit))}`, color: C.green },
          { label: 'Max loss', value: `-$${fmt(c(rec.max_loss))}`, color: C.red },
          { label: 'PoP', value: `${(rec.prob_of_profit * 100).toFixed(0)}%`, color: C.text },
          { label: expOrCredit.label, value: expOrCredit.value, color: expOrCredit.color },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 500, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Legs row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: open ? `1px solid ${C.border}` : 'none' }}>
        {(() => {
          // Calendar/diagonal spreads have legs on different expiries — show the
          // expiry so same-strike legs aren't indistinguishable.
          const multiExpiry = new Set(rec.legs.map(l => l.expiry)).size > 1
          return rec.legs.map((leg, i) => (
            <span key={i} style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 500, padding: '2px 8px', borderRadius: 4, color: leg.action === 'BUY' ? C.green : C.red, background: leg.action === 'BUY' ? C.greenDim : C.redDim }}>
              {leg.action} {leg.option_type} ${(leg.strike ?? 0).toFixed(0)}{multiExpiry && leg.expiry ? ` ${leg.expiry.slice(5)}` : ''}
            </span>
          ))
        })()}
        <span style={{ fontSize: 10, color: C.muted }}>{rec.dte} DTE</span>
      </div>

      {/* ── Rationale (truncated when closed) ── */}
      <div style={{ padding: '8px 16px', fontSize: 11, color: C.muted, lineHeight: 1.5, borderBottom: open ? `1px solid ${C.border}` : 'none', ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }) }}>
        {rec.rationale}
      </div>

      {/* ── Hidden collapsed extras ── */}
      {!open && (
        <>
        {verdict === 'NO GO' && blockingReasons.length > 0 && (
          <div style={{ padding: '8px 16px 10px', fontSize: 11 }}>
            <span style={{ color: C.red }}>🚫 Blocked: {blockingReasons.join(' · ')}</span>
          </div>
        )}
        {verdict === 'CAUTION' && blockingReasons.length > 0 && (
          <div style={{ padding: '8px 16px 10px', fontSize: 11 }}>
            <span style={{ color: C.amber }}>⚠️ Caution: {blockingReasons.join(' · ')}</span>
          </div>
        )}
        </>
      )}

      {/* ── Expanded detail ── */}
      {open && renderDetail()}
    </div>
  )

  function renderDetail() { return (
        <div>
          {/* ── Checklist veto banner (ALWAYS first when NO GO or CAUTION) ── */}
          {checklistIsVeto && (
            <div className="mx-3 sm:mx-4 mt-3 mb-1 rounded-xl border border-red-700 bg-red-950/60 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">🚫</span>
                <span className="text-xs font-bold text-red-300 tracking-wide">DO NOT TRADE</span>
                {hardFailReasons.length > 0 && (
                  <span className="text-[10px] text-red-400/80 ml-1">— {hardFailReasons.join(' · ')}</span>
                )}
              </div>
              <p className="text-xs text-red-400/70 mt-1 leading-relaxed">
                One or more critical checklist conditions failed. The probability-weighted edge is not present.
                Review the Pre-Trade Checklist below for details.
              </p>
            </div>
          )}
          {checklistIsCaution && !checklistIsVeto && (
            <div className="mx-3 sm:mx-4 mt-3 mb-1 rounded-xl border border-amber-700 bg-amber-950/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">⚠️</span>
                <span className="text-xs font-bold text-amber-300 tracking-wide">PROCEED WITH CAUTION</span>
                {softFailReasons.length > 0 && (
                  <span className="text-[10px] text-amber-400/80 ml-1">— {softFailReasons.join(' · ')}</span>
                )}
              </div>
              <p className="text-xs text-amber-400/70 mt-1 leading-relaxed">
                Some checklist signals are mixed. Consider reducing size or waiting for better conditions.
              </p>
            </div>
          )}

          {/* ── Entry state guidance strip (suppressed when checklist is NO GO) ── */}
          {!checklistIsVeto && (() => {
            const s = tradeState
            const stripBg =
              s.color === 'emerald' ? 'bg-emerald-950/60 border-emerald-800' :
              s.color === 'amber'   ? 'bg-amber-950/50 border-amber-800' :
              s.color === 'sky'     ? 'bg-sky-950/50 border-sky-800' :
                                     'bg-red-950/50 border-red-900'
            const labelCls =
              s.color === 'emerald' ? 'text-emerald-300' :
              s.color === 'amber'   ? 'text-amber-300' :
              s.color === 'sky'     ? 'text-sky-300' : 'text-red-300'
            return (
              <div className={`mx-3 sm:mx-4 mb-3 rounded-xl border px-3 py-2.5 ${stripBg}`}>
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold tracking-wide ${labelCls}`}>
                        {s.num}: {s.label}
                      </span>
                      <span className="text-xs text-gray-400">{s.sublabel}</span>
                    </div>
                    <p className="text-xs text-gray-300 mt-1 leading-relaxed">{s.action}</p>
                    {s.missing.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Waiting on:</span>
                        {s.missing.map(m => (
                          <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Filter badges + action buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 pb-3">
            <div className="flex gap-2 flex-wrap">
              <FilterBadge label="R:R Filter" pass={rec.passes_rr_filter} />
              {isCredit && <FilterBadge label={`Credit ≥25% (${(rec.credit_pct_of_width ?? 0).toFixed(0)}%)`} pass={rec.passes_credit_filter} />}
              <FilterBadge label="Liquidity OK" pass={rec.passes_liquidity_filter} />
            </div>
            <div className="grid grid-cols-2 sm:flex gap-2 sm:shrink-0">
              {onFetchAllWeeks && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onFetchAllWeeks() }}
                  disabled={fetchingAllWeeks}
                  aria-label={fetchingAllWeeks ? 'Fetching all weeks' : 'Fetch all expiry weeks'}
                  title={fetchingAllWeeks ? 'Fetching…' : 'Fetch all weeks (2w–6w)'}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold border transition-all
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400 disabled:opacity-50"
                >
                  <Layers size={16} className={fetchingAllWeeks ? 'animate-pulse' : ''} />
                </button>
              )}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleAddWatchlist() }}
                disabled={watched}
                aria-label={watched ? 'On watchlist' : 'Add to watchlist'}
                title={watched ? 'On watchlist' : 'Add to watchlist'}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold border transition-all ${
                  watched
                    ? 'bg-amber-900/20 border-amber-800 text-amber-400 cursor-default'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-600 hover:text-amber-400'
                }`}
              >
                {watched ? <Check size={16} /> : <Star size={16} />}
              </button>
              {!inPortfolio ? (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setContractPickerOpen(o => !o) }}
                  aria-label="Add to portfolio"
                  title="Add to portfolio"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold border transition-all
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400"
                >
                  <Briefcase size={16} />
                </button>
              ) : (
                <span className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border
                                 bg-violet-900/30 border-violet-700 text-violet-300">
                  <Check size={11} /> Added
                </span>
              )}
              {/* Save to Journal */}
              {savedJournal ? (
                <span className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border
                                 bg-emerald-900/20 border-emerald-800 text-emerald-400">
                  <Check size={11} /> Journaled
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveJournal}
                  disabled={savingJournal}
                  aria-label={savingJournal ? 'Saving to journal' : 'Save to journal'}
                  title={savingJournal ? 'Saving…' : 'Save to journal'}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold border transition-all
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
                >
                  <BookOpen size={16} className={savingJournal ? 'animate-pulse' : ''} />
                </button>
              )}
              {/* Execute Paper Trade — admin only */}
              {user?.role === 'admin' && (
                tradeError ? (
                  <span className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border
                                   bg-red-900/20 border-red-800 text-red-400"
                        title={tradeError}>
                    <XCircle size={11} /> Failed
                  </span>
                ) : executedTrade ? (
                  <span
                    className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border bg-amber-900/20 border-amber-800 text-amber-400 cursor-default"
                    title={`Order ID: ${executedTrade.orderId} · Status: ${executedTrade.status}`}
                  >
                    <Check size={11} /> Order #{executedTrade.orderId.slice(-6)} · {executedTrade.status}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleExecuteTrade}
                    disabled={executingTrade}
                    aria-label={executingTrade ? 'Sending to Alpaca' : 'Execute paper trade'}
                    title={executingTrade ? 'Sending…' : `Execute ${selectedContracts} contract${selectedContracts > 1 ? 's' : ''} on Alpaca paper`}
                    className="inline-flex h-9 items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border transition-all
                               bg-amber-900/20 border-amber-700/60 text-amber-400 hover:bg-amber-900/40 hover:border-amber-500 disabled:opacity-50"
                  >
                    <Zap size={13} className={executingTrade ? 'animate-pulse' : ''} />
                    {executingTrade ? 'Sending…' : 'Paper Trade'}
                  </button>
                )
              )}
              {/* Set Alert */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setAlertOpen(o => !o) }}
                aria-label="Set alert"
                title="Set alert for this trade"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold border transition-all
                           bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-600 hover:text-blue-400"
              >
                <Bell size={16} />
              </button>
            </div>
          </div>

          {/* Alert drawer */}
          {alertOpen && (
            <SetAlertDrawer
              ticker={ticker}
              tradeType="regular"
              onClose={() => setAlertOpen(false)}
              onSubmit={async (d: DeskAlertCreate) => { await deskApi.createAlert(d); setAlertOpen(false) }}
            />
          )}

          {/* Contract picker — shown when Portfolio button clicked */}
          {contractPickerOpen && !inPortfolio && (() => {
            // ── Kelly Criterion position sizing ────────────────────────────────
            // half_kelly_fraction = conservative (Kelly × 0.5), capped at 20%.
            // capitalAtRisk = accountSize × half_kelly_fraction
            // kellyContracts = floor(capitalAtRisk / max_loss_per_contract)
            const maxLossPerContract  = rec.max_loss * 100
            const capitalToRisk       = accountSize * rec.half_kelly_fraction
            const kellyContracts      = maxLossPerContract > 0 ? Math.floor(capitalToRisk / maxLossPerContract) : 0
            const kellyPct            = (rec.half_kelly_fraction * 100).toFixed(1)
            const fullKellyPct        = (rec.kelly_fraction * 100).toFixed(1)
            const edgeRatioPct        = (rec.edge_ratio * 100).toFixed(1)
            const isThinEdge          = rec.edge_ratio < 0.05
            const capitalForSelected  = maxLossPerContract * selectedContracts
            const capitalPctNumber    = accountSize > 0 ? capitalForSelected / accountSize * 100 : 0
            const capitalPct          = accountSize > 0 ? capitalPctNumber.toFixed(1) : '—'
            const contractOptions     = Array.from(new Set([
              ...BASE_CONTRACT_OPTIONS,
              ...(kellyContracts > 0 ? [kellyContracts] : []),
            ])).sort((a, b) => a - b)

            return (
              <div
                className="mx-3 sm:mx-4 mb-3 bg-violet-950/40 border border-violet-800 rounded-xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* ── Kelly header ─────────────────────────────────────── */}
                <div className="px-3 pt-3 pb-2 border-b border-violet-900/60">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-violet-300 font-semibold">
                      📐 Kelly Criterion — Position Sizing
                    </span>
                    {isThinEdge && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-700 text-amber-400 font-semibold">
                        ⚠ Thin edge
                      </span>
                    )}
                  </div>

                  {/* Kelly stats row */}
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="bg-gray-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-gray-500 mb-0.5">Edge (EV/Risk)</div>
                      <div className={`font-mono font-bold ${isThinEdge ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {edgeRatioPct}%
                      </div>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-gray-500 mb-0.5">Full Kelly</div>
                      <div className="font-mono font-bold text-violet-300">{fullKellyPct}% of capital</div>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-gray-500 mb-0.5">½ Kelly (recommended)</div>
                      <div className="font-mono font-bold text-violet-400">{kellyPct}% of capital</div>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-gray-500 mb-0.5">Kelly contracts</div>
                      <div className="font-mono font-bold text-white">
                        {kellyContracts} @ ${accountSize.toLocaleString()} acct
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">
                    Capital to risk: <span className="font-mono text-gray-300">${Math.round(capitalToRisk).toLocaleString()}</span>
                    <span className="mx-1 text-gray-700">·</span>
                    Max loss/contract: <span className="font-mono text-gray-300">${Math.round(maxLossPerContract).toLocaleString()}</span>
                    {kellyContracts === 0 && (
                      <span className="block mt-1 text-amber-400/80">
                        Half-Kelly recommends less than 1 contract for this account size.
                      </span>
                    )}
                  </div>

                  {/* Account size input */}
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <span className="text-gray-500 shrink-0">Account size:</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        value={accountSize}
                        onChange={e => setAccountSize(Number(e.target.value))}
                        className="pl-5 pr-2 py-1 w-32 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200
                                   focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                    <span className="text-gray-600">· saved automatically</span>
                  </div>
                </div>

                {/* ── Contract selector ────────────────────────────────── */}
                <div className="px-3 pt-2.5 pb-3">
                  <div className="text-xs text-violet-300 font-semibold mb-2">
                    How many contracts?
                    <span className="block sm:inline text-violet-500 font-normal sm:ml-1.5 mt-1 sm:mt-0">
                      1 contract = 100 shares · ${(rec.max_profit * 100).toFixed(0)} max profit each
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {contractOptions.map(n => {
                      const isKelly = n === kellyContracts
                      return (
                        <button
                          key={n}
                          onClick={() => setSelectedContracts(n)}
                          title={isKelly ? `Kelly recommends ${n} contract${n > 1 ? 's' : ''} for your account size` : undefined}
                          className={`relative w-10 h-10 rounded-lg text-sm font-bold border transition-all ${
                            selectedContracts === n
                              ? 'bg-violet-600 border-violet-500 text-white'
                              : isKelly
                              ? 'bg-violet-900/40 border-violet-500 text-violet-300 hover:bg-violet-600 hover:text-white'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400'
                          }`}
                        >
                          {n}
                          {isKelly && (
                            <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-violet-500
                                             text-white text-[8px] flex items-center justify-center font-bold leading-none">
                              K
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Capital impact for current selection */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    <span>
                      <span className="text-gray-500">Max profit: </span>
                      <span className="text-emerald-400 font-mono">${(rec.max_profit * 100 * selectedContracts).toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-gray-500">Max loss: </span>
                      <span className="text-red-400 font-mono">${(maxLossPerContract * selectedContracts).toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-gray-500">Capital at risk: </span>
                      <span className={`font-mono font-semibold ${
                        capitalPctNumber > 20 ? 'text-red-400' :
                        capitalPctNumber >= 10 ? 'text-amber-400' : 'text-gray-300'
                      }`}>{capitalPct}% of account</span>
                    </span>
                  </div>
                  {capitalPctNumber >= 10 && capitalPctNumber <= 20 && (
                    <div className="mt-1.5 text-[10px] text-amber-400/80">
                      {capitalPct}% of capital is approaching the 20% Half-Kelly cap. Watch total portfolio exposure.
                    </div>
                  )}
                  {capitalPctNumber > 20 && (
                    <div className="mt-1.5 text-[10px] text-red-400/80">
                      {capitalPct}% of capital in one trade exceeds the 20% Kelly cap. Consider fewer contracts.
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:flex gap-2 mt-3">
                    <button
                      onClick={() => setContractPickerOpen(false)}
                      className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmPortfolio}
                      aria-label={`Add ${selectedContracts} contract${selectedContracts > 1 ? 's' : ''} to portfolio`}
                      title={`Add ${selectedContracts} contract${selectedContracts > 1 ? 's' : ''} to portfolio`}
                      className="inline-flex h-10 w-10 items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
                    >
                      <Briefcase size={18} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Warnings */}
          {rec.warnings.length > 0 && (
            <div className="mx-4 mb-3 p-2 bg-amber-900/20 border border-amber-800 rounded-lg">
              {rec.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}

      {/* Legs */}
      <div className="mx-3 sm:mx-4 bg-gray-800/60 rounded-xl p-3 font-mono text-xs mb-3 overflow-x-auto">
        <div className="text-gray-500 text-xs mb-1.5">1 contract = 100 shares</div>
        <table className="w-full min-w-[46rem]">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left pb-1.5 pr-3">Action</th>
              <th className="text-left pb-1.5 pr-3">Type</th>
              <th className="text-right pb-1.5 pr-3">Strike</th>
              <th className="text-right pb-1.5 pr-3">Expiry</th>
              <th className="text-right pb-1.5 pr-3">Delta</th>
              <th className="text-right pb-1.5 pr-3">Mid/sh</th>
              <th className="text-right pb-1.5 pr-3">Contract Cost</th>
              <th className="text-right pb-1.5 pr-3">IV</th>
              <th className="text-right pb-1.5 pr-3">OI</th>
              <th className="text-right pb-1.5">BA%</th>
            </tr>
          </thead>
          <tbody>
            {rec.legs.map((leg, i) => (
              <tr key={i} className="border-b border-gray-700/50 last:border-0">
                <td className={`pr-3 py-1 font-bold ${leg.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{leg.action}</td>
                <td className="pr-3 py-1 text-white">{leg.option_type}</td>
                <td className="pr-3 py-1 text-right text-white">${(leg.strike ?? 0).toFixed(1)}</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.expiry}</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.delta !== 0 ? (leg.delta ?? 0).toFixed(3) : '—'}</td>
                <td className="pr-3 py-1 text-right text-gray-400">
                  ${(leg.mid_price ?? 0).toFixed(2)}
                  {leg.data_quality === 'MODEL' && (
                    <span
                      title={leg.data_quality_reason || 'Using IV-based model mark because the Yahoo quote looked stale'}
                      className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-900/60 text-blue-300 border border-blue-700 cursor-help"
                    >
                      Model
                    </span>
                  )}
                </td>
                <td className={`pr-3 py-1 text-right font-bold ${leg.action === 'BUY' ? 'text-red-300' : 'text-green-300'}`}>
                  {leg.action === 'BUY' ? '-' : '+'}${fmt(c(leg.mid_price))}
                </td>
                <td className="pr-3 py-1 text-right text-gray-300">{(leg.iv ?? 0).toFixed(1)}%</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.oi.toLocaleString()}</td>
                <td className={`py-1 text-right ${leg.bid_ask_spread_pct > 10 ? 'text-amber-400' : 'text-gray-300'}`}>
                  {(leg.bid_ask_spread_pct ?? 0).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compact risk/reward + score summary */}
      <div className="px-3 sm:px-4 pb-3 grid gap-3 lg:grid-cols-[1.45fr_1fr]">
        <div className="bg-gray-800/60 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-semibold text-gray-400">Risk / Reward</span>
            <span className={`text-xs font-mono font-bold ${rrColor}`}>
              1:{(rec.max_profit / rec.max_loss).toFixed(1)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-gray-500">Max Profit</div>
              <div className="text-emerald-400 font-bold font-mono">${fmt(c(rec.max_profit))}</div>
            </div>
            <div>
              <div className="text-gray-500">Max Loss</div>
              <div className="text-red-400 font-bold font-mono">${fmt(c(rec.max_loss))}</div>
            </div>
            <div>
              <div className="text-gray-500">PoP / EV</div>
              <div className="font-mono text-gray-200">
                {(rec.prob_of_profit * 100).toFixed(0)}% · <span className={evColor}>{rec.expected_value > 0 ? '+' : ''}${fmt(c(rec.expected_value))}</span>
              </div>
            </div>
            <div>
              <div className="text-gray-500">Breakeven</div>
              <div className="font-mono text-gray-200 truncate">
                {rec.breakeven_upper < 990 && rec.breakeven_lower > 0
                  ? `$${(rec.breakeven_lower ?? 0).toFixed(2)}–$${(rec.breakeven_upper ?? 0).toFixed(2)}`
                  : rec.breakeven_lower > 0
                  ? `$${(rec.breakeven_lower ?? 0).toFixed(2)} ↑`
                  : `$${(rec.breakeven_upper ?? 0).toFixed(2)} ↓`}
              </div>
            </div>
          </div>
          {isCredit && (
            <div className={`mt-2 border-t border-gray-700/60 pt-2 text-xs font-mono ${rec.passes_credit_filter ? 'text-green-400' : 'text-amber-400'}`}>
              {rec.passes_credit_filter ? '✅' : '⚠️'} ${fmt(c(rec.net_credit))} credit · {(rec.credit_pct_of_width ?? 0).toFixed(0)}% of ${(rec.spread_width ?? 0).toFixed(0)} width
              {!rec.passes_credit_filter && ' · below 25% minimum'}
            </div>
          )}
        </div>

        <div className="bg-gray-800/40 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-semibold text-gray-400">Score Breakdown</span>
            <span className={`font-mono text-sm font-bold ${scoreColor(rec.scores.total_score)}`}>{rec.scores.total_score}/100</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Signal</span><span className="font-mono text-violet-300">{rec.scores.signal_score}/40</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Structure</span><span className="font-mono text-blue-300">{rec.scores.structure_score}/30</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Liquidity</span><span className="font-mono text-emerald-300">{rec.scores.liquidity_score}/20</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">IV</span><span className="font-mono text-amber-300">{rec.scores.iv_fit_score}/10</span></div>
          </div>
        </div>
      </div>

      {/* Rationale */}
      {rec.rationale ? (
        <div className="px-4 pb-3">
          <div className="bg-gray-800/40 rounded-xl p-3">
            <div className="text-xs text-violet-400 font-semibold mb-1.5">💡 Why this trade</div>
            <RationaleBlock rationale={rec.rationale} />
          </div>
        </div>
      ) : null}

      {/* Pre-Trade Checklist */}
      <PreTradeChecklist rec={rec} signals={signals} />

      {/* Exit plan — decision tree table */}
      <div className="px-4 pb-4">
        <button
          onClick={() => setExitOpen(o => !o)}
          className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-200
                     bg-gray-900/60 border border-gray-800 rounded-xl px-3 py-2 transition-colors mb-2"
        >
          <span className="flex items-center gap-1.5 font-semibold">🚪 Exit Plan</span>
          {exitOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {exitOpen && (
          <ExitDecisionTree exitRules={rec.exit_rules} exitPlan={rec.exit_plan} />
        )}
      </div>
        </div>
  ) }
}
