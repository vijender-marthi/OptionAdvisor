import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock,
  FileText,
  Layers,
  LineChart as LineChartIcon,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import TradeExitPlanner from '../components/TradeExitPlanner'
import TradeGuardrails from '../components/TradeGuardrails'
import { evaluateTradeWorksheet, fetchCalculationRuns, fetchCalculationSnapshot, fetchCalculationSnapshotAuditLog, fetchCalculationSnapshotIntegrity, fetchOptionChainLiquidity, getJournal, saveToJournal, type CalculationRun, type CalculationSnapshot, type CalculationSnapshotAuditLog, type CalculationSnapshotIntegrity, type MetricDefinition, type OptionChainLiquidityResponse, type OptionChainRow, type TradeWorksheetEvaluation } from '../api/client'
import { getActionButtonClass, getDecisionBadgeClass, getProfitLossTextClass } from '../utils/semanticTrading'
import { useApp } from '../contexts/AppContext'
import { formatTickerTitle, useDocumentTitle } from '../hooks/useDocumentTitle'

type Direction = 'Bullish' | 'Bearish' | 'Neutral'
type Strategy =
  | 'Long Call'
  | 'Long Put'
  | 'Bull Call Spread'
  | 'Bull Put Spread'
  | 'Bear Put Spread'
  | 'Bear Call Spread'
  | 'Calendar Spread'
  | 'Diagonal Spread'
  | 'Iron Condor'
  | 'Covered Call'
  | 'Cash Secured Put'
  | 'Shares'
type Emotion = 'Calm' | 'FOMO' | 'Revenge' | 'Speculative'

type JournalEntry = {
  id?: string
  ticker?: string
  strategy?: string
  bias?: string
  status?: string
  entry_date?: string
  created_at?: string
  total_score?: number
  notes?: string
}

interface WorksheetForm {
  ticker: string
  direction: Direction
  strategy: Strategy
  strike: number
  shortStrike: number
  longStrike: number
  shortPutStrike: number
  longPutStrike: number
  shortCallStrike: number
  longCallStrike: number
  expiration: string
  sellExpiration: string
  buyExpiration: string
  premium: number
  contracts: number
  stockPrice: number
  targetPrice: number
  expectedHoldDays: number
  buyingPower: number
  ivRank: number
  ivPercentile: number
  historicalVolatility: number
}

const strategies: Strategy[] = [
  'Long Call',
  'Long Put',
  'Bull Call Spread',
  'Bull Put Spread',
  'Bear Put Spread',
  'Bear Call Spread',
  'Calendar Spread',
  'Diagonal Spread',
  'Iron Condor',
  'Covered Call',
  'Cash Secured Put',
  'Shares',
]

const directions: Direction[] = ['Bullish', 'Bearish', 'Neutral']

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900'
const smallInputCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-primary outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900'

function isCalendarLike(strategy: Strategy) {
  return strategy === 'Calendar Spread' || strategy === 'Diagonal Spread'
}

function isIronCondor(strategy: Strategy) {
  return strategy === 'Iron Condor'
}

function isVerticalSpread(strategy: Strategy) {
  return strategy === 'Bull Call Spread' || strategy === 'Bear Put Spread' || strategy === 'Bull Put Spread' || strategy === 'Bear Call Spread'
}

function isCreditSpread(strategy: Strategy) {
  return strategy === 'Bull Put Spread' || strategy === 'Bear Call Spread'
}

function scoreTone(score: number) {
  if (score >= 85) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (score >= 70) return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  if (score >= 55) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
}

function qualityTone(value: number, goodAt = 70, cautionAt = 50) {
  if (value >= goodAt) return 'good'
  if (value >= cautionAt) return 'caution'
  return 'bad'
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n))
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '$--'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '--'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function usesPutChain(form: Pick<WorksheetForm, 'direction' | 'strategy'>) {
  if (form.strategy.includes('Put') || form.strategy === 'Cash Secured Put') return true
  if (form.strategy.includes('Call') || form.strategy === 'Covered Call') return false
  return form.direction === 'Bearish'
}

function frontExpiration(form: WorksheetForm) {
  return isCalendarLike(form.strategy) ? form.sellExpiration || form.expiration : form.expiration
}

function primaryStrike(form: WorksheetForm) {
  if (form.strategy === 'Bull Put Spread' || form.strategy === 'Bear Call Spread') return form.shortStrike || form.strike
  if (isVerticalSpread(form.strategy)) return form.longStrike || form.strike
  if (isCalendarLike(form.strategy)) return form.shortStrike || form.strike
  if (isIronCondor(form.strategy)) return form.direction === 'Bearish' ? form.shortCallStrike : form.shortPutStrike
  return form.strike
}

function stars(score: number) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)))
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)
}

function expirationDaysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function exitPlanForStrategy(strategy: Strategy): Array<{ label: string; value: string; danger?: boolean }> {
  if (strategy === 'Bull Put Spread' || strategy === 'Bear Call Spread') {
    return [
      { label: 'Take Profit 1', value: 'Buy back at 50% max profit' },
      { label: 'Take Profit 2', value: 'Exit/roll at 70-80% max profit' },
      { label: 'Stop Loss', value: 'Exit at 2x credit loss or short strike breach', danger: true },
    ]
  }
  if (strategy === 'Iron Condor') {
    return [
      { label: 'Take Profit 1', value: 'Close at 40-50% max profit' },
      { label: 'Take Profit 2', value: 'Close untested side if tested' },
      { label: 'Stop Loss', value: 'Exit/adjust if short strike is breached', danger: true },
    ]
  }
  if (strategy === 'Calendar Spread' || strategy === 'Diagonal Spread') {
    return [
      { label: 'Take Profit 1', value: '+25-35% spread value' },
      { label: 'Take Profit 2', value: 'Close before front expiry risk' },
      { label: 'Stop Loss', value: '-25-30% spread value', danger: true },
    ]
  }
  return [
    { label: 'Take Profit 1', value: '+40%' },
    { label: 'Take Profit 2', value: '+75%' },
    { label: 'Stop Loss', value: '-30%', danger: true },
  ]
}

function initialForm(): WorksheetForm {
  const frontExpiry = expirationDaysFromNow(14)
  const backExpiry = expirationDaysFromNow(35)
  return {
    ticker: 'ARM',
    direction: 'Bullish',
    strategy: 'Long Call',
    strike: 150,
    shortStrike: 150,
    longStrike: 155,
    shortPutStrike: 140,
    longPutStrike: 135,
    shortCallStrike: 160,
    longCallStrike: 165,
    expiration: frontExpiry,
    sellExpiration: frontExpiry,
    buyExpiration: backExpiry,
    premium: 4.5,
    contracts: 1,
    stockPrice: 145,
    targetPrice: 158,
    expectedHoldDays: 5,
    buyingPower: 25000,
    ivRank: 42,
    ivPercentile: 56,
    historicalVolatility: 45,
  }
}

