import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { fetchOptionChainLiquidity, type OptionChainLiquidityResponse, type OptionChainRow } from '../api/client'
import { getActionButtonClass, getDecisionBadgeClass, getProfitLossTextClass } from '../utils/semanticTrading'

type Direction = 'Bullish' | 'Bearish' | 'Neutral'
type Strategy =
  | 'Long Call'
  | 'Long Put'
  | 'Bull Call Spread'
  | 'Bear Put Spread'
  | 'Calendar Spread'
  | 'Diagonal Spread'
  | 'Iron Condor'
  | 'Covered Call'
  | 'Cash Secured Put'
  | 'Shares'
type Emotion = 'Calm' | 'FOMO' | 'Revenge' | 'Speculative'

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
  'Bear Put Spread',
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
  return strategy === 'Bull Call Spread' || strategy === 'Bear Put Spread'
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

function daysToExpiry(expiration: string) {
  if (!expiration) return 0
  const end = new Date(`${expiration}T16:00:00`)
  const ms = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function estimateGreeks(form: WorksheetForm, row: OptionChainRow | null) {
  const s = Math.max(0.01, form.stockPrice)
  const k = Math.max(0.01, form.strike)
  const dte = Math.max(1, daysToExpiry(form.expiration))
  const t = dte / 365
  const iv = Math.max(0.05, (row?.iv && row.iv < 300 ? row.iv : form.historicalVolatility || 45) / 100)
  const isPut = form.strategy.includes('Put') || form.direction === 'Bearish'
  const d1 = (Math.log(s / k) + (0.5 * iv * iv) * t) / (iv * Math.sqrt(t))
  const d2 = d1 - iv * Math.sqrt(t)
  const callDelta = normCdf(d1)
  const delta = isPut ? callDelta - 1 : callDelta
  const gamma = Math.exp(-d1 * d1 / 2) / (s * iv * Math.sqrt(2 * Math.PI * t))
  const vega = s * Math.sqrt(t) * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / 100
  const theta = -(s * Math.exp(-d1 * d1 / 2) * iv) / (2 * Math.sqrt(2 * Math.PI * t)) / 365
  const pop = isPut ? normCdf(-d2) : normCdf(d2)
  return {
    delta,
    gamma,
    theta,
    vega,
    iv,
    probabilityItm: clamp(pop * 100),
    probabilityOtm: clamp((1 - pop) * 100),
  }
}

function costBasis(form: WorksheetForm) {
  if (form.strategy === 'Shares') return form.stockPrice * form.contracts
  return form.premium * 100 * form.contracts
}

function breakeven(form: WorksheetForm) {
  if (form.strategy.includes('Put') || form.direction === 'Bearish') return form.strike - form.premium
  if (form.strategy === 'Shares') return form.stockPrice
  return form.strike + form.premium
}

function payoffAtPrice(form: WorksheetForm, price: number) {
  const c = form.contracts
  const paid = costBasis(form)
  if (form.strategy === 'Shares') return (price - form.stockPrice) * c
  if (form.strategy === 'Long Put' || form.strategy === 'Bear Put Spread') {
    const intrinsic = Math.max(0, form.strike - price) * 100 * c
    return intrinsic - paid
  }
  if (form.strategy === 'Cash Secured Put') {
    const credit = paid
    const assignmentLoss = Math.max(0, form.strike - price) * 100 * c
    return credit - assignmentLoss
  }
  if (form.strategy === 'Covered Call') {
    const stockPnl = (price - form.stockPrice) * 100 * c
    const callLoss = Math.max(0, price - form.strike) * 100 * c
    return stockPnl + paid - callLoss
  }
  const intrinsic = Math.max(0, price - form.strike) * 100 * c
  return intrinsic - paid
}

function buildPayoff(form: WorksheetForm) {
  const base = Math.max(1, form.stockPrice)
  const points = []
  for (let i = -30; i <= 30; i += 2) {
    const price = base * (1 + i / 100)
    points.push({ price: Number(price.toFixed(2)), pnl: Math.round(payoffAtPrice(form, price)) })
  }
  return points
}

function scoreTrade(form: WorksheetForm, row: OptionChainRow | null, greeks: ReturnType<typeof estimateGreeks>) {
  const dte = daysToExpiry(form.expiration)
  const liquidity = row ? clamp(100 - row.spread_pct * 4 + Math.min(20, row.open_interest / 100)) : 55
  const time = dte >= 8 && dte <= 45 ? 90 : dte < 5 ? 35 : dte <= 90 ? 75 : 60
  const optionPricing = clamp(100 - form.ivRank * 0.45 - (row?.spread_pct ?? 12) * 2)
  const probability = clamp(greeks.probabilityItm + (Math.abs(greeks.delta) >= 0.45 ? 20 : 0))
  const rr = Math.abs((form.targetPrice - form.stockPrice) / Math.max(0.01, form.stockPrice - breakeven(form)))
  const riskReward = clamp(rr * 35)
  const volatility = clamp(100 - Math.max(0, form.ivRank - 40))
  const trend = form.direction === 'Neutral' ? 70 : form.targetPrice > form.stockPrice && form.direction === 'Bullish' ? 85 : form.targetPrice < form.stockPrice && form.direction === 'Bearish' ? 85 : 45
  const market = 78
  const total = Math.round((trend + optionPricing + time + liquidity + probability + riskReward + volatility + market) / 8)
  return {
    total,
    trend,
    optionPricing,
    time,
    liquidity,
    probability,
    riskReward,
    volatility,
    market,
  }
}

function scoreLabel(score: number) {
  if (score >= 90) return 'STRONG BUY'
  if (score >= 78) return 'BUY'
  if (score >= 65) return 'ACCEPTABLE'
  if (score >= 50) return 'WAIT'
  return 'DO NOT BUY'
}

function stars(score: number) {
  const n = Math.max(1, Math.min(5, Math.round(score / 20)))
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)
}

function strategyRows(form: WorksheetForm, score: ReturnType<typeof scoreTrade>) {
  const debit = costBasis(form)
  const credit = Math.max(80, form.premium * 60)
  const rows = [
    { strategy: form.direction === 'Bearish' ? 'Long Put' : 'Long Call', capital: debit, maxLoss: debit, maxProfit: 'Unlimited', pop: score.probability, theta: 'Negative', score: score.total - (form.premium > 6 ? 6 : 0) },
    { strategy: form.direction === 'Bearish' ? 'Bear Put Spread' : 'Bull Call Spread', capital: Math.max(100, debit * 0.55), maxLoss: Math.max(100, debit * 0.55), maxProfit: Math.max(150, debit * 1.2), pop: score.probability + 8, theta: 'Lower drag', score: score.total + 6 },
    { strategy: 'Calendar Spread', capital: Math.max(120, debit * 0.45), maxLoss: Math.max(120, debit * 0.45), maxProfit: 'Defined by IV', pop: score.probability + 4, theta: 'Positive near short leg', score: score.total + (form.ivRank >= 50 ? 5 : -2) },
    { strategy: form.direction === 'Bearish' ? 'Bear Call Credit Spread' : 'Bull Put Credit Spread', capital: Math.max(400, debit * 1.4), maxLoss: Math.max(300, debit), maxProfit: credit, pop: score.probability + 12, theta: 'Positive', score: score.total + (form.ivRank >= 45 ? 8 : -4) },
    { strategy: 'Shares', capital: form.stockPrice * 100, maxLoss: form.stockPrice * 100, maxProfit: 'Unlimited', pop: 50, theta: 'None', score: score.total - 8 },
  ].map(r => ({ ...r, score: Math.round(clamp(r.score)) }))
  return rows.sort((a, b) => b.score - a.score)
}

function expirationDaysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
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
  const [selectedRow, setSelectedRow] = useState<OptionChainRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [priceMove, setPriceMove] = useState(5)
  const [ivMove, setIvMove] = useState(0)
  const [daysPassed, setDaysPassed] = useState(3)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [journal, setJournal] = useState({
    why: '',
    invalidates: '',
    catalyst: '',
    hold: '',
    confidence: 7,
    emotion: 'Calm' as Emotion,
  })

  const rows = useMemo(() => {
    if (!chain) return []
    const source = form.direction === 'Bearish' || form.strategy.includes('Put') ? chain.puts : chain.calls
    return source.filter(r => Math.abs(r.strike - form.stockPrice) / Math.max(1, form.stockPrice) <= 0.18)
  }, [chain, form.direction, form.stockPrice, form.strategy])

  const greeks = useMemo(() => estimateGreeks(form, selectedRow), [form, selectedRow])
  const score = useMemo(() => scoreTrade(form, selectedRow, greeks), [form, greeks, selectedRow])
  const payoff = useMemo(() => buildPayoff(form), [form])
  const comparisons = useMemo(() => strategyRows(form, score), [form, score])
  const bestStrategy = comparisons[0]
  const simPrice = form.stockPrice * (1 + priceMove / 100)
  const estimatedValue = Math.max(0.01, form.premium + (simPrice - form.stockPrice) * greeks.delta + ivMove / 100 * greeks.vega * 100 + greeks.theta * daysPassed)
  const estimatedProfit = (estimatedValue - form.premium) * 100 * form.contracts
  const estimatedRoi = costBasis(form) > 0 ? estimatedProfit / costBasis(form) * 100 : 0
  const riskLevel = score.total >= 82 ? 'Medium' : score.total >= 65 ? 'High' : 'Extreme'

  const update = <K extends keyof WorksheetForm>(key: K, value: WorksheetForm[K]) => setForm(prev => ({ ...prev, [key]: value }))

  const loadChain = useCallback(async (ticker = form.ticker, expiry = form.expiration) => {
    const clean = ticker.trim().toUpperCase()
    if (!clean) return
    setLoading(true)
    setError('')
    try {
      let data: OptionChainLiquidityResponse
      try {
        data = await fetchOptionChainLiquidity(clean, expiry)
      } catch {
        data = await fetchOptionChainLiquidity(clean, expiry, true)
      }
      setChain(data)
      const source = form.direction === 'Bearish' || form.strategy.includes('Put') ? data.puts : data.calls
      const nearest = source.reduce<OptionChainRow | null>((best, row) => {
        if (!best) return row
        return Math.abs(row.strike - form.strike) < Math.abs(best.strike - form.strike) ? row : best
      }, null)
      if (nearest) {
        setSelectedRow(nearest)
        setForm(prev => ({
          ...prev,
          ticker: data.ticker,
          stockPrice: data.current_price,
          expiration: data.selected_expiry,
          sellExpiration: data.selected_expiry,
          buyExpiration: isCalendarLike(prev.strategy) ? prev.buyExpiration : data.selected_expiry,
          strike: nearest.strike,
          shortStrike: nearest.strike,
          longStrike: prev.longStrike || nearest.strike,
          premium: nearest.mid || prev.premium,
          historicalVolatility: nearest.iv && nearest.iv < 300 ? nearest.iv : prev.historicalVolatility,
        }))
        setParams(prev => {
          prev.set('ticker', data.ticker)
          return prev
        }, { replace: true })
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || `Unable to load option chain data for ${clean}. Try another expiration or refresh again.`)
    } finally {
      setLoading(false)
    }
  }, [form.direction, form.expiration, form.strategy, form.strike, form.ticker, setParams])

  useEffect(() => {
    if (params.get('ticker')) void loadChain(params.get('ticker') || form.ticker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pros = [
    score.trend >= 75 && 'Trend aligns with selected direction',
    score.liquidity >= 70 && 'Liquidity is acceptable for entry and exit',
    score.time >= 75 && 'Expiration gives the thesis enough time',
    score.riskReward >= 65 && 'Reward/risk is reasonable',
    form.ivRank <= 55 && 'Premium is not severely inflated by IV',
  ].filter(Boolean) as string[]
  const cons = [
    score.liquidity < 70 && 'Bid/ask spread or open interest is weak',
    form.ivRank > 60 && 'Premium is expensive due to elevated IV',
    daysToExpiry(form.expiration) < 7 && 'Expiration is short; theta and gamma risk are high',
    score.riskReward < 55 && 'Reward/risk is not attractive enough',
    Math.abs(form.targetPrice / form.stockPrice - 1) > 0.12 && 'Target requires a large move',
  ].filter(Boolean) as string[]

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
          <input value={form.ticker} onChange={e => update('ticker', e.target.value.toUpperCase())} className="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm font-bold uppercase text-primary outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900" />
          <button type="submit" className={`${getActionButtonClass('trade')} h-10 rounded-lg px-4 text-sm`} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Load Chain
          </button>
        </form>
      </header>

      {error && <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

      <section className="mb-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-muted">Trade Quality</div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-5xl font-black tracking-tight text-heading">{score.total}<span className="text-xl text-muted">/100</span></div>
              <div className="mt-1 font-mono text-lg text-amber-500">{stars(score.total)}</div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${getDecisionBadgeClass(scoreLabel(score.total))}`}>{scoreLabel(score.total)}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-secondary">
            {score.total >= 80
              ? `This is a high-quality ${form.direction.toLowerCase()} worksheet. The selected contract has acceptable time, liquidity, and probability for the thesis.`
              : `This contract needs caution. Review liquidity, expiration, premium, and alternatives before committing capital.`}
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
                  <Field label="Sell Expiration"><input type="date" value={form.sellExpiration} onChange={e => update('sellExpiration', e.target.value)} className={inputCls} /></Field>
                  <Field label="Buy Expiration"><input type="date" value={form.buyExpiration} onChange={e => update('buyExpiration', e.target.value)} className={inputCls} /></Field>
                  <Field label="Net Debit"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              ) : isIronCondor(form.strategy) ? (
                <>
                  <Field label="Expiration"><input type="date" value={form.expiration} onChange={e => update('expiration', e.target.value)} className={inputCls} /></Field>
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
                  <Field label="Expiration"><input type="date" value={form.expiration} onChange={e => update('expiration', e.target.value)} className={inputCls} /></Field>
                  <Field label="Net Debit"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              ) : (
                <>
                  <Field label="Strike"><input type="number" step="0.01" value={form.strike} onChange={e => update('strike', Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Expiration"><input type="date" value={form.expiration} onChange={e => update('expiration', e.target.value)} className={inputCls} /></Field>
                  <Field label="Premium"><input type="number" step="0.01" value={form.premium} onChange={e => update('premium', Number(e.target.value))} className={inputCls} /></Field>
                </>
              )}
              <Field label="Contracts"><input type="number" value={form.contracts} onChange={e => update('contracts', Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Stock Price"><input type="number" step="0.01" value={form.stockPrice} onChange={e => update('stockPrice', Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Target Price"><input type="number" step="0.01" value={form.targetPrice} onChange={e => update('targetPrice', Number(e.target.value))} className={inputCls} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {isIronCondor(form.strategy) ? (
                <>
                  <LegBadge side="SELL" label={`Sell ${form.shortPutStrike}P`} />
                  <LegBadge side="BUY" label={`Buy ${form.longPutStrike}P`} />
                  <LegBadge side="SELL" label={`Sell ${form.shortCallStrike}C`} />
                  <LegBadge side="BUY" label={`Buy ${form.longCallStrike}C`} />
                  <LegBadge side="CREDIT" label={`Net credit ${fmtUsd(form.premium * 100 * form.contracts)}`} />
                </>
              ) : isCalendarLike(form.strategy) ? (
                <>
                  <LegBadge side="SELL" label={`Sell front ${form.shortStrike}`} />
                  <LegBadge side="BUY" label={`Buy back ${form.longStrike}`} />
                  <LegBadge side="DEBIT" label={`Net debit ${fmtUsd(form.premium * 100 * form.contracts)}`} />
                </>
              ) : isVerticalSpread(form.strategy) ? (
                <>
                  <LegBadge side="BUY" label={`Buy ${form.longStrike}`} />
                  <LegBadge side="SELL" label={`Sell ${form.shortStrike}`} />
                  <LegBadge side="DEBIT" label={`Net debit ${fmtUsd(form.premium * 100 * form.contracts)}`} />
                </>
              ) : (
                <>
                  <LegBadge side="BUY" label={`${form.strategy} ${form.strike}`} />
                  <LegBadge side="DEBIT" label={`Premium ${fmtUsd(form.premium * 100 * form.contracts)}`} />
                </>
              )}
            </div>
            {(isCalendarLike(form.strategy) || isIronCondor(form.strategy) || isVerticalSpread(form.strategy)) && (
              <div className="mt-3 rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 text-xs leading-relaxed text-sky-800 dark:text-sky-100">
                {isCalendarLike(form.strategy)
                  ? 'Calendar/diagonal structure: sell the front expiration and buy the later expiration. Use net debit for total spread cost.'
                  : isIronCondor(form.strategy)
                    ? 'Iron condor structure: sell the inner put/call strikes and buy the outer wings for protection. Use net credit received.'
                    : 'Vertical spread structure: buy one leg and sell the other leg at the same expiration. Use net debit paid.'}
              </div>
            )}
          </Panel>

          <Panel title="Contract Summary" icon={<CircleDollarSign size={18} />} sub="Live chain fields where available; Greeks are estimated until broker data is connected.">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Current Stock" value={fmtUsd(form.stockPrice)} />
              <Metric label="DTE" value={`${daysToExpiry(form.expiration)} days`} tone={daysToExpiry(form.expiration) >= 8 ? 'good' : 'caution'} />
              <Metric label="Cost" value={fmtUsd(costBasis(form))} />
              <Metric label="Max Risk" value={fmtUsd(costBasis(form))} tone="bad" />
              <Metric label="Breakeven" value={fmtUsd(breakeven(form))} />
              <Metric label="Capital Required" value={fmtUsd(costBasis(form))} />
              <Metric label="Theta / Day" value={fmtUsd(greeks.theta * 100 * form.contracts)} tone="bad" />
              <Metric label="Delta" value={greeks.delta.toFixed(2)} />
              <Metric label="IV Rank" value={`${form.ivRank.toFixed(0)}%`} tone={form.ivRank <= 45 ? 'good' : form.ivRank <= 65 ? 'caution' : 'bad'} />
              <Metric label="POP / ITM" value={`${score.probability.toFixed(0)}% / ${greeks.probabilityItm.toFixed(0)}%`} tone={qualityTone(score.probability, 60, 45)} />
            </div>
          </Panel>
        </div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Option Contract Selector" icon={<Layers size={18} />} sub="Choose the exact strike/premium inside the pre-trade analysis.">
          {!chain ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-muted dark:border-slate-700">Load a ticker to review strikes and liquidity.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted">
                  <tr className="border-b border-slate-200 dark:border-white/[0.07]">
                    <th className="py-2 text-left">Strike</th>
                    <th className="py-2 text-right text-rose-600 dark:text-rose-300">Sell / Bid</th>
                    <th className="py-2 text-right text-emerald-600 dark:text-emerald-300">Buy / Ask</th>
                    <th className="py-2 text-right">Mid</th>
                    <th className="py-2 text-right">Spread</th>
                    <th className="py-2 text-right">Volume</th>
                    <th className="py-2 text-right">OI</th>
                    <th className="py-2 text-right">IV</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const selected = selectedRow?.strike === row.strike
                    const liquid = row.volume >= 100 || row.open_interest >= 500
                    const spreadGood = row.spread_pct <= 10
                    const rowTone = selected
                      ? 'bg-violet-500/12 ring-1 ring-inset ring-violet-500/30'
                      : spreadGood && liquid
                        ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.08]'
                        : row.spread_pct > 18
                          ? 'bg-rose-500/[0.05] hover:bg-rose-500/[0.08]'
                          : 'hover:bg-amber-500/[0.07]'
                    return (
                      <tr key={row.strike} onClick={() => {
                        setSelectedRow(row)
                        setForm(prev => ({ ...prev, strike: row.strike, premium: row.mid || prev.premium, historicalVolatility: row.iv && row.iv < 300 ? row.iv : prev.historicalVolatility }))
                      }} className={`cursor-pointer border-b border-slate-100 text-secondary transition-colors dark:border-white/[0.04] ${rowTone}`}>
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
          )}
        </Panel>

        <Panel title="Risk Assessment" icon={<ShieldAlert size={18} />} sub="Why this risk level is assigned.">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-muted">Risk Level</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${riskLevel === 'Medium' ? 'border-amber-400/30 bg-amber-500/10 text-amber-600 dark:text-amber-300' : 'border-rose-400/30 bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}>{riskLevel}</span>
          </div>
          <p className="text-sm leading-relaxed text-secondary">
            Risk is based on DTE, spread width, IV rank, probability, and required stock move. The largest current concern is {cons[0] || 'standard options decay and execution discipline'}.
          </p>
          <div className="mt-4 grid gap-3">
            <ListBox title="Pros" items={pros.length ? pros : ['No major strength detected yet.']} good />
            <ListBox title="Cons" items={cons.length ? cons : ['No major blocker detected.']} />
          </div>
        </Panel>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Visual Payoff Diagram" icon={<LineChartIcon size={18} />} sub="Profit at expiration with breakeven, current price, and target price.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={payoff}>
                <CartesianGrid stroke="var(--border-default)" strokeDasharray="3 3" />
                <XAxis dataKey="price" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} labelFormatter={v => `Stock ${fmtUsd(Number(v))}`} />
                <ReferenceLine y={0} stroke="var(--text-secondary)" />
                <ReferenceLine x={form.stockPrice} stroke="#38bdf8" label="Current" />
                <ReferenceLine x={breakeven(form)} stroke="#f59e0b" label="B/E" />
                <ReferenceLine x={form.targetPrice} stroke="#22c55e" label="Target" />
                <Area type="monotone" dataKey="pnl" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Scenario Simulator" icon={<BarChart3 size={18} />} sub="Estimate price, IV, and time impact before buying.">
          <Slider label="Price Change" value={priceMove} min={-10} max={15} step={1} suffix="%" onChange={setPriceMove} />
          <Slider label="IV Change" value={ivMove} min={-20} max={20} step={5} suffix="%" onChange={setIvMove} />
          <Slider label="Days Passed" value={daysPassed} min={1} max={20} step={1} suffix="d" onChange={setDaysPassed} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Est. Option Value" value={fmtUsd(estimatedValue)} />
            <Metric label="Est. Profit" value={fmtUsd(estimatedProfit)} tone={estimatedProfit >= 0 ? 'good' : 'bad'} />
            <Metric label="ROI" value={fmtPct(estimatedRoi)} tone={estimatedRoi >= 0 ? 'good' : 'bad'} />
            <Metric label="Probability" value={`${score.probability.toFixed(0)}%`} />
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
            Better alternative: <span className="font-bold">{bestStrategy.strategy}</span>. It scores higher because it improves capital efficiency, probability, or theta exposure versus the selected contract.
          </div>
        </Panel>

        <Panel title="Exit Plan" icon={<BookOpenCheck size={18} />} sub="Pre-commit before placing the order.">
          <div className="grid gap-2 sm:grid-cols-2">
            <PlanItem label="Take Profit 1" value="+40%" />
            <PlanItem label="Take Profit 2" value="+75%" />
            <PlanItem label="Stop Loss" value="-30%" danger />
            <PlanItem label="Time Stop" value={`${Math.max(1, Math.min(form.expectedHoldDays, daysToExpiry(form.expiration) - 2))} days`} />
            <PlanItem label="IV Exit" value="Exit if IV crush > 15%" danger />
            <PlanItem label="Expiration Exit" value="Close before final 2 DTE" danger />
          </div>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-secondary dark:bg-slate-950/50">
            Success requirement: {form.ticker} needs to move approximately {fmtPct((breakeven(form) / form.stockPrice - 1) * 100, 1)} toward breakeven within {form.expectedHoldDays} trading days while IV remains stable.
          </div>
        </Panel>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-3">
        <Panel title="Greeks Explained" icon={<Sparkles size={18} />} sub="Translate Greeks into practical risk.">
          <Greek label="Delta" value={greeks.delta.toFixed(2)} text={`A $1 stock move changes the option by roughly ${fmtUsd(Math.abs(greeks.delta))} per share before gamma effects.`} />
          <Greek label="Theta" value={fmtUsd(greeks.theta)} text={`Estimated daily decay is ${fmtUsd(Math.abs(greeks.theta * 100 * form.contracts))} for this position.`} />
          <Greek label="Gamma" value={greeks.gamma.toFixed(4)} text="Gamma shows how quickly delta changes as the stock moves. Short DTE increases gamma risk." />
          <Greek label="Vega" value={greeks.vega.toFixed(2)} text={`A 1 point IV change changes the option by roughly ${fmtUsd(greeks.vega)} per share.`} />
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
          <CoachLine text={form.ivRank > 60 ? 'Premium is expensive. Consider a debit spread or wait for IV to cool.' : 'Premium is not unusually expensive relative to IV inputs.'} />
          <CoachLine text={daysToExpiry(form.expiration) < 7 ? 'Expiration is too short for most non-scalp trades. Consider adding another week.' : 'Expiration gives enough time for the expected hold.'} />
          <CoachLine text={Math.abs(greeks.delta) < 0.35 ? 'Current strike is far OTM. One strike ITM may improve probability.' : 'Delta is reasonable for directional exposure.'} />
          <CoachLine text={bestStrategy.strategy !== form.strategy ? `${bestStrategy.strategy} may express this thesis more efficiently than the selected structure.` : 'Selected strategy is competitive against alternatives.'} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Probability Analysis" icon={<LineChartIcon size={18} />} sub="Estimates based on current inputs, IV, and simplified distribution math.">
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric label="Probability Profit" value={`${score.probability.toFixed(0)}%`} />
            <Metric label="Probability ITM" value={`${greeks.probabilityItm.toFixed(0)}%`} />
            <Metric label="Probability OTM" value={`${greeks.probabilityOtm.toFixed(0)}%`} />
            <Metric label="Expected Value" value={fmtUsd((score.probability / 100) * Math.max(1, payoffAtPrice(form, form.targetPrice)) - (1 - score.probability / 100) * costBasis(form))} />
            <Metric label="Expected Return" value={fmtPct(((score.probability / 100) * Math.max(1, payoffAtPrice(form, form.targetPrice)) - (1 - score.probability / 100) * costBasis(form)) / Math.max(1, costBasis(form)) * 100)} />
            <Metric label="Expected Drawdown" value={fmtUsd(costBasis(form) * 0.3)} tone="bad" />
          </div>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[
                { label: '-10%', value: payoffAtPrice(form, form.stockPrice * 0.9) },
                { label: '-5%', value: payoffAtPrice(form, form.stockPrice * 0.95) },
                { label: 'Flat', value: payoffAtPrice(form, form.stockPrice) },
                { label: '+5%', value: payoffAtPrice(form, form.stockPrice * 1.05) },
                { label: '+10%', value: payoffAtPrice(form, form.stockPrice * 1.1) },
              ]}>
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'caution' | 'bad' }) {
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
  return <div className={`rounded-lg p-3 ${bg}`}><div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div><div className={`mt-1 font-mono font-bold ${cls}`}>{value}</div></div>
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