export default function TradeWorksheetPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useApp()
  const [form, setForm] = useState<WorksheetForm>(() => {
    const f = initialForm()
    const ticker = params.get('ticker')
    const direction = params.get('direction')
    const strategy = params.get('strategy')
    if (ticker) f.ticker = ticker.toUpperCase()
    if (direction === 'Bearish' || direction === 'Neutral' || direction === 'Bullish') f.direction = direction
    if (strategy && strategies.includes(strategy as Strategy)) f.strategy = strategy as Strategy
    return f
  })
  const [chain, setChain] = useState<OptionChainLiquidityResponse | null>(null)
  const [backChain, setBackChain] = useState<OptionChainLiquidityResponse | null>(null)
  const [selectedRow, setSelectedRow] = useState<OptionChainRow | null>(null)
  const [selectedLegRows, setSelectedLegRows] = useState<Record<string, OptionChainRow | null>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [journalError, setJournalError] = useState('')
  const [priceMove, setPriceMove] = useState(5)
  const [ivMove, setIvMove] = useState(0)
  const [daysPassed, setDaysPassed] = useState(3)
  const [payoffView, setPayoffView] = useState<'graph' | 'table'>('graph')
  const [evaluation, setEvaluation] = useState<TradeWorksheetEvaluation | null>(null)
  const [evaluationError, setEvaluationError] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [journal, setJournal] = useState({
    why: '',
    invalidates: '',
    catalyst: '',
    hold: '',
    confidence: 7,
    emotion: 'Calm' as Emotion,
  })
  useDocumentTitle(formatTickerTitle(form.ticker, 'Trade Worksheet'))
  const [savingJournal, setSavingJournal] = useState(false)
  const [journalSaved, setJournalSaved] = useState(false)
  const chainRequestSeqRef = useRef(0)
  const [showAdvancedInputs, setShowAdvancedInputs] = useState(false)
  const [journalHistory, setJournalHistory] = useState<JournalEntry[]>([])
  const [journalHistoryLoading, setJournalHistoryLoading] = useState(false)
  const [calculationHistory, setCalculationHistory] = useState<CalculationRun[]>([])
  const [calculationHistoryLoading, setCalculationHistoryLoading] = useState(false)
  const [showCalculationHistory, setShowCalculationHistory] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<CalculationSnapshot | null>(null)
  const [selectedSnapshotIntegrity, setSelectedSnapshotIntegrity] = useState<CalculationSnapshotIntegrity | null>(null)
  const [selectedSnapshotAuditLog, setSelectedSnapshotAuditLog] = useState<CalculationSnapshotAuditLog | null>(null)
  const [selectedSnapshotLoading, setSelectedSnapshotLoading] = useState(false)
  const [selectedSnapshotError, setSelectedSnapshotError] = useState('')

  const loadJournalHistory = useCallback(async (ticker = form.ticker) => {
    if (!user?.email) {
      setJournalHistory([])
      return
    }
    const clean = ticker.trim().toUpperCase()
    if (!clean) return
    setJournalHistoryLoading(true)
    try {
      const data = await getJournal(user.email)
      const entries = (data.entries as JournalEntry[]).filter(e => String(e.ticker || '').toUpperCase() === clean)
      setJournalHistory(entries.slice(0, 8))
    } catch {
      setJournalHistory([])
    } finally {
      setJournalHistoryLoading(false)
    }
  }, [form.ticker, user?.email])

  const loadCalculationHistory = useCallback(async () => {
    if (!user?.email) {
      setCalculationHistory([])
      setSelectedSnapshot(null)
      setSelectedSnapshotIntegrity(null)
      setSelectedSnapshotAuditLog(null)
      return
    }
    setCalculationHistoryLoading(true)
    try {
      const data = await fetchCalculationRuns({ run_type: 'trade_worksheet', limit: 8 })
      setCalculationHistory(data.runs)
    } catch {
      setCalculationHistory([])
    } finally {
      setCalculationHistoryLoading(false)
    }
  }, [user?.email])

  const handleOpenSnapshot = useCallback(async (snapshotId?: string | null) => {
    if (!snapshotId) return
    setSelectedSnapshotLoading(true)
    setSelectedSnapshotError('')
    try {
      const [snapshot, integrity, auditLog] = await Promise.all([
        fetchCalculationSnapshot(snapshotId),
        fetchCalculationSnapshotIntegrity(snapshotId),
        fetchCalculationSnapshotAuditLog(snapshotId),
      ])
      setSelectedSnapshot(snapshot)
      setSelectedSnapshotIntegrity(integrity)
      setSelectedSnapshotAuditLog(auditLog)
      setShowCalculationHistory(true)
    } catch {
      setSelectedSnapshot(null)
      setSelectedSnapshotIntegrity(null)
      setSelectedSnapshotAuditLog(null)
      setSelectedSnapshotError('Unable to load frozen snapshot.')
    } finally {
      setSelectedSnapshotLoading(false)
    }
  }, [])

  const handleSaveToJournal = useCallback(async () => {
    if (!user?.email || !evaluation) return
    setSavingJournal(true)
    setJournalError('')
    try {
      const s = evaluation.summary
      const sc = evaluation.score
      const maxProfit = evaluation.payoff.length > 0
        ? Math.max(...evaluation.payoff.map(p => p.pnl))
        : 0
      const legs: object[] = []
      if (form.strategy === 'Long Call' || form.strategy === 'Long Put' || form.strategy === 'Cash Secured Put' || form.strategy === 'Covered Call') {
        legs.push({ action: form.strategy.startsWith('Long') ? 'BUY' : 'SELL', option_type: usesPutChain(form) ? 'PUT' : 'CALL', strike: form.strike, expiry: form.expiration })
      } else if (isVerticalSpread(form.strategy)) {
        legs.push({ action: 'BUY', option_type: usesPutChain(form) ? 'PUT' : 'CALL', strike: form.longStrike, expiry: form.expiration })
        legs.push({ action: 'SELL', option_type: usesPutChain(form) ? 'PUT' : 'CALL', strike: form.shortStrike, expiry: form.expiration })
      } else if (isIronCondor(form.strategy)) {
        legs.push({ action: 'BUY', option_type: 'PUT', strike: form.longPutStrike, expiry: form.expiration })
        legs.push({ action: 'SELL', option_type: 'PUT', strike: form.shortPutStrike, expiry: form.expiration })
        legs.push({ action: 'SELL', option_type: 'CALL', strike: form.shortCallStrike, expiry: form.expiration })
        legs.push({ action: 'BUY', option_type: 'CALL', strike: form.longCallStrike, expiry: form.expiration })
      } else if (isCalendarLike(form.strategy)) {
        legs.push({ action: 'SELL', option_type: 'CALL', strike: form.shortStrike, expiry: form.sellExpiration })
        legs.push({ action: 'BUY', option_type: 'CALL', strike: form.shortStrike, expiry: form.buyExpiration })
      }
      const notes = [journal.why, journal.invalidates, journal.catalyst].filter(Boolean).join('\n---\n')
        + `\nHold: ${journal.hold || 'N/A'} | Confidence: ${journal.confidence}/10 | Emotion: ${journal.emotion}`
      await saveToJournal(user.email, {
        ticker: form.ticker,
        company_name: form.ticker,
        strategy: form.strategy,
        bias: form.direction,
        legs,
        expiry: form.expiration,
        entry_date: new Date().toISOString().slice(0, 10),
        dte_at_entry: s.frontDte || 0,
        net_credit: s.netPremiumType === 'credit' ? Math.abs(s.netPremium) : 0,
        max_profit: maxProfit,
        max_loss: s.maxRisk || 0,
        underlying_entry: form.stockPrice,
        prob_of_profit: (s.probability || 0) / 100,
        expected_value: evaluation.scenario.expectedValue || 0,
        total_score: sc.total || 0,
        notes,
        trade_type: 'worksheet',
      })
      setJournalSaved(true)
      void loadJournalHistory(form.ticker)
      setTimeout(() => setJournalSaved(false), 4000)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setJournalError(detail || 'Failed to save to journal.')
    } finally {
      setSavingJournal(false)
    }
  }, [user, evaluation, form, journal, loadJournalHistory])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      evaluateTradeWorksheet({ ...form, selectedRow, selectedLegRows, priceMove, ivMove, daysPassed })
        .then(data => {
          setEvaluation(data)
          setEvaluationError('')
          void loadCalculationHistory()
        })
        .catch(err => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setEvaluationError(detail || 'Unable to evaluate trade worksheet.')
        })
    }, 200)
    return () => window.clearTimeout(handle)
  }, [form, selectedRow, selectedLegRows, priceMove, ivMove, daysPassed, loadCalculationHistory])

  useEffect(() => {
    void loadCalculationHistory()
  }, [loadCalculationHistory])

  const greeks = evaluation?.greeks ?? { delta: 0, gamma: 0, theta: 0, vega: 0, iv: 0, probabilityItm: 0, probabilityOtm: 0, probabilityProfit: 0 }
  const popAtBreakeven = greeks.probabilityProfit ?? greeks.probabilityItm
  const score = evaluation?.score ?? { total: 0, trend: 0, optionPricing: 0, time: 0, liquidity: 0, probability: 0, riskReward: 0, volatility: 0, market: 0, label: 'WAIT' }
  const payoff = evaluation?.payoff ?? []
  const timeBuckets = evaluation?.scenario.timeBuckets ?? []
  const comparisons = evaluation?.comparisons ?? []
  const bestStrategy = evaluation?.bestStrategy ?? comparisons[0] ?? null
  // #5/#6: source-of-truth blocking validation (direction/strategy, premium vs chain mid).
  const validation = evaluation?.validation ?? { blocked: false, errors: [], warnings: [] }
  const estimatedValue = evaluation?.scenario.estimatedValue ?? 0
  const estimatedProfit = evaluation?.scenario.estimatedProfit ?? 0
  const estimatedRoi = evaluation?.scenario.estimatedRoi ?? 0
  const riskLevel = evaluation?.summary.riskLevel ?? 'High'
  const frontDte = evaluation?.summary.frontDte ?? 0
  const backDte = evaluation?.summary.backDte ?? 0
  const summaryMaxRisk = evaluation?.summary.maxRisk ?? 0
  const breakevenPrice = evaluation?.summary.breakeven ?? form.stockPrice
  const payoffMaxAbs = Math.max(1, ...payoff.map(p => Math.abs(p.pnl)))
  const payoffRiskDenom = Math.abs(summaryMaxRisk) || Math.abs(Math.min(0, ...payoff.map(p => p.pnl))) || 1
  const payoffCurrentPrice = payoff.reduce<{ price: number; d: number }>((best, p) => {
    const d = Math.abs(p.price - form.stockPrice)
    return d < best.d ? { price: p.price, d } : best
  }, { price: NaN, d: Infinity }).price
  const metricDefinitions = useMemo(() => {
    const pairs = (evaluation?.metricDefinitions?.metrics ?? []).map(def => [def.metricId, def] as const)
    return new Map<string, MetricDefinition>(pairs)
  }, [evaluation?.metricDefinitions?.metrics])
  const metricDef = useCallback((metricId: string) => metricDefinitions.get(metricId), [metricDefinitions])

  const update = <K extends keyof WorksheetForm>(key: K, value: WorksheetForm[K]) => setForm(prev => ({ ...prev, [key]: value }))

  const optionKind = usesPutChain(form) ? 'put' : 'call'
  const selectLeg = (leg: string, row: OptionChainRow, updates: Partial<WorksheetForm>, updatePremium = false) => {
    setSelectedRow(row)
    setSelectedLegRows(prev => ({ ...prev, [leg]: row }))
    setForm(prev => ({
      ...prev,
      ...updates,
      premium: updatePremium ? row.mid || prev.premium : prev.premium,
      historicalVolatility: row.iv && row.iv < 300 ? row.iv : prev.historicalVolatility,
    }))
  }

  const loadChain = useCallback(async (ticker = form.ticker, expiry = frontExpiration(form), buyExpiry = form.buyExpiration) => {
    const clean = ticker.trim().toUpperCase()
    if (!clean) return
    const reqId = chainRequestSeqRef.current + 1
    chainRequestSeqRef.current = reqId
    setLoading(true)
    setError('')
    try {
      const data = await fetchOptionChainLiquidity(clean, expiry, true)
      if (chainRequestSeqRef.current !== reqId) return
      setChain(data)
      let loadedBackChain: OptionChainLiquidityResponse | null = null
      if (isCalendarLike(form.strategy)) {
        const backExpiry = buyExpiry || expirationDaysFromNow(35)
        if (backExpiry !== data.selected_expiry) {
          loadedBackChain = await fetchOptionChainLiquidity(clean, backExpiry, true)
          if (chainRequestSeqRef.current !== reqId) return
          setBackChain(loadedBackChain)
        } else {
          setBackChain(null)
        }
      } else {
        setBackChain(null)
      }
      const source = usesPutChain(form) ? data.puts : data.calls
      const targetStrike = primaryStrike(form)
      const nearest = source.reduce<OptionChainRow | null>((best, row) => {
        if (!best) return row
        return Math.abs(row.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? row : best
      }, null)
      if (nearest) {
        const nextTargetPrice = data.current_price > 0
          ? data.current_price * (form.direction === 'Bearish' ? 0.95 : form.direction === 'Bullish' ? 1.05 : 1)
          : form.targetPrice
        const nextHv = data.historical_volatility ?? (nearest.iv && nearest.iv < 300 ? nearest.iv : form.historicalVolatility)
        const nextIvRank = data.iv_rank ?? (data.current_iv != null && nextHv > 0 ? clamp((data.current_iv / nextHv) * 50, 0, 100) : form.ivRank)
        const nextIvPercentile = data.iv_percentile ?? nextIvRank
        setSelectedRow(nearest)
        setSelectedLegRows({})
        setForm(prev => ({
          ...prev,
          ticker: data.ticker,
          stockPrice: data.current_price,
          expiration: data.selected_expiry,
          sellExpiration: data.selected_expiry,
          buyExpiration: isCalendarLike(prev.strategy) ? prev.buyExpiration : data.selected_expiry,
          strike: nearest.strike,
          shortStrike: nearest.strike,
          longStrike: isVerticalSpread(prev.strategy) ? nearest.strike : prev.longStrike || nearest.strike,
          premium: nearest.mid || prev.premium,
          targetPrice: Number(nextTargetPrice.toFixed(2)),
          ivRank: Number(nextIvRank.toFixed(2)),
          ivPercentile: Number(nextIvPercentile.toFixed(2)),
          historicalVolatility: Number(nextHv.toFixed(2)),
        }))
        if (loadedBackChain) {
          const backSource = usesPutChain(form) ? loadedBackChain.puts : loadedBackChain.calls
          const backNearest = backSource.reduce<OptionChainRow | null>((best, row) => {
            if (!best) return row
            return Math.abs(row.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? row : best
          }, null)
          if (backNearest) {
            setSelectedLegRows({ sell: nearest, buy: backNearest })
          }
        }
        setParams(prev => {
          prev.set('ticker', data.ticker)
          return prev
        }, { replace: true })
      }
    } catch (err) {
      if (chainRequestSeqRef.current !== reqId) return
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || `Unable to load option chain data for ${clean}. Try another expiration or refresh again.`)
    } finally {
      if (chainRequestSeqRef.current === reqId) setLoading(false)
    }
  }, [form, setParams])

  // Auto-load chain when ticker or relevant expirations change (debounced 600ms).
  useEffect(() => {
    const clean = form.ticker.trim().toUpperCase()
    if (!clean || clean.length < 1) return
    const front = frontExpiration(form)
    const back = form.buyExpiration
    if (
      chain?.ticker === clean
      && chain.selected_expiry === front
      && (!isCalendarLike(form.strategy) || backChain?.selected_expiry === back)
    ) return
    const handle = window.setTimeout(() => {
      void loadChain(clean, front, back)
    }, 600)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticker, form.expiration, form.sellExpiration, form.buyExpiration, form.strategy])

  useEffect(() => {
    const handle = window.setTimeout(() => { void loadJournalHistory(form.ticker) }, 400)
    return () => window.clearTimeout(handle)
  }, [form.ticker, loadJournalHistory])

  useEffect(() => {
    if (!chain) return
    const source = usesPutChain(form) ? chain.puts : chain.calls
    const targetStrike = primaryStrike(form)
    const match = source.reduce<OptionChainRow | null>((best, row) => {
      if (!best) return row
      return Math.abs(row.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? row : best
    }, null)
    if (!match) return
    if (selectedRow?.strike !== match.strike) {
      setSelectedRow(match)
    }
  }, [chain, form.direction, form.longStrike, form.shortCallStrike, form.shortPutStrike, form.shortStrike, form.stockPrice, form.strategy, form.strike, selectedRow?.strike])

  const pros = evaluation?.pros ?? []
  const cons = evaluation?.cons ?? []
  const expiryOptions = chain?.expiries ?? []
  const backExpiryOptions = backChain?.expiries ?? expiryOptions

  const checklistItems = [
    'Trend confirmed',
    'Volume confirmed',
    'Market aligned',
    'Earnings checked',
    'Risk acceptable',
    'Position size acceptable',
    'Stop defined',
    'Profit target defined',
    'Alternative strategies reviewed',
    'Emotional decision avoided',
  ]

  return (
    <div className="min-h-screen bg-surface-page px-4 py-5 text-primary sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <Calculator size={14} /> Pre-trade analysis
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-3xl">Pre-Trade Analysis</h1>
          <p className="mt-1 max-w-3xl text-sm text-tertiary">
            Final checkpoint before placing an options order. Validate the exact strike, expiration, premium, liquidity, risk, payoff, and alternatives.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void loadChain() }}>
          <input aria-label="Ticker symbol" value={form.ticker} onChange={e => update('ticker', e.target.value.toUpperCase())} className="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm font-bold uppercase text-primary outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900" />
          {form.stockPrice > 0 && (
            <span className="inline-flex h-10 items-center rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-200">
              Latest {fmtUsd(form.stockPrice)}
            </span>
          )}
          <button type="submit" className={`${getActionButtonClass('trade')} h-10 rounded-lg px-4 text-sm`} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Load Chain
          </button>
        </form>
      </header>

      {error && <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
      {journalError && <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{journalError}</div>}
      {evaluationError && <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">{evaluationError}</div>}
      {validation.blocked && (
        <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          <div className="mb-1 font-bold uppercase tracking-wide">Blocked — resolve before trading</div>
          <ul className="list-disc space-y-1 pl-5">
            {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {/* Verdict-first: pre-trade guardrails catch contradictions before the score is trusted */}
      <div className="mb-5">
        <TradeGuardrails
          direction={form.direction}
          strategy={form.strategy}
          premium={form.premium}
          stockPrice={form.stockPrice}
          targetPrice={form.targetPrice}
          chainMid={selectedRow?.mid}
          chainBid={selectedRow?.bid}
          chainAsk={selectedRow?.ask}
          openInterest={selectedRow?.open_interest}
          expectedValue={evaluation?.scenario.expectedValue}
          theta={greeks.theta}
          delta={greeks.delta}
          ivFraction={greeks.iv}
          ticker={form.ticker}
          checklistDone={Object.values(checklist).filter(Boolean).length}
          checklistTotal={checklistItems.length}
          invalidatesFilled={journal.invalidates.trim().length > 0}
        />
      </div>

      <section className="mb-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-muted">Trade Quality</div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-5xl font-black tracking-tight text-heading">{score.total}<span className="text-xl text-muted">/100</span></div>
              <div className="mt-1 font-mono text-lg text-amber-500">{stars(score.total)}</div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${getDecisionBadgeClass(score.label)}`}>{score.label}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-secondary">
            Backend evaluation updates as trade inputs, strike, expiration, premium, and selected chain row change.
          </p>
          <div className="mt-4 grid gap-2">
            {[
              ['Trend Alignment', score.trend],
              ['Option Pricing', score.optionPricing],
              ['Time to Expiration', score.time],
              ['Liquidity', score.liquidity],
              ['Probability', score.probability],
              ['Risk/Reward', score.riskReward],
              ['Volatility', score.volatility],
              ['Market Environment', score.market],
            ].map(([label, value]) => <ScoreLine key={label as string} label={label as string} value={value as number} />)}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Trade Inputs" icon={<FileText size={18} />} sub="Manual entry or prefilled from Decision Engine links.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Direction"><select value={form.direction} onChange={e => update('direction', e.target.value as Direction)} className={inputCls}>{directions.map(d => <option key={d}>{d}</option>)}</select></Field>
              <Field label="Strategy">
                <select
                  value={form.strategy}
                  onChange={e => {
                    const strategy = e.target.value as Strategy
                    setSelectedLegRows({})
                    setForm(prev => ({
                      ...prev,
                      strategy,
                      direction: strategy === 'Iron Condor' || strategy === 'Calendar Spread' ? 'Neutral' : prev.direction,
                      sellExpiration: prev.sellExpiration || prev.expiration,
                      buyExpiration: isCalendarLike(strategy) ? (prev.buyExpiration || expirationDaysFromNow(35)) : prev.expiration,
                    }))
                  }}
                  className={inputCls}
                >
                  {strategies.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>

              {isCalendarLike(form.strategy) ? (
                <>
                  <Field label="Sell Strike"><input type="number" step="0.01" value={form.shortStrike} onChange={e => update('shortStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Buy Strike"><input type="number" step="0.01" value={form.longStrike} onChange={e => update('longStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Sell Expiration"><ExpiryInput value={form.sellExpiration} options={expiryOptions} onChange={v => update('sellExpiration', v)} /></Field>
                  <Field label="Buy Expiration"><ExpiryInput value={form.buyExpiration} options={backExpiryOptions} onChange={v => update('buyExpiration', v)} /></Field>
                  <Field label="Net Debit Fallback"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              ) : isIronCondor(form.strategy) ? (
                <>
                  <Field label="Expiration"><ExpiryInput value={form.expiration} options={expiryOptions} onChange={v => update('expiration', v)} /></Field>
                  <Field label="Short Put"><input type="number" step="0.01" value={form.shortPutStrike} onChange={e => update('shortPutStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Long Put"><input type="number" step="0.01" value={form.longPutStrike} onChange={e => update('longPutStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Short Call"><input type="number" step="0.01" value={form.shortCallStrike} onChange={e => update('shortCallStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Long Call"><input type="number" step="0.01" value={form.longCallStrike} onChange={e => update('longCallStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Net Credit"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              ) : isVerticalSpread(form.strategy) ? (
                <>
                  <Field label="Long Strike"><input type="number" step="0.01" value={form.longStrike} onChange={e => update('longStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Short Strike"><input type="number" step="0.01" value={form.shortStrike} onChange={e => update('shortStrike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Expiration"><ExpiryInput value={form.expiration} options={expiryOptions} onChange={v => update('expiration', v)} /></Field>
                  <Field label={isCreditSpread(form.strategy) ? 'Net Credit Fallback' : 'Net Debit Fallback'}><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              ) : (
                <>
                  <Field label="Strike"><input type="number" step="0.01" value={form.strike} onChange={e => update('strike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Expiration"><ExpiryInput value={form.expiration} options={expiryOptions} onChange={v => update('expiration', v)} /></Field>
                  <Field label="Premium"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              )}
              <Field label="Contracts"><input type="number" value={form.contracts} onChange={e => update('contracts', Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Stock Price"><input type="number" step="0.01" value={form.stockPrice} onChange={e => update('stockPrice', Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Target Price"><input type="number" step="0.01" value={form.targetPrice} onChange={e => update('targetPrice', Number(e.target.value))} className={inputCls} /></Field>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedInputs(v => !v)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-secondary hover:text-heading dark:border-white/[0.08]"
            >
              <ChevronDown size={13} className={showAdvancedInputs ? 'rotate-180 transition-transform' : 'transition-transform'} />
              Advanced assumptions
            </button>
            {showAdvancedInputs && (
              <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40 sm:grid-cols-2">
                <Field label="Expected Hold Days"><input type="number" min={1} value={form.expectedHoldDays} onChange={e => update('expectedHoldDays', Number(e.target.value))} className={inputCls} /></Field>
                <Field label="Buying Power"><input type="number" min={0} step="100" value={form.buyingPower} onChange={e => update('buyingPower', Number(e.target.value))} className={inputCls} /></Field>
                <Field label="IV Rank"><input type="number" min={0} max={100} value={form.ivRank} onChange={e => update('ivRank', Number(e.target.value))} className={inputCls} /></Field>
                <Field label="IV Percentile"><input type="number" min={0} max={100} value={form.ivPercentile} onChange={e => update('ivPercentile', Number(e.target.value))} className={inputCls} /></Field>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {isIronCondor(form.strategy) ? (
                <>
                  <LegBadge side="SELL" label={`Sell ${form.shortPutStrike}P`} />
                  <LegBadge side="BUY" label={`Buy ${form.longPutStrike}P`} />
                  <LegBadge side="SELL" label={`Sell ${form.shortCallStrike}C`} />
                  <LegBadge side="BUY" label={`Buy ${form.longCallStrike}C`} />
                  <LegBadge side="CREDIT" label={`Net credit ${fmtUsd(Math.abs(evaluation?.summary.netPremium ?? form.premium) * 100 * form.contracts)}`} />
                </>
              ) : isCalendarLike(form.strategy) ? (
                <>
                  <LegBadge side="SELL" label={`Sell front ${form.shortStrike}`} />
                  <LegBadge side="BUY" label={`Buy back ${form.longStrike}`} />
                  <LegBadge side="DEBIT" label={`Net debit ${fmtUsd(Math.abs(evaluation?.summary.netPremium ?? form.premium) * 100 * form.contracts)}`} />
                </>
              ) : isVerticalSpread(form.strategy) ? (
                <>
                  <LegBadge side="BUY" label={`Buy ${form.longStrike}`} />
                  <LegBadge side="SELL" label={`Sell ${form.shortStrike}`} />
                  <LegBadge side={isCreditSpread(form.strategy) ? 'CREDIT' : 'DEBIT'} label={`${isCreditSpread(form.strategy) ? 'Net credit' : 'Net debit'} ${fmtUsd(Math.abs(evaluation?.summary.netPremium ?? form.premium) * 100 * form.contracts)}`} />
                </>
              ) : (
                <>
                  <LegBadge side="BUY" label={`${form.strategy} ${form.strike}`} />
                  <LegBadge side={evaluation?.summary.netPremiumType === 'credit' ? 'CREDIT' : 'DEBIT'} label={`Premium ${fmtUsd(Math.abs(evaluation?.summary.netPremium ?? form.premium) * 100 * form.contracts)}`} />
                </>
              )}
            </div>
            {(isCalendarLike(form.strategy) || isIronCondor(form.strategy) || isVerticalSpread(form.strategy)) && (
              <div className="mt-3 rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 text-xs leading-relaxed text-sky-800 dark:text-sky-100">
                {isCalendarLike(form.strategy)
                  ? 'Calendar/diagonal structure: sell the front expiration and buy the later expiration. Use net debit for total spread cost.'
                  : isIronCondor(form.strategy)
                    ? 'Iron condor structure: sell the inner put/call strikes and buy the outer wings for protection. Use net credit received.'
                    : isCreditSpread(form.strategy)
                      ? 'Credit spread structure: sell the short strike and buy the protective wing at the same expiration. Use net credit received.'
                      : 'Vertical spread structure: buy one leg and sell the other leg at the same expiration. Use net debit paid.'}
              </div>
            )}
          </Panel>

          <Panel title="Contract Summary" icon={<CircleDollarSign size={18} />} sub="Live chain fields where available; Greeks are estimated until broker data is connected.">
            {chain?.price_source && (
              <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                Latest underlying price loaded from {chain.price_source.replace(/_/g, ' ')}
                {chain.price_fetched_at ? ` at ${new Date(chain.price_fetched_at).toLocaleTimeString()}` : ''}.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Current Stock" value={fmtUsd(form.stockPrice)} />
              <Metric label={evaluation?.summary.netPremiumType === 'credit' ? 'Net Credit / Sh' : 'Net Debit / Sh'} value={fmtUsd(Math.abs(evaluation?.summary.netPremium ?? form.premium))} tone={evaluation?.summary.netPremiumType === 'credit' ? 'good' : undefined} />
              <Metric label={isCalendarLike(form.strategy) ? 'Front / Back DTE' : 'DTE'} value={isCalendarLike(form.strategy) ? `${frontDte} / ${backDte} days` : `${frontDte} days`} tone={frontDte >= 8 ? 'good' : 'caution'} />
              <Metric label="Cost" value={fmtUsd(evaluation?.summary.cost ?? 0)} />
              <Metric label="Max Risk" value={fmtUsd(summaryMaxRisk)} tone="bad" definition={metricDef('max_loss')} />
              <Metric label={isIronCondor(form.strategy) ? 'Breakeven Zone' : 'Breakeven'} value={isIronCondor(form.strategy) ? `${fmtUsd(form.shortPutStrike - form.premium)} - ${fmtUsd(form.shortCallStrike + form.premium)}` : fmtUsd(breakevenPrice)} definition={metricDef('breakeven')} />
              <Metric label="Capital Required" value={fmtUsd(evaluation?.summary.capitalRequired ?? 0)} definition={metricDef('capital_required')} />
              <Metric label="Theta / Day" value={fmtUsd(greeks.theta * 100 * form.contracts)} tone="bad" definition={metricDef('theta_per_day')} />
              <Metric label="Delta" value={greeks.delta.toFixed(2)} definition={metricDef('delta')} />
              <Metric label="IV Rank" value={`${form.ivRank.toFixed(0)}%`} tone={form.ivRank <= 45 ? 'good' : form.ivRank <= 65 ? 'caution' : 'bad'} definition={metricDef('iv_rank')} />
              <Metric label="POP (B/E) / ITM" value={`${popAtBreakeven.toFixed(0)}% / ${greeks.probabilityItm.toFixed(0)}%`} tone={qualityTone(popAtBreakeven, 55, 40)} definition={metricDef('probability_of_profit')} />
              <Metric label="Earnings" value={evaluation ? (evaluation.summary.earningsDate ? `${evaluation.summary.earningsDate} (${evaluation.summary.earningsRisk})` : evaluation.summary.earningsRisk ?? '—') : '—'} tone={evaluation?.summary.earningsRisk === 'High' ? 'bad' : evaluation?.summary.earningsRisk === 'Medium' ? 'caution' : evaluation?.summary.earningsRisk === 'Low' ? 'good' : undefined} />
            </div>
            {evaluation?.summary.earningsMessage && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                evaluation.summary.earningsRisk === 'High'
                  ? 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                  : evaluation.summary.earningsRisk === 'Medium'
                    ? 'border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              }`}>
                {evaluation.summary.earningsMessage}
              </div>
            )}
          </Panel>
        </div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Option Contract Selector" icon={<Layers size={18} />} sub="Choose the exact strike/premium inside the pre-trade analysis.">
          {!chain ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-muted dark:border-slate-700">Load a ticker to review strikes and liquidity.</div>
          ) : isIronCondor(form.strategy) ? (
            <div className="grid gap-4 2xl:grid-cols-2">
              <OptionLegSelector title="Sell Put" side="SELL" kind="put" chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.shortPut} onSelect={row => selectLeg('shortPut', row, { shortPutStrike: row.strike })} />
              <OptionLegSelector title="Buy Put Wing" side="BUY" kind="put" chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.longPut} onSelect={row => selectLeg('longPut', row, { longPutStrike: row.strike })} />
              <OptionLegSelector title="Sell Call" side="SELL" kind="call" chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.shortCall} onSelect={row => selectLeg('shortCall', row, { shortCallStrike: row.strike })} />
              <OptionLegSelector title="Buy Call Wing" side="BUY" kind="call" chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.longCall} onSelect={row => selectLeg('longCall', row, { longCallStrike: row.strike })} />
            </div>
          ) : isCalendarLike(form.strategy) ? (
            <div className="grid gap-4 2xl:grid-cols-2">
              <OptionLegSelector title={`Sell Front ${optionKind.toUpperCase()}`} side="SELL" kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.sell} onSelect={row => selectLeg('sell', row, { shortStrike: row.strike, strike: row.strike })} />
              <OptionLegSelector title={`Buy Back ${optionKind.toUpperCase()}`} side="BUY" kind={optionKind} chain={backChain || chain} stockPrice={form.stockPrice} selected={selectedLegRows.buy} onSelect={row => selectLeg('buy', row, { longStrike: row.strike })} />
            </div>
          ) : isVerticalSpread(form.strategy) ? (
            <div className="grid gap-4 2xl:grid-cols-2">
              {isCreditSpread(form.strategy) ? (
                <>
                  <OptionLegSelector title={`Sell Short ${optionKind.toUpperCase()}`} side="SELL" kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.short} onSelect={row => selectLeg('short', row, { shortStrike: row.strike, strike: row.strike })} />
                  <OptionLegSelector title={`Buy Protection ${optionKind.toUpperCase()}`} side="BUY" kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.long} onSelect={row => selectLeg('long', row, { longStrike: row.strike })} />
                </>
              ) : (
                <>
                  <OptionLegSelector title={`Buy Long ${optionKind.toUpperCase()}`} side="BUY" kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.long} onSelect={row => selectLeg('long', row, { longStrike: row.strike, strike: row.strike })} />
                  <OptionLegSelector title={`Sell Against ${optionKind.toUpperCase()}`} side="SELL" kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedLegRows.short} onSelect={row => selectLeg('short', row, { shortStrike: row.strike })} />
                </>
              )}
            </div>
          ) : (
            <OptionLegSelector title={`${form.strategy} ${optionKind.toUpperCase()}`} side={form.strategy === 'Covered Call' || form.strategy === 'Cash Secured Put' ? 'SELL' : 'BUY'} kind={optionKind} chain={chain} stockPrice={form.stockPrice} selected={selectedRow} onSelect={row => selectLeg(form.strategy === 'Covered Call' || form.strategy === 'Cash Secured Put' ? 'short' : 'long', row, { strike: row.strike }, true)} />
          )}
        </Panel>

        <Panel title="Risk Assessment" icon={<ShieldAlert size={18} />} sub="Why this risk level is assigned.">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-muted">Risk Level</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${riskLevel === 'Medium' ? 'border-amber-400/30 bg-amber-500/10 text-amber-600 dark:text-amber-300' : 'border-rose-400/30 bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}>{riskLevel}</span>
          </div>
          <p className="text-sm leading-relaxed text-secondary">
            {metricDef('risk_level')?.longDescription ?? 'Risk is based on DTE, spread width, IV rank, probability, and required stock move.'}
            {cons.length > 0 ? <> The largest current concern is {cons[0]}.</> : <> No major blocker is currently detected; keep normal options decay and execution discipline in the plan.</>}
          </p>
          <div className="mt-4 grid gap-3">
            <ListBox title="Pros" items={pros.length ? pros : ['No major strength detected yet.']} good />
            <ListBox title="Cons" items={cons.length ? cons : ['No major blocker detected.']} />
          </div>
        </Panel>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Visual Payoff Diagram" icon={<LineChartIcon size={18} />} sub="Expiration payoff by stock price plus time-decay projection before expiration.">
          <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-white/10">
            {(['graph', 'table'] as const).map(v => (
              <button key={v} type="button" onClick={() => setPayoffView(v)}
                className={`rounded-md px-3 py-1 text-xs font-bold capitalize transition-colors ${payoffView === v ? 'bg-violet-600 text-white' : 'text-muted hover:text-secondary'}`}>
                {v}
              </button>
            ))}
          </div>
          {payoffView === 'graph' ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={payoff}>
                <CartesianGrid stroke="var(--border-default)" strokeDasharray="3 3" />
                <XAxis dataKey="price" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={v => fmtUsd(Number(v))} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} labelFormatter={v => `Stock ${fmtUsd(Number(v))}`} />
                <ReferenceLine y={0} stroke="var(--text-secondary)" />
                <ReferenceLine x={form.stockPrice} stroke="#38bdf8" label="Current" />
                {!isIronCondor(form.strategy) && <ReferenceLine x={breakevenPrice} stroke="#f59e0b" label="B/E" />}
                <ReferenceLine x={form.targetPrice} stroke="#22c55e" label="Target" />
                <Area type="monotone" dataKey="pnl" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          ) : evaluation?.payoffMatrix && evaluation.payoffMatrix.columns.length > 0 ? (
          (() => {
            const mtx = evaluation.payoffMatrix!
            const rows = mtx.prices.map((price, i) => ({ price, cells: mtx.grid[i] })).reverse()
            const matrixMaxAbs = Math.max(1, ...mtx.grid.flat().map(v => Math.abs(v)))
            return (
              <div>
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted">
                  <span>Price × time P/L — each cell Black-Scholes priced</span>
                  <span className="flex items-center gap-2 normal-case tracking-normal">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(34,197,94,0.65)' }} /> Profit
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(244,63,94,0.65)' }} /> Loss
                  </span>
                </div>
                <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-white/10">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-surface-card text-[10px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="sticky left-0 z-20 bg-surface-card px-3 py-2 text-left font-black">Stock</th>
                        {mtx.columns.map((col, ci) => (
                          <th key={ci} className="px-2 py-2 text-right font-black">
                            <div className={col.isExpiration ? 'text-violet-500' : ''}>{col.isExpiration ? 'Exp' : col.date}</div>
                            <div className="font-mono text-[9px] font-semibold text-tertiary">{col.daysRemaining}d</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, ri) => {
                        const move = form.stockPrice ? (row.price / form.stockPrice - 1) * 100 : 0
                        const isCurrent = Math.abs(row.price - payoffCurrentPrice) < 1e-6
                        return (
                          <tr key={ri} className={isCurrent ? 'outline outline-2 -outline-offset-2 outline-sky-400' : ''}>
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-surface-card px-3 py-1.5 font-mono font-semibold text-text-primary">
                              {fmtUsd(row.price)}
                              <span className="ml-1 font-sans text-[9px] text-tertiary">{move >= 0 ? '+' : ''}{move.toFixed(0)}%</span>
                              {isCurrent ? <span className="ml-1 text-sky-400">•</span> : null}
                            </td>
                            {row.cells.map((pnl, ci) => {
                              const profit = pnl >= 0
                              const intensity = 0.08 + 0.6 * Math.min(1, Math.abs(pnl) / matrixMaxAbs)
                              const bg = profit ? `rgba(34,197,94,${intensity})` : `rgba(244,63,94,${intensity})`
                              return (
                                <td key={ci} style={{ background: bg }} className="px-2 py-1.5 text-right font-mono font-semibold text-text-primary">
                                  {profit ? '+' : '−'}{fmtUsd(Math.abs(pnl))}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-[10px] text-tertiary">Rows = stock price; columns = dates from today to expiration. Cells show estimated P/L using Black-Scholes at each date; the final column is expiration (intrinsic value).</div>
              </div>
            )
          })()
          ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-surface-card text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-black">Stock @ Exp</th>
                  <th className="px-3 py-2 text-right font-black">Move</th>
                  <th className="px-3 py-2 text-right font-black">P/L $</th>
                  <th className="px-3 py-2 text-right font-black">P/L %</th>
                </tr>
              </thead>
              <tbody>
                {[...payoff].reverse().map((p, i) => {
                  const move = form.stockPrice ? (p.price / form.stockPrice - 1) * 100 : 0
                  const plPct = (p.pnl / payoffRiskDenom) * 100
                  const profit = p.pnl >= 0
                  const intensity = 0.10 + 0.55 * Math.min(1, Math.abs(p.pnl) / payoffMaxAbs)
                  const bg = profit ? `rgba(34,197,94,${intensity})` : `rgba(244,63,94,${intensity})`
                  const isCurrent = p.price === payoffCurrentPrice
                  return (
                    <tr key={i} style={{ background: bg }} className={isCurrent ? 'outline outline-2 -outline-offset-2 outline-sky-400' : ''}>
                      <td className="px-3 py-1.5 font-mono font-semibold text-text-primary">{fmtUsd(p.price)}{isCurrent ? ' •' : ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-secondary">{move >= 0 ? '+' : ''}{move.toFixed(1)}%</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-text-primary">{profit ? '+' : '−'}{fmtUsd(Math.abs(p.pnl))}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-primary">{profit ? '+' : '−'}{Math.abs(plPct).toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-white/[0.07]">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted">Time Projection</div>
                <div className="text-xs text-tertiary">Estimated P/L as days pass before expiration.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                <span className="text-sky-500">Flat price</span>
                <span className="text-emerald-500">Target</span>
                <span className="text-violet-500">Simulator</span>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeBuckets}>
                  <CartesianGrid stroke="var(--border-default)" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={v => `${v}d`} />
                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                  <Tooltip formatter={(v: number) => fmtUsd(v)} labelFormatter={v => `Day ${v}`} />
                  <ReferenceLine y={0} stroke="var(--text-secondary)" />
                  <ReferenceLine x={daysPassed} stroke="#f59e0b" label="Selected" />
                  <Line type="monotone" dataKey="flatPnl" name="Flat price" stroke="#38bdf8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="targetPnl" name="Target price" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="scenarioPnl" name="Simulator" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>

        <TradeExitPlanner
          matrix={evaluation?.payoffMatrix}
          stockPrice={form.stockPrice}
          targetPrice={form.targetPrice}
          breakeven={breakevenPrice}
          maxRisk={summaryMaxRisk}
          direction={form.direction}
        />

        <Panel title="Scenario Simulator" icon={<BarChart3 size={18} />} sub="Estimate price, IV, and time impact before buying.">
          <Slider label="Price Change" value={priceMove} min={-10} max={15} step={1} suffix="%" onChange={setPriceMove} />
          <Slider label="IV Change" value={ivMove} min={-20} max={20} step={5} suffix="%" onChange={setIvMove} />
          <Slider label="Days Passed" value={daysPassed} min={1} max={20} step={1} suffix="d" onChange={setDaysPassed} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Est. Option Value" value={fmtUsd(estimatedValue)} />
            <Metric label="Est. Profit" value={fmtUsd(estimatedProfit)} tone={estimatedProfit >= 0 ? 'good' : 'bad'} />
            <Metric label="ROI" value={fmtPct(estimatedRoi)} tone={estimatedRoi >= 0 ? 'good' : 'bad'} />
            <Metric label="Probability" value={`${score.probability.toFixed(0)}%`} definition={metricDef('probability_of_profit')} />
          </div>
        </Panel>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-2">
        <Panel title="Strategy Comparison" icon={<Target size={18} />} sub="Same thesis, different structures. Highlight the best expression.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted">
                <tr><th className="px-4 py-2 text-left">Strategy</th><th className="px-4 text-right">Capital</th><th className="px-4 text-right">Max Loss</th><th className="px-4 text-right">Max Profit</th><th className="px-4 text-right">POP</th><th className="px-4 text-right">Theta</th><th className="px-4 text-right">Score</th></tr>
              </thead>
              <tbody>
                {comparisons.map((row, i) => {
                  const tone = row.score >= 85
                    ? 'border-emerald-500/30 bg-emerald-500/[0.08]'
                    : row.score >= 70
                      ? 'border-sky-500/30 bg-sky-500/[0.07]'
                      : row.score >= 55
                        ? 'border-amber-500/30 bg-amber-500/[0.08]'
                        : 'border-rose-500/30 bg-rose-500/[0.08]'
                  const label = i === 0 ? 'Best' : row.score >= 70 ? 'Good' : row.score >= 55 ? 'Caution' : 'Avoid'
                  return (
                    <tr key={row.strategy} className={`${tone} transition-colors`}>
                      <td className={`rounded-l-xl border-y border-l px-4 py-3 ${tone}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-heading">{row.strategy}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${scoreTone(i === 0 ? 95 : row.score)}`}>{label}</span>
                        </div>
                      </td>
                      <td className={`border-y px-4 py-3 text-right font-mono ${tone}`}>{fmtUsd(row.capital)}</td>
                      <td className={`border-y px-4 py-3 text-right font-mono font-semibold text-rose-600 dark:text-rose-300 ${tone}`}>{fmtUsd(row.maxLoss)}</td>
                      <td className={`border-y px-4 py-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-300 ${tone}`}>{typeof row.maxProfit === 'number' ? fmtUsd(row.maxProfit) : row.maxProfit}</td>
                      <td className={`border-y px-4 py-3 text-right font-mono ${row.pop >= 60 ? 'text-emerald-500' : row.pop >= 45 ? 'text-amber-500' : 'text-rose-500'} ${tone}`}>{row.pop.toFixed(0)}%</td>
                      <td className={`border-y px-4 py-3 text-right ${row.theta.toLowerCase().includes('positive') ? 'text-emerald-500' : row.theta.toLowerCase().includes('lower') ? 'text-amber-500' : 'text-rose-500'} ${tone}`}>{row.theta}</td>
                      <td className={`rounded-r-xl border-y border-r px-4 py-3 text-right ${tone}`}>
                        <span className={`inline-flex min-w-12 justify-center rounded-full border px-2 py-1 font-mono text-xs font-black ${scoreTone(row.score)}`}>{row.score}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-500/10 p-3 text-sm text-violet-800 dark:text-violet-100">
            Better alternative: <span className="font-bold">{bestStrategy?.strategy ?? 'Load evaluation'}</span>. Backend scoring compares capital efficiency, probability, and theta exposure versus the selected contract.
          </div>
        </Panel>

        <Panel title="Exit Plan" icon={<BookOpenCheck size={18} />} sub="Pre-commit before placing the order.">
          <div className="grid gap-2 sm:grid-cols-2">
            {exitPlanForStrategy(form.strategy).map(item => <PlanItem key={item.label} label={item.label} value={item.value} danger={item.danger} />)}
            <PlanItem label="Time Stop" value={`${Math.max(1, Math.min(form.expectedHoldDays, frontDte - 2))} days`} />
            <PlanItem label="IV Exit" value="Exit if IV crush > 15%" danger />
            <PlanItem label="Expiration Exit" value="Close before final 2 DTE" danger />
          </div>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-secondary dark:bg-slate-950/50">
            Success requirement: {form.ticker} needs to move approximately {isIronCondor(form.strategy) ? 'inside the short strike range' : fmtPct((breakevenPrice / form.stockPrice - 1) * 100, 1)} {isIronCondor(form.strategy) ? '' : 'toward breakeven '}within {form.expectedHoldDays} trading days while IV remains stable.
          </div>
        </Panel>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-3">
        <Panel title="Greeks Explained" icon={<Sparkles size={18} />} sub="Translate Greeks into practical risk.">
          <Greek label="Delta" value={greeks.delta.toFixed(2)} text={metricDef('delta')?.longDescription ?? `A $1 stock move changes the option by roughly ${fmtUsd(Math.abs(greeks.delta))} per share before gamma effects.`} />
          <Greek label="Theta" value={fmtUsd(greeks.theta)} text={metricDef('theta_per_day')?.longDescription ?? `Estimated daily decay is ${fmtUsd(Math.abs(greeks.theta * 100 * form.contracts))} for this position.`} />
          <Greek label="Gamma" value={greeks.gamma.toFixed(4)} text={metricDef('gamma')?.longDescription ?? 'Gamma shows how quickly delta changes as the stock moves. Short DTE increases gamma risk.'} />
          <Greek label="Vega" value={greeks.vega.toFixed(2)} text={metricDef('vega')?.longDescription ?? `A 1 point IV change changes the option by roughly ${fmtUsd(greeks.vega)} per share.`} />
        </Panel>

        <Panel title="Checklist Before Buying" icon={<CheckCircle2 size={18} />} sub="Make the emotional decision visible.">
          <div className="grid gap-2">
            {checklistItems.map(item => (
              <label key={item} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-secondary dark:bg-slate-950/50">
                <input type="checkbox" checked={!!checklist[item]} onChange={e => setChecklist(prev => ({ ...prev, [item]: e.target.checked }))} className="accent-violet-600" />
                {item}
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="AI Coach" icon={<BrainCircuit size={18} />} sub="Contract-level coaching before order entry.">
          {(evaluation?.coach?.length ? evaluation.coach : ['Load or edit trade inputs to get backend contract-level coaching.']).map(text => (
            <CoachLine key={text} text={text} />
          ))}
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Probability Analysis" icon={<LineChartIcon size={18} />} sub="Estimates based on current inputs, IV, and simplified distribution math.">
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric label="Prob. Profit (at B/E)" value={`${popAtBreakeven.toFixed(0)}%`} tone={qualityTone(popAtBreakeven, 55, 40)} definition={metricDef('probability_of_profit')} />
            <Metric label="Probability ITM (strike)" value={`${greeks.probabilityItm.toFixed(0)}%`} definition={metricDef('probability_itm')} />
            <Metric label="Probability OTM" value={`${greeks.probabilityOtm.toFixed(0)}%`} definition={metricDef('probability_otm')} />
            <Metric label="Expected Value" value={fmtUsd(evaluation?.scenario.expectedValue ?? 0)} definition={metricDef('expected_value')} />
            <Metric label="Expected Return" value={fmtPct(evaluation?.scenario.expectedReturn ?? 0)} definition={metricDef('expected_return')} />
            <Metric label="Expected Drawdown" value={fmtUsd(evaluation?.scenario.expectedDrawdown ?? 0)} tone="bad" definition={metricDef('expected_drawdown')} />
          </div>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evaluation?.scenario.priceBuckets ?? []}>
                <CartesianGrid stroke="var(--border-default)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Trade Journal" icon={<FileText size={18} />} sub="Save your rationale before execution.">
          <div className="grid gap-3">
            <Textarea label="Why am I entering?" value={journal.why} onChange={v => setJournal(prev => ({ ...prev, why: v }))} />
            <Textarea label="What invalidates the trade?" value={journal.invalidates} onChange={v => setJournal(prev => ({ ...prev, invalidates: v }))} />
            <Textarea label="Expected catalyst" value={journal.catalyst} onChange={v => setJournal(prev => ({ ...prev, catalyst: v }))} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Expected Hold"><input value={journal.hold} onChange={e => setJournal(prev => ({ ...prev, hold: e.target.value }))} className={smallInputCls} placeholder="3-5 days" /></Field>
              <Field label="Confidence"><input type="number" min={1} max={10} value={journal.confidence} onChange={e => setJournal(prev => ({ ...prev, confidence: Number(e.target.value) }))} className={smallInputCls} /></Field>
              <Field label="Emotion"><select value={journal.emotion} onChange={e => setJournal(prev => ({ ...prev, emotion: e.target.value as Emotion }))} className={smallInputCls}>{(['Calm', 'FOMO', 'Revenge', 'Speculative'] as Emotion[]).map(e => <option key={e}>{e}</option>)}</select></Field>
            </div>
            {(() => {
              const blockReason = validation.blocked
                ? 'Resolve the blocking validation above before saving.'
                : journal.invalidates.trim().length === 0
                ? 'Fill in “What invalidates the trade?” before saving.'
                : Object.values(checklist).filter(Boolean).length < checklistItems.length
                  ? 'Complete the pre-buy checklist before saving.'
                  : ''
              return (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  {blockReason && !journalSaved && (
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">{blockReason}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSaveToJournal()}
                    disabled={savingJournal || !evaluation || !user?.email || !!blockReason}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                      journalSaved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40'
                    }`}
                  >
                    {journalSaved ? (
                      <><CheckCircle2 size={16} /> Saved to Journal</>
                    ) : savingJournal ? (
                      <><Loader2 size={16} className="animate-spin" /> Saving…</>
                    ) : (
                      <><BookOpenCheck size={16} /> Save to Journal</>
                    )}
                  </button>
                </div>
              )
            })()}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-heading">Trade Journal History</div>
                  <div className="text-[11px] text-tertiary">Recent saved worksheet/trade entries for {form.ticker.toUpperCase()}.</div>
                </div>
                {journalHistoryLoading && <Loader2 size={14} className="animate-spin text-violet-500" />}
              </div>
              <div className="grid gap-2">
                {journalHistory.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-muted dark:border-slate-700">
                    No journal history for this ticker yet.
                  </div>
                )}
                {journalHistory.map(entry => (
                  <div key={entry.id ?? `${entry.created_at}-${entry.strategy}`} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-white/[0.07] dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-heading">{entry.strategy || 'Trade'}</span>
                      <span className="font-mono text-[11px] text-tertiary">{entry.entry_date || String(entry.created_at || '').slice(0, 10) || '—'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-secondary">
                      {entry.bias && <span>{entry.bias}</span>}
                      {entry.status && <span>{entry.status}</span>}
                      {typeof entry.total_score === 'number' && <span className="font-mono">Score {entry.total_score.toFixed(0)}</span>}
                    </div>
                    {entry.notes && <div className="mt-1 max-h-10 overflow-hidden text-[11px] leading-relaxed text-tertiary">{entry.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40">
              <button
                type="button"
                onClick={() => setShowCalculationHistory(prev => !prev)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span>
                  <span className="block text-xs font-black uppercase tracking-widest text-heading">Calculation History</span>
                  <span className="block text-[11px] text-tertiary">Frozen backend Trade Worksheet runs owned by your account.</span>
                </span>
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted">
                  {calculationHistoryLoading && <Loader2 size={14} className="animate-spin text-violet-500" />}
                  {calculationHistory.length}
                  <ChevronDown size={14} className={`transition-transform ${showCalculationHistory ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {showCalculationHistory && (
                <div className="mt-3 grid gap-2">
                  {calculationHistory.length === 0 && (
                    <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-muted dark:border-slate-700">
                      No frozen calculation runs yet.
                    </div>
                  )}
                  {calculationHistory.map(run => (
                    <CalculationRunRow
                      key={run.run_id}
                      run={run}
                      selected={selectedSnapshot?.snapshot_id === run.snapshot_id}
                      onOpenSnapshot={handleOpenSnapshot}
                    />
                  ))}
                  {selectedSnapshotLoading && (
                    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-muted dark:border-white/[0.07] dark:bg-slate-900">
                      <Loader2 size={14} className="animate-spin text-violet-500" />
                      Loading frozen snapshot...
                    </div>
                  )}
                  {selectedSnapshotError && (
                    <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
                      {selectedSnapshotError}
                    </div>
                  )}
                  {selectedSnapshot && <CalculationSnapshotDetail snapshot={selectedSnapshot} integrity={selectedSnapshotIntegrity} auditLog={selectedSnapshotAuditLog} />}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </section>
    </div>
  )
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs"><span className="text-secondary">{label}</span><span className="font-mono font-bold">{Math.round(value)}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${clamp(value)}%` }} /></div>
    </div>
  )
}

function CalculationRunRow({ run, selected, onOpenSnapshot }: { run: CalculationRun; selected?: boolean; onOpenSnapshot: (snapshotId?: string | null) => void }) {
  const input = run.input as { ticker?: unknown; strategy?: unknown; direction?: unknown }
  const ticker = String(input.ticker || '').toUpperCase() || '—'
  const strategy = String(input.strategy || 'Trade Worksheet')
  const direction = String(input.direction || '')
  const date = run.completed_at_ms || run.created_at_ms
  const statusTone = run.status === 'COMPLETED'
    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  const canOpen = Boolean(run.snapshot_id)
  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={() => onOpenSnapshot(run.snapshot_id)}
      className={`w-full rounded-md border px-3 py-2 text-left text-xs transition ${
        selected
          ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300 dark:border-violet-400/50 dark:bg-violet-500/10 dark:ring-violet-500/40'
          : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/[0.07] dark:bg-slate-900 dark:hover:border-violet-400/40'
      } ${canOpen ? '' : 'cursor-default opacity-80'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-black text-heading">{ticker}</span>
          <span className="font-semibold text-secondary">{strategy}</span>
          {direction && <span className="text-tertiary">{direction}</span>}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusTone}`}>{run.status}</span>
        </div>
        <span className="font-mono text-[11px] text-tertiary">{date ? new Date(date).toLocaleString() : '—'}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-tertiary">
        <span>Run {run.run_id.slice(0, 8)}</span>
        {run.snapshot_id && <span>Snapshot {run.snapshot_id.slice(0, 8)}</span>}
        {run.snapshot_id && <span className="font-semibold text-violet-600 dark:text-violet-300">View frozen output</span>}
        {run.error && <span className="text-rose-500">{run.error}</span>}
      </div>
    </button>
  )
}

function CalculationSnapshotDetail({ snapshot, integrity, auditLog }: { snapshot: CalculationSnapshot; integrity: CalculationSnapshotIntegrity | null; auditLog: CalculationSnapshotAuditLog | null }) {
  const output = snapshot.output as {
    summary?: { ticker?: unknown; strategy?: unknown; frontExpiration?: unknown; backExpiration?: unknown }
    score?: { total?: unknown; label?: unknown }
    calculationSnapshot?: { generatedAt?: unknown }
  }
  const summary = output.summary || {}
  const score = output.score || {}
  const ticker = String(summary.ticker || '').toUpperCase() || '—'
  const strategy = String(summary.strategy || snapshot.run_type)
  const scoreText = typeof score.total === 'number' ? `${score.total.toFixed(0)} / 100` : '—'
  const scoreLabel = String(score.label || 'Frozen output')
  const frozenAt = snapshot.frozen_at_ms ? new Date(snapshot.frozen_at_ms).toLocaleString() : '—'
  const createdAt = snapshot.created_at_ms ? new Date(snapshot.created_at_ms).toLocaleString() : '—'
  const frontExpiration = String(summary.frontExpiration || '—')
  const backExpiration = String(summary.backExpiration || '')
  const verifiedAt = integrity?.verified_at_ms ? new Date(integrity.verified_at_ms).toLocaleString() : '—'
  const integrityTone = integrity?.verified
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-xs dark:border-violet-400/25 dark:bg-violet-500/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-200">Frozen Snapshot</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-black text-heading">{ticker}</span>
            <span className="font-bold text-secondary">{strategy}</span>
            <span className="rounded-full border border-violet-300 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200">
              {scoreLabel}
            </span>
            {integrity && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${integrityTone}`}>
                {integrity.verified ? 'Integrity Verified' : 'Integrity Mismatch'}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-tertiary">
            Frozen at {frozenAt}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Trade Quality</div>
          <div className="font-mono text-lg font-black text-heading">{scoreText}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <SnapshotField label="Run" value={snapshot.run_id} />
        <SnapshotField label="Snapshot" value={snapshot.snapshot_id} />
        <SnapshotField label="Engine" value={snapshot.engine_version} />
        <SnapshotField label="Formula Pack" value={snapshot.formula_pack_version} />
        <SnapshotField label="Metric Definitions" value={snapshot.metric_definitions_version} />
        <SnapshotField label="Created" value={createdAt} />
        <SnapshotField label="Input Hash" value={snapshot.input_hash} mono />
        <SnapshotField label="Output Hash" value={snapshot.output_hash} mono />
        <SnapshotField label="Expiration" value={backExpiration && backExpiration !== frontExpiration ? `${frontExpiration} / ${backExpiration}` : frontExpiration} />
        <SnapshotField label="Metrics Attached" value={String(snapshot.metric_definitions.length)} />
      </div>
      {integrity && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Integrity Check</div>
              <div className="mt-0.5 text-[11px] text-secondary">
                {integrity.verified
                  ? 'Stored input/output hashes match the frozen snapshot payload and linked run.'
                  : `Mismatch detected: ${integrity.mismatches.join(', ') || 'unknown'}.`}
              </div>
            </div>
            <div className="font-mono text-[10px] text-tertiary">{verifiedAt}</div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <IntegrityFlag label="Input Hash" ok={integrity.input_hash_matches} />
            <IntegrityFlag label="Output Hash" ok={integrity.output_hash_matches} />
            <IntegrityFlag label="Run Link" ok={integrity.run_hash_matches} />
          </div>
        </div>
      )}
      {auditLog && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Audit Log</div>
              <div className="mt-0.5 text-[11px] text-secondary">
                Immutable provenance events recorded for this snapshot.
              </div>
            </div>
            <div className="font-mono text-[10px] text-tertiary">{auditLog.count} event{auditLog.count === 1 ? '' : 's'}</div>
          </div>
          <div className="mt-2 grid gap-2">
            {auditLog.events.map(event => (
              <SnapshotAuditEventRow key={event.audit_id} event={event} />
            ))}
            {auditLog.events.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-[11px] text-muted dark:border-slate-700">
                No audit events found for this snapshot.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SnapshotAuditEventRow({ event }: { event: CalculationSnapshotAuditLog['events'][number] }) {
  const createdAt = event.created_at_ms ? new Date(event.created_at_ms).toLocaleString() : '—'
  const runId = String(event.event.runId || '')
  const inputHash = String(event.event.inputHash || '')
  const outputHash = String(event.event.outputHash || '')
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] dark:border-white/[0.07] dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-black uppercase tracking-wide text-heading">{event.event_type.replace(/_/g, ' ')}</span>
        <span className="font-mono text-[10px] text-tertiary">{createdAt}</span>
      </div>
      <div className="mt-1 grid gap-1 text-[10px] text-tertiary sm:grid-cols-3">
        <span className="break-all">Run {runId ? runId.slice(0, 8) : '—'}</span>
        <span className="break-all">Input {inputHash ? inputHash.slice(0, 12) : '—'}</span>
        <span className="break-all">Output {outputHash ? outputHash.slice(0, 12) : '—'}</span>
      </div>
    </div>
  )
}

function IntegrityFlag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
      ok
        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
        : 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
    }`}>
      {label}: {ok ? 'OK' : 'Mismatch'}
    </div>
  )
}

function SnapshotField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-white/[0.07] dark:bg-slate-950/40">
      <div className="text-[9px] font-black uppercase tracking-widest text-tertiary">{label}</div>
      <div className={`mt-0.5 break-all text-[11px] font-semibold text-secondary ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  )
}

function Panel({ title, icon, sub, children }: { title: string; icon: React.ReactNode; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
      <div className="mb-4 flex items-start gap-2">
        <div className="mt-0.5 text-violet-500">{icon}</div>
        <div>
          <h2 className="text-base font-bold text-heading">{title}</h2>
          <p className="mt-0.5 text-xs text-tertiary">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>{children}</label>
}

function ExpiryInput({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  if (options.length > 0) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        {!options.includes(value) && value ? <option value={value}>{value}</option> : null}
        {options.map(exp => <option key={exp} value={exp}>{exp}</option>)}
      </select>
    )
  }
  return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={inputCls} />
}

function LegBadge({ side, label }: { side: 'BUY' | 'SELL' | 'DEBIT' | 'CREDIT'; label: string }) {
  const cls = side === 'BUY'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : side === 'SELL'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : side === 'CREDIT'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${cls}`}>
      <span>{side}</span>
      <span className="font-mono normal-case tracking-normal">{label}</span>
    </span>
  )
}

function OptionLegSelector({
  title,
  side,
  kind,
  chain,
  stockPrice,
  selected,
  onSelect,
}: {
  title: string
  side: 'BUY' | 'SELL'
  kind: 'call' | 'put'
  chain: OptionChainLiquidityResponse
  stockPrice: number
  selected?: OptionChainRow | null
  onSelect: (row: OptionChainRow) => void
}) {
  const rows = (kind === 'put' ? chain.puts : chain.calls)
    .filter(r => Math.abs(r.strike - stockPrice) / Math.max(1, stockPrice) <= 0.20)
    .slice(0, 24)
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/[0.07] dark:bg-slate-950/30">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-heading">{title}</div>
          <div className="text-[10px] text-muted">{chain.selected_expiry} · {chain.dte ?? '--'} DTE</div>
        </div>
        <LegBadge side={side} label={kind.toUpperCase()} />
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-widest text-muted dark:bg-slate-950">
            <tr className="border-b border-slate-200 dark:border-white/[0.07]">
              <th className="py-2 text-left">Strike</th>
              <th className="py-2 text-right text-rose-600 dark:text-rose-300">Bid</th>
              <th className="py-2 text-right text-emerald-600 dark:text-emerald-300">Ask</th>
              <th className="py-2 text-right">Mid</th>
              <th className="py-2 text-right">Spread</th>
              <th className="py-2 text-right">Vol</th>
              <th className="py-2 text-right">OI</th>
              <th className="py-2 text-right">IV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const selectedRow = selected?.strike === row.strike
              const liquid = row.volume >= 100 || row.open_interest >= 500
              const spreadGood = row.spread_pct <= 10
              const rowTone = selectedRow
                ? 'bg-violet-500/12 ring-1 ring-inset ring-violet-500/30'
                : spreadGood && liquid
                  ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.08]'
                  : row.spread_pct > 18
                    ? 'bg-rose-500/[0.05] hover:bg-rose-500/[0.08]'
                    : 'hover:bg-amber-500/[0.07]'
              return (
                <tr key={`${title}-${row.strike}`} onClick={() => onSelect(row)} className={`cursor-pointer border-b border-slate-100 text-secondary transition-colors dark:border-white/[0.04] ${rowTone}`}>
                  <td className="py-2 font-mono font-bold text-heading">${row.strike.toFixed(2)}{row.is_atm ? <span className="ml-1 text-[10px] text-emerald-500">ATM</span> : null}</td>
                  <td className="py-2 text-right font-mono font-semibold text-rose-600 dark:text-rose-300">${row.bid.toFixed(2)}</td>
                  <td className="py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-300">${row.ask.toFixed(2)}</td>
                  <td className="py-2 text-right font-mono text-violet-600 dark:text-violet-300">${row.mid.toFixed(2)}</td>
                  <td className={`py-2 text-right font-mono ${row.spread_pct <= 10 ? 'text-emerald-500' : row.spread_pct <= 18 ? 'text-amber-500' : 'text-rose-500'}`}>{row.spread_pct.toFixed(1)}%</td>
                  <td className={`py-2 text-right font-mono ${row.volume >= 100 ? 'text-emerald-500' : row.volume > 0 ? 'text-amber-500' : 'text-rose-500'}`}>{row.volume}</td>
                  <td className={`py-2 text-right font-mono ${row.open_interest >= 500 ? 'text-emerald-500' : row.open_interest >= 100 ? 'text-amber-500' : 'text-rose-500'}`}>{row.open_interest}</td>
                  <td className={`py-2 text-right font-mono ${row.iv > 200 ? 'text-muted' : row.iv <= 55 ? 'text-emerald-500' : row.iv <= 85 ? 'text-amber-500' : 'text-rose-500'}`}>{row.iv > 200 ? '--' : `${row.iv.toFixed(0)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, tone, definition }: { label: string; value: string; tone?: 'good' | 'caution' | 'bad'; definition?: MetricDefinition }) {
  const cls = tone === 'good'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'caution'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'bad'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-heading'
  const bg = tone === 'good'
    ? 'bg-emerald-500/[0.07] ring-1 ring-inset ring-emerald-500/15'
    : tone === 'caution'
      ? 'bg-amber-500/[0.08] ring-1 ring-inset ring-amber-500/15'
      : tone === 'bad'
        ? 'bg-rose-500/[0.07] ring-1 ring-inset ring-rose-500/15'
        : 'bg-slate-50 dark:bg-slate-950/50'
  return (
    <div className={`rounded-lg p-3 ${bg}`} title={definition?.longDescription}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{definition?.label ?? label}</div>
      <div className={`mt-1 font-mono font-bold ${cls}`}>{value}</div>
      {definition?.shortDescription ? <div className="mt-1 text-[10px] leading-snug text-tertiary">{definition.shortDescription}</div> : null}
    </div>
  )
}

function ListBox({ title, items, good }: { title: string; items: string[]; good?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted">{title}</div>
      <div className="space-y-1">
        {items.map(item => <div key={item} className="flex gap-2 text-sm text-secondary"><span className={good ? 'text-emerald-500' : 'text-amber-500'}>{good ? '+' : '-'}</span>{item}</div>)}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void }) {
  return <label className="mb-3 block"><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-secondary">{label}</span><span className="font-mono font-bold">{value}{suffix}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-violet-600" /></label>
}

function PlanItem({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950/50"><div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div><div className={`mt-1 font-bold ${danger ? 'text-rose-500' : 'text-heading'}`}>{value}</div></div>
}

function Greek({ label, value, text }: { label: string; value: string; text: string }) {
  return <div className="mb-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/50"><div className="flex items-center justify-between"><span className="font-bold text-heading">{label}</span><span className="font-mono font-bold text-violet-500">{value}</span></div><p className="mt-1 text-sm leading-relaxed text-secondary">{text}</p></div>
}

function CoachLine({ text }: { text: string }) {
  return <div className="mb-2 flex gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 p-3 text-sm text-violet-800 dark:text-violet-100"><BrainCircuit size={15} className="mt-0.5 shrink-0" />{text}</div>
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={`${inputCls} resize-y`} /></Field>
}
