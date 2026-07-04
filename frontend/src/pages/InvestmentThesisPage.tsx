import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Filter,
  Globe2,
  Layers,
  LineChart as LineChartIcon,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  Trash2,
} from 'lucide-react'
import {
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { generateInvestmentThesisStarter, type InvestmentThesisStarter } from '../api/client'
import { getActionButtonClass, getDecisionBadgeClass, getProfitLossTextClass } from '../utils/semanticTrading'

type ThesisStatus = 'Watching' | 'Researching' | 'Accumulating' | 'Holding' | 'Exited'
type Impact = 'Positive' | 'Neutral' | 'Negative'
type Confidence = 'High' | 'Medium' | 'Low'
type CatalystStatus = 'Upcoming' | 'Completed' | 'Cancelled'
type RiskLevel = 'Low' | 'Medium' | 'High'

interface Company {
  name: string
  ticker: string
  logo: string
  currentPrice: number
  dailyChangePct: number
  sector: string
  marketCap: string
  nextEarnings: string
}

interface BuyZone {
  id: string
  label: string
  price: string
  reason: string
  allocation: string
}

interface AccumulationPlan {
  maxAllocationPct: number
  maxInvestment: number
  targetAllocationPct: number
  steps: string[]
}

interface Catalyst {
  id: string
  date: string
  title: string
  description: string
  impact: Impact
  status: CatalystStatus
}

interface Risk {
  id: string
  title: string
  severity: RiskLevel
  probability: RiskLevel
  notes: string
}

interface NewsEntry {
  id: string
  date: string
  headline: string
  source: string
  url: string
  aiSummary: string
  notes: string
  impact: Impact
  confidence: Confidence
}

interface TimelineEvent {
  id: string
  date: string
  title: string
  description: string
}

interface QuarterlyReview {
  id: string
  quarter: string
  revenueGrowth: boolean
  marginsImprove: boolean
  aiProgress: boolean
  managementExecution: boolean
  thesisStronger: boolean
  valuationAttractive: boolean
  convictionChange: 'Increase' | 'Decrease' | 'Hold'
  notes: string
}

interface InvestmentChecklist {
  annualReport: boolean
  latestTenQ: boolean
  earningsCall: boolean
  competitors: boolean
  tam: boolean
  risks: boolean
  valuation: boolean
  quarterlyReview: boolean
  yearlyReview: boolean
}

interface PortfolioSnapshot {
  ownedShares: number
  averageCost: number
  targetAllocationPct: number
  currentAllocationPct: number
  dividendYieldPct: number
}

interface ConvictionHistory {
  date: string
  score: number
}

interface InvestmentThesis {
  id: string
  company: Company
  status: ThesisStatus
  theme: string
  aiExposure: boolean
  dividend: boolean
  rating: number
  buyZone: string
  targetPrice: number
  thesisMarkdown: string
  originalThesis: {
    createdDate: string
    createdBy: string
    originalNews: string
    initialTargetPrice: number
    initialConviction: number
    originalNotes: string
  }
  aiSummary: string
  quality: {
    businessQuality: number
    management: number
    moat: number
    growth: number
    aiOpportunity: number
    valuation: number
    financialHealth: number
    execution: number
  }
  buyZones: BuyZone[]
  accumulationPlan: AccumulationPlan
  catalysts: Catalyst[]
  risks: Risk[]
  newsJournal: NewsEntry[]
  timeline: TimelineEvent[]
  quarterlyReviews: QuarterlyReview[]
  checklist: InvestmentChecklist
  portfolio: PortfolioSnapshot
  tradingSignals: {
    dayTrade: 'Bullish' | 'Neutral' | 'Bearish'
    swingTrade: 'Bullish' | 'Neutral' | 'Bearish'
  }
  convictionHistory: ConvictionHistory[]
  lastUpdated: string
}

const STORAGE_KEY = 'oa_investment_theses_v1'

const todayIso = () => new Date().toISOString().slice(0, 10)
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '$--'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 })
}

function convictionScore(t: InvestmentThesis) {
  const q = t.quality
  const avg = (
    q.businessQuality +
    q.management +
    q.moat +
    q.growth +
    q.aiOpportunity +
    q.valuation +
    q.financialHealth +
    q.execution
  ) / 8
  return Math.round(clamp(avg * 10))
}

function ratingText(rating: number) {
  return '★★★★★'.slice(0, clamp(Math.round(rating), 0, 5)) + '☆☆☆☆☆'.slice(0, 5 - clamp(Math.round(rating), 0, 5))
}

function statusClass(status: ThesisStatus) {
  switch (status) {
    case 'Holding': return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'Accumulating': return 'border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'Researching': return 'border-violet-400/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
    case 'Exited': return 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300'
    default: return 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
}

function makeThesis(ticker: string, name: string, theme: string, sector: string, price: number): InvestmentThesis {
  const id = uid()
  const now = todayIso()
  return {
    id,
    company: {
      name,
      ticker,
      logo: ticker.slice(0, 1),
      currentPrice: price,
      dailyChangePct: 0,
      sector,
      marketCap: 'Large Cap',
      nextEarnings: '',
    },
    status: 'Researching',
    theme,
    aiExposure: theme.toLowerCase().includes('ai'),
    dividend: false,
    rating: 4,
    buyZone: `${fmtUsd(price * 0.9)} - ${fmtUsd(price)}`,
    targetPrice: Math.round(price * 1.25),
    thesisMarkdown: `# ${name} investment thesis\n\nWhy this business can compound over multiple years:\n\n- Durable market position\n- Clear growth drivers\n- Management execution matters\n- Valuation discipline required\n\n## What would change my mind\n\n- Thesis evidence weakens\n- Growth slows without margin improvement\n- Competition compresses returns`,
    originalThesis: {
      createdDate: now,
      createdBy: 'You',
      originalNews: '',
      initialTargetPrice: Math.round(price * 1.25),
      initialConviction: 75,
      originalNotes: 'Initial long-term research page created in Investment Thesis.',
    },
    aiSummary: `${name} is being tracked as a long-term idea in ${theme}. Conviction depends on business quality, execution, valuation, and evidence from quarterly updates.`,
    quality: {
      businessQuality: 8,
      management: 7,
      moat: 8,
      growth: 8,
      aiOpportunity: theme.toLowerCase().includes('ai') ? 9 : 6,
      valuation: 6,
      financialHealth: 8,
      execution: 7,
    },
    buyZones: [
      { id: uid(), label: 'Excellent', price: `Below ${fmtUsd(price * 0.85)}`, reason: 'High margin of safety versus current estimate.', allocation: 'Add 30%' },
      { id: uid(), label: 'Very Good', price: `${fmtUsd(price * 0.85)} - ${fmtUsd(price * 0.95)}`, reason: 'Attractive starter or add zone.', allocation: 'Add 20%' },
      { id: uid(), label: 'Fair', price: `${fmtUsd(price * 0.95)} - ${fmtUsd(price * 1.1)}`, reason: 'Only add if thesis evidence improves.', allocation: 'Small add' },
      { id: uid(), label: 'Expensive', price: `Above ${fmtUsd(price * 1.15)}`, reason: 'Wait unless growth assumptions improve.', allocation: 'No add' },
    ],
    accumulationPlan: {
      maxAllocationPct: 8,
      maxInvestment: 20000,
      targetAllocationPct: 5,
      steps: [`Buy starter below ${fmtUsd(price * 0.95)}`, `Add below ${fmtUsd(price * 0.85)}`, 'Review every quarter before increasing allocation'],
    },
    catalysts: [
      { id: uid(), date: now, title: 'Quarterly review', description: 'Review earnings, guidance, margins, and thesis evidence.', impact: 'Neutral', status: 'Upcoming' },
    ],
    risks: [
      { id: uid(), title: 'Valuation risk', severity: 'Medium', probability: 'Medium', notes: 'Future returns depend on entry price discipline.' },
      { id: uid(), title: 'Execution risk', severity: 'Medium', probability: 'Medium', notes: 'Track whether management delivers against stated roadmap.' },
    ],
    newsJournal: [],
    timeline: [{ id: uid(), date: now, title: 'Started Thesis', description: `Created long-term research page for ${ticker}.` }],
    quarterlyReviews: [],
    checklist: {
      annualReport: false,
      latestTenQ: false,
      earningsCall: false,
      competitors: false,
      tam: false,
      risks: true,
      valuation: false,
      quarterlyReview: false,
      yearlyReview: false,
    },
    portfolio: {
      ownedShares: 0,
      averageCost: 0,
      targetAllocationPct: 5,
      currentAllocationPct: 0,
      dividendYieldPct: 0,
    },
    tradingSignals: { dayTrade: 'Neutral', swingTrade: 'Neutral' },
    convictionHistory: [
      { date: now, score: 72 },
      { date: now, score: 75 },
    ],
    lastUpdated: now,
  }
}

function thesisFromStarter(starter: InvestmentThesisStarter): InvestmentThesis {
  const now = todayIso()
  const initialConviction = clamp(starter.conviction_score, 0, 100)
  return {
    id: uid(),
    company: {
      name: starter.company_name,
      ticker: starter.ticker,
      logo: starter.ticker.slice(0, 1),
      currentPrice: starter.current_price,
      dailyChangePct: starter.daily_change_pct,
      sector: starter.sector || 'Unknown',
      marketCap: starter.market_cap || 'Unknown',
      nextEarnings: starter.next_earnings || '',
    },
    status: 'Researching',
    theme: starter.theme || 'Long-term compounder',
    aiExposure: starter.ai_exposure,
    dividend: starter.dividend,
    rating: starter.rating,
    buyZone: starter.buy_zone,
    targetPrice: starter.target_price,
    thesisMarkdown: starter.thesis_markdown,
    originalThesis: {
      createdDate: now,
      createdBy: 'You',
      originalNews: 'Backend starter thesis generated from market/profile data.',
      initialTargetPrice: starter.target_price,
      initialConviction,
      originalNotes: starter.how_to_invest,
    },
    aiSummary: starter.summary,
    quality: starter.quality,
    buyZones: starter.buy_zones.map(z => ({ id: uid(), ...z })),
    accumulationPlan: {
      maxAllocationPct: 8,
      maxInvestment: 20000,
      targetAllocationPct: 5,
      steps: starter.accumulation_steps,
    },
    catalysts: starter.catalysts.map(c => ({ id: uid(), date: now, status: 'Upcoming', ...c })),
    risks: starter.risks.map(r => ({ id: uid(), ...r })),
    newsJournal: [],
    timeline: [{ id: uid(), date: now, title: 'Started Thesis', description: `Generated starter research page for ${starter.ticker}.` }],
    quarterlyReviews: [],
    checklist: {
      annualReport: false,
      latestTenQ: false,
      earningsCall: false,
      competitors: false,
      tam: false,
      risks: true,
      valuation: true,
      quarterlyReview: false,
      yearlyReview: false,
    },
    portfolio: {
      ownedShares: 0,
      averageCost: 0,
      targetAllocationPct: 5,
      currentAllocationPct: 0,
      dividendYieldPct: starter.dividend_yield_pct,
    },
    tradingSignals: starter.trading_signals,
    convictionHistory: [
      { date: now, score: initialConviction },
    ],
    lastUpdated: now,
  }
}

function seedTheses(): InvestmentThesis[] {
  const arm = makeThesis('ARM', 'Arm Holdings', 'AI Infrastructure', 'Semiconductors', 145)
  arm.status = 'Holding'
  arm.company.marketCap = 'Mega Cap'
  arm.company.nextEarnings = 'TBD'
  arm.portfolio.ownedShares = 10
  arm.portfolio.averageCost = 122
  arm.portfolio.currentAllocationPct = 3.2
  arm.thesisMarkdown = '# ARM investment thesis\n\nARM is evolving from CPU IP licensing into a broader AI infrastructure company.\n\nPotential upside comes from:\n\n- AI CPUs\n- AI software ecosystem\n- Data center licensing\n- Hyperscaler adoption\n- Higher royalty rates\n\n## What to monitor\n\n- Royalty growth\n- Data center traction\n- Customer concentration\n- Valuation discipline'
  arm.aiSummary = 'ARM remains a high-quality AI infrastructure thesis, but valuation discipline is critical. The strongest evidence would be sustained royalty growth and deeper data center adoption.'
  arm.quality.aiOpportunity = 10
  arm.quality.moat = 9
  arm.quality.valuation = 5
  arm.rating = 4

  const nvda = makeThesis('NVDA', 'NVIDIA', 'AI Semiconductors', 'Semiconductors', 128)
  nvda.status = 'Accumulating'
  nvda.company.marketCap = 'Mega Cap'
  nvda.portfolio.ownedShares = 25
  nvda.portfolio.averageCost = 96
  nvda.portfolio.currentAllocationPct = 6.5
  nvda.quality.businessQuality = 10
  nvda.quality.moat = 9
  nvda.quality.growth = 9
  nvda.quality.valuation = 5
  nvda.rating = 5

  const msft = makeThesis('MSFT', 'Microsoft', 'Cloud AI', 'Software', 470)
  msft.status = 'Watching'
  msft.dividend = true
  msft.company.marketCap = 'Mega Cap'
  msft.quality.financialHealth = 10
  msft.quality.management = 9
  msft.quality.valuation = 6
  msft.rating = 4

  return [arm, nvda, msft]
}

function loadTheses(): InvestmentThesis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedTheses()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as InvestmentThesis[]
  } catch {
    // Ignore corrupt local cache and reseed.
  }
  return seedTheses()
}

function MarkdownPreview({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-2 text-sm leading-relaxed text-secondary">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h2 key={i} className="pt-1 text-xl font-bold text-heading">{line.slice(2)}</h2>
        if (line.startsWith('## ')) return <h3 key={i} className="pt-2 text-base font-semibold text-heading">{line.slice(3)}</h3>
        if (line.startsWith('- ')) return <div key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /><span>{line.slice(2)}</span></div>
        if (line.startsWith('- [ ] ')) return <div key={i} className="flex gap-2"><span className="mt-0.5 h-4 w-4 rounded border border-slate-300 dark:border-slate-600" /><span>{line.slice(6)}</span></div>
        if (line.startsWith('- [x] ')) return <div key={i} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 text-emerald-500" /><span>{line.slice(6)}</span></div>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i}>{line}</p>
      })}
    </div>
  )
}

function ScoreBar({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-secondary">{label}</span>
        <span className="font-mono font-bold text-heading">{value}/10</span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-violet-600"
      />
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-violet-500" style={{ width: `${value * 10}%` }} />
      </div>
    </label>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
      {children}
    </label>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900'
const textareaCls = `${inputCls} min-h-[120px] resize-y`

export default function InvestmentThesisPage() {
  const [params, setParams] = useSearchParams()
  const [theses, setTheses] = useState<InvestmentThesis[]>(() => loadTheses())
  const [query, setQuery] = useState('')
  const [themeFilter, setThemeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ownedFilter, setOwnedFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'updated' | 'conviction' | 'ticker' | 'allocation'>('updated')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [starterTicker, setStarterTicker] = useState('')
  const [starterLoading, setStarterLoading] = useState(false)
  const [starterError, setStarterError] = useState<string | null>(null)
  const selectedId = params.get('id')
  const selected = theses.find(t => t.id === selectedId) ?? null

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theses))
    setSavedAt(new Date())
  }, [theses])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        localStorage.setItem(STORAGE_KEY, JSON.stringify(theses))
        setSavedAt(new Date())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theses])

  const themes = useMemo(() => Array.from(new Set(theses.map(t => t.theme))).sort(), [theses])
  const sectors = useMemo(() => Array.from(new Set(theses.map(t => t.company.sector))).sort(), [theses])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return theses
      .filter(t => !q || [t.company.ticker, t.company.name, t.theme, t.company.sector, t.aiSummary].some(v => v.toLowerCase().includes(q)))
      .filter(t => themeFilter === 'all' || t.theme === themeFilter)
      .filter(t => statusFilter === 'all' || t.status === statusFilter)
      .filter(t => ownedFilter === 'all' || (ownedFilter === 'owned' ? t.portfolio.ownedShares > 0 : t.portfolio.ownedShares <= 0))
      .sort((a, b) => {
        if (sortKey === 'conviction') return convictionScore(b) - convictionScore(a)
        if (sortKey === 'ticker') return a.company.ticker.localeCompare(b.company.ticker)
        if (sortKey === 'allocation') return b.portfolio.currentAllocationPct - a.portfolio.currentAllocationPct
        return b.lastUpdated.localeCompare(a.lastUpdated)
      })
  }, [ownedFilter, query, sortKey, statusFilter, theses, themeFilter])

  const updateThesis = (id: string, updater: (t: InvestmentThesis) => InvestmentThesis) => {
    setTheses(prev => prev.map(t => t.id === id ? { ...updater(t), lastUpdated: todayIso() } : t))
  }

  const createBlankThesis = () => {
    const t = makeThesis('NEW', 'New Company', 'Research Theme', 'Sector', 100)
    setTheses(prev => [t, ...prev])
    setParams({ id: t.id })
  }

  const createThesisFromTicker = async () => {
    const sym = starterTicker.trim().toUpperCase()
    if (!sym) {
      setStarterError('Enter a ticker first.')
      return
    }
    setStarterLoading(true)
    setStarterError(null)
    try {
      const starter = await generateInvestmentThesisStarter(sym)
      const t = thesisFromStarter(starter)
      setTheses(prev => [t, ...prev.filter(existing => existing.company.ticker.toUpperCase() !== t.company.ticker.toUpperCase())])
      setStarterTicker('')
      setParams({ id: t.id })
    } catch (e) {
      setStarterError((e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail || (e as Error).message || 'Unable to build thesis.')
    } finally {
      setStarterLoading(false)
    }
  }

  const deleteThesis = (id: string) => {
    setTheses(prev => prev.filter(t => t.id !== id))
    setParams({})
  }

  if (selected) {
    return (
      <InvestmentThesisDetail
        thesis={selected}
        onBack={() => setParams({})}
        onDelete={() => deleteThesis(selected.id)}
        onUpdate={updater => updateThesis(selected.id, updater)}
        savedAt={savedAt}
      />
    )
  }

  const totalOwned = theses.filter(t => t.portfolio.ownedShares > 0).length
  const avgConviction = theses.length ? Math.round(theses.reduce((s, t) => s + convictionScore(t), 0) / theses.length) : 0
  const inBuyZone = theses.filter(t => t.buyZone && t.company.currentPrice <= t.targetPrice).length
  const highConviction = theses.filter(t => convictionScore(t) >= 80).length
  const researchQueue = theses
    .map(t => ({ thesis: t, decision: thesisDecision(t), health: researchHealth(t) }))
    .sort((a, b) => b.health.priority - a.health.priority)
    .slice(0, 6)

  return (
    <div className="min-h-screen bg-surface-page px-4 py-5 text-primary sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <Star size={14} /> Long-term investing
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-3xl">Investment Thesis</h1>
          <p className="mt-1 max-w-3xl text-sm text-tertiary">
            A permanent research journal for long-term ideas, buy zones, catalysts, risks, quarterly reviews, and thesis drift.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={starterTicker}
              onChange={e => setStarterTicker(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') void createThesisFromTicker() }}
              placeholder="Enter ticker, e.g. NVDA"
              aria-label="Ticker for new investment thesis"
              className={`${inputCls} h-10 min-w-[220px]`}
            />
            <button type="button" onClick={() => void createThesisFromTicker()} disabled={starterLoading} className={`${getActionButtonClass('trade')} h-10 rounded-lg px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60`}>
              {starterLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Build Thesis
            </button>
            <button type="button" onClick={createBlankThesis} className={`${getActionButtonClass('surface')} h-10 rounded-lg px-4 text-sm`}>
              Blank
            </button>
          </div>
          {starterError && <div className="text-xs font-medium text-rose-600 dark:text-rose-300">{starterError}</div>}
        </div>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={<BookOpen size={18} />} label="Theses" value={String(theses.length)} sub={`${totalOwned} owned positions`} />
        <SummaryCard icon={<BrainCircuit size={18} />} label="Avg Conviction" value={`${avgConviction}/100`} sub="Business quality driven" />
        <SummaryCard icon={<Target size={18} />} label="In Buy Zone" value={String(inBuyZone)} sub="Review before adding" />
        <SummaryCard icon={<Star size={18} />} label="High Conviction" value={String(highConviction)} sub="80+ conviction scores" />
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
          <SectionTitle icon={<BrainCircuit size={18} />} title="Research Command Center" sub="Shows what needs attention before capital is added." />
          <div className="grid gap-3 md:grid-cols-3">
            <ResearchStat
              label="Review due"
              value={String(theses.filter(t => researchHealth(t).reviewDue).length)}
              sub="No recent quarterly review"
              tone="amber"
            />
            <ResearchStat
              label="Risk elevated"
              value={String(theses.filter(t => researchHealth(t).highRiskCount > 0).length)}
              sub="High severity risks logged"
              tone="rose"
            />
            <ResearchStat
              label="Actionable"
              value={String(theses.filter(t => ['ACCUMULATE', 'ADD ON WEAKNESS', 'WATCH BUY ZONE'].includes(thesisDecision(t).action)).length)}
              sub="Decision card favors attention"
              tone="emerald"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
          <SectionTitle icon={<AlertTriangle size={18} />} title="Research Queue" sub="Highest priority follow-ups." />
          <div className="space-y-2">
            {researchQueue.map(({ thesis: t, decision, health }) => (
              <button key={t.id} type="button" onClick={() => setParams({ id: t.id })} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-violet-400/50 dark:border-white/[0.07] dark:bg-slate-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-heading">{t.company.ticker}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${decision.toneClass}`}>{decision.action}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">{health.reason}</div>
                  </div>
                  <ChevronRight size={15} className="shrink-0 text-muted" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-900">
        <div className="grid gap-2 lg:grid-cols-[1fr_180px_160px_160px_160px]">
          <label className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, ticker, theme, sector, notes..." className={`${inputCls} pl-9`} />
          </label>
          <select value={themeFilter} onChange={e => setThemeFilter(e.target.value)} className={inputCls}>
            <option value="all">All themes</option>
            {themes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls}>
            <option value="all">All status</option>
            {(['Watching', 'Researching', 'Accumulating', 'Holding', 'Exited'] as ThesisStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={ownedFilter} onChange={e => setOwnedFilter(e.target.value)} className={inputCls}>
            <option value="all">Owned + not owned</option>
            <option value="owned">Owned</option>
            <option value="not-owned">Not owned</option>
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as typeof sortKey)} className={inputCls}>
            <option value="updated">Last updated</option>
            <option value="conviction">Conviction</option>
            <option value="ticker">Ticker</option>
            <option value="allocation">Allocation</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 dark:border-white/[0.08]"><Filter size={11} /> More filters:</span>
          {sectors.map(s => <span key={s} className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{s}</span>)}
          <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">AI Exposure</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">Dividend</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">Buy Zone</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">Market Cap</span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {filtered.map(t => (
          <button key={t.id} type="button" onClick={() => setParams({ id: t.id })} className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-400/50 hover:shadow-md dark:border-white/[0.07] dark:bg-slate-900">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-lg font-black text-white">{t.company.logo}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-bold text-heading">{t.company.name}</h2>
                  <ChevronRight size={15} className="text-muted transition group-hover:translate-x-0.5" />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono font-bold text-secondary">{t.company.ticker}</span>
                  <span>{t.company.sector}</span>
                  <span>{t.company.marketCap}</span>
                </div>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(t.status)}`}>{t.status}</span>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
              <MiniMetric label="Price" value={fmtUsd(t.company.currentPrice)} />
              <MiniMetric label="Conviction" value={`${convictionScore(t)}/100`} />
              <MiniMetric label="Rating" value={ratingText(t.rating)} />
            </div>
            <div className="space-y-2 text-xs">
              <LineItem label="Theme" value={t.theme} />
              <LineItem label="Buy Zone" value={t.buyZone || '--'} />
              <LineItem label="Target" value={fmtUsd(t.targetPrice)} />
              <LineItem label="Allocation" value={`${t.portfolio.currentAllocationPct.toFixed(1)}% / target ${t.portfolio.targetAllocationPct.toFixed(1)}%`} />
              <LineItem label="Owned Shares" value={String(t.portfolio.ownedShares)} />
              <LineItem label="Last Updated" value={t.lastUpdated} />
            </div>
          </button>
        ))}
      </section>
    </div>
  )
}

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between text-muted">{icon}<span className="text-[10px] font-bold uppercase tracking-widest">{label}</span></div>
      <div className="text-2xl font-bold text-heading">{value}</div>
      <div className="mt-1 text-xs text-tertiary">{sub}</div>
    </div>
  )
}

function ResearchStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'emerald' | 'amber' | 'rose' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : tone === 'rose'
      ? 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs opacity-80">{sub}</div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 truncate font-mono font-bold text-heading">{value}</div>
    </div>
  )
}

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right font-medium text-secondary">{value}</span>
    </div>
  )
}

function InvestmentThesisDetail({
  thesis,
  onBack,
  onDelete,
  onUpdate,
  savedAt,
}: {
  thesis: InvestmentThesis
  onBack: () => void
  onDelete: () => void
  onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void
  savedAt: Date | null
}) {
  const score = convictionScore(thesis)
  const currentValue = thesis.portfolio.ownedShares * thesis.company.currentPrice
  const totalCost = thesis.portfolio.ownedShares * thesis.portfolio.averageCost
  const gain = currentValue - totalCost
  const gainPct = totalCost > 0 ? (gain / totalCost) * 100 : 0
  const decision = thesisDecision(thesis)
  const health = researchHealth(thesis)
  const checklistPct = checklistCompletion(thesis.checklist)
  const drift = score - thesis.originalThesis.initialConviction
  const targetUpside = thesis.company.currentPrice > 0 ? ((thesis.targetPrice - thesis.company.currentPrice) / thesis.company.currentPrice) * 100 : 0
  const qualityData = [
    { metric: 'Business', value: thesis.quality.businessQuality },
    { metric: 'Mgmt', value: thesis.quality.management },
    { metric: 'Moat', value: thesis.quality.moat },
    { metric: 'Growth', value: thesis.quality.growth },
    { metric: 'AI', value: thesis.quality.aiOpportunity },
    { metric: 'Value', value: thesis.quality.valuation },
    { metric: 'Health', value: thesis.quality.financialHealth },
    { metric: 'Exec', value: thesis.quality.execution },
  ]
  const sectionNav = [
    ['thesis', 'Thesis'],
    ['original', 'Original'],
    ['summary', 'Summary'],
    ['quality', 'Quality'],
    ['buy-zones', 'Buy Zones'],
    ['plan', 'Accumulation'],
    ['catalysts', 'Catalysts'],
    ['risks', 'Risks'],
    ['news', 'News'],
    ['timeline', 'Timeline'],
    ['reviews', 'Reviews'],
    ['checklist', 'Checklist'],
    ['portfolio', 'Portfolio'],
    ['signals', 'Trading Signals'],
  ]

  const patch = (partial: Partial<InvestmentThesis>) => onUpdate(t => ({ ...t, ...partial }))
  const patchCompany = (partial: Partial<Company>) => onUpdate(t => ({ ...t, company: { ...t.company, ...partial } }))
  const patchQuality = (key: keyof InvestmentThesis['quality'], value: number) => onUpdate(t => ({
    ...t,
    quality: { ...t.quality, [key]: value },
    convictionHistory: [...t.convictionHistory, { date: todayIso(), score: convictionScore({ ...t, quality: { ...t.quality, [key]: value } }) }],
  }))

  return (
    <div className="min-h-screen bg-surface-page px-4 py-5 text-primary sm:px-6 lg:px-8">
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200 bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-white/[0.07]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack} className={`${getActionButtonClass('surface')} h-9 w-9 rounded-lg`} title="Back to dashboard">
              <ArrowLeft size={16} />
            </button>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-xl font-black text-white">{thesis.company.logo}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold text-heading">{thesis.company.name}</h1>
                <span className="font-mono text-sm font-bold text-secondary">{thesis.company.ticker}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(thesis.status)}`}>{thesis.status}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>{thesis.theme}</span>
                <span>{thesis.company.sector}</span>
                <span>{thesis.company.marketCap}</span>
                <span>Autosaved {savedAt ? savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => patch({ aiSummary: generateSummary(thesis) })} className={`${getActionButtonClass('surface')} rounded-lg px-3 py-2 text-xs`}>
              <Sparkles size={14} /> Summarize Thesis
            </button>
            <button type="button" onClick={() => patch({ aiSummary: detectDrift(thesis) })} className={`${getActionButtonClass('surface')} rounded-lg px-3 py-2 text-xs`}>
              <BrainCircuit size={14} /> Detect Thesis Drift
            </button>
            <button type="button" onClick={() => onUpdate(t => ({ ...t, lastUpdated: todayIso() }))} className={`${getActionButtonClass('trade')} rounded-lg px-3 py-2 text-xs`}>
              <Save size={14} /> Save
            </button>
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/10">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <nav className="sticky top-24 space-y-1 rounded-xl border border-slate-200 bg-white p-2 dark:border-white/[0.07] dark:bg-slate-900">
            {sectionNav.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-800">{label}</a>
            ))}
          </nav>
        </aside>

        <main className="space-y-5">
          <section className="grid gap-3 lg:grid-cols-4">
            <HeroMetric icon={<CircleDollarSign size={18} />} label="Current Price" value={fmtUsd(thesis.company.currentPrice)} sub={`${thesis.company.dailyChangePct >= 0 ? '+' : ''}${thesis.company.dailyChangePct.toFixed(2)}% today`} />
            <HeroMetric icon={<BrainCircuit size={18} />} label="Conviction" value={`${score}/100`} sub={ratingText(thesis.rating)} />
            <HeroMetric icon={<Target size={18} />} label="Target Price" value={fmtUsd(thesis.targetPrice)} sub={`Buy zone ${thesis.buyZone || '--'}`} />
            <HeroMetric icon={<Layers size={18} />} label="Portfolio" value={`${thesis.portfolio.currentAllocationPct.toFixed(1)}%`} sub={`${thesis.portfolio.ownedShares} shares owned`} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/[0.07] dark:bg-slate-900">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Investment Decision</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${decision.toneClass}`}>{decision.action}</span>
                    <span className="font-mono text-sm font-bold text-secondary">{score}/100 conviction</span>
                    <span className="text-sm text-muted">{targetUpside >= 0 ? '+' : ''}{targetUpside.toFixed(1)}% to target</span>
                  </div>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-secondary">{decision.reason}</p>
                </div>
                <div className="grid min-w-[260px] grid-cols-2 gap-2 text-xs">
                  <ReadOnly label="Next Earnings" value={thesis.company.nextEarnings || '--'} />
                  <ReadOnly label="Buy Zone" value={thesis.buyZone || '--'} />
                  <ReadOnly label="Current Alloc." value={`${thesis.portfolio.currentAllocationPct.toFixed(1)}%`} />
                  <ReadOnly label="Target Alloc." value={`${thesis.portfolio.targetAllocationPct.toFixed(1)}%`} />
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <DecisionCheck label="Research complete" value={`${checklistPct}%`} good={checklistPct >= 70} sub="Checklist completion" />
                <DecisionCheck label="Thesis drift" value={`${drift >= 0 ? '+' : ''}${drift}`} good={drift >= -10} sub="Current vs original conviction" />
                <DecisionCheck label="Risk register" value={`${health.highRiskCount} high`} good={health.highRiskCount === 0} sub={health.highRiskCount ? 'Review before adding' : 'No high risks logged'} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/[0.07] dark:bg-slate-900">
              <SectionTitle icon={<CheckCircle2 size={18} />} title="Next Best Action" sub="Keeps research and allocation separate from trading signals." />
              <div className="space-y-3">
                <ActionRow done={!health.reviewDue} label={health.reviewDue ? 'Create quarterly review' : 'Quarterly review current'} />
                <ActionRow done={health.highRiskCount === 0} label={health.highRiskCount ? 'Reassess high-severity risks' : 'Risk register clean'} />
                <ActionRow done={checklistPct >= 70} label={checklistPct >= 70 ? 'Checklist mostly complete' : 'Complete core research checklist'} />
                <ActionRow done={thesis.portfolio.currentAllocationPct <= thesis.accumulationPlan.maxAllocationPct} label="Allocation inside max plan" />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Status">
                <select value={thesis.status} onChange={e => patch({ status: e.target.value as ThesisStatus })} className={inputCls}>
                  {(['Watching', 'Researching', 'Accumulating', 'Holding', 'Exited'] as ThesisStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Theme"><input value={thesis.theme} onChange={e => patch({ theme: e.target.value })} className={inputCls} /></Field>
              <Field label="Current Price"><input type="number" value={thesis.company.currentPrice} onChange={e => patchCompany({ currentPrice: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Target Price"><input type="number" value={thesis.targetPrice} onChange={e => patch({ targetPrice: Number(e.target.value) })} className={inputCls} /></Field>
            </div>
          </section>

          <section id="thesis" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
            <SectionTitle icon={<FileText size={18} />} title="Investment Thesis" sub="Markdown editor with autosave. Use this as the living research note." />
            <div className="grid gap-4 lg:grid-cols-2">
              <textarea value={thesis.thesisMarkdown} onChange={e => patch({ thesisMarkdown: e.target.value })} className={`${textareaCls} min-h-[420px] font-mono text-sm`} />
              <div className="min-h-[420px] rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.07] dark:bg-slate-950/40">
                <MarkdownPreview text={thesis.thesisMarkdown} />
              </div>
            </div>
          </section>

          <section id="original" className="grid gap-4 lg:grid-cols-2">
            <Panel title="Original Thesis" icon={<Clock3 size={18} />} sub="Historical snapshot. Do not overwrite the original rationale.">
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnly label="Created Date" value={thesis.originalThesis.createdDate} />
                <ReadOnly label="Created By" value={thesis.originalThesis.createdBy} />
                <ReadOnly label="Initial Target" value={fmtUsd(thesis.originalThesis.initialTargetPrice)} />
                <ReadOnly label="Initial Conviction" value={`${thesis.originalThesis.initialConviction}/100`} />
              </div>
              <ReadOnly label="Original News" value={thesis.originalThesis.originalNews || '--'} />
              <ReadOnly label="Original Notes" value={thesis.originalThesis.originalNotes} />
            </Panel>
            <Panel id="summary" title="Investment Summary" icon={<BrainCircuit size={18} />} sub="AI-style summary generated from the current thesis fields.">
              <textarea value={thesis.aiSummary} onChange={e => patch({ aiSummary: e.target.value })} className={textareaCls} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {['Update Thesis', 'Compare Original', 'Highlight Risks', 'Suggest Buy Zone', 'Bull Case', 'Bear Case'].map(action => (
                  <button key={action} type="button" onClick={() => patch({ aiSummary: `${action}: ${generateSummary(thesis)}` })} className={`${getActionButtonClass('surface')} rounded-lg px-3 py-2 text-xs`}>
                    <Sparkles size={13} /> {action}
                  </button>
                ))}
              </div>
            </Panel>
          </section>

          <section id="quality" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
            <SectionTitle icon={<BarChart3 size={18} />} title="Business Quality" sub="Conviction is calculated from business quality, moat, growth, AI opportunity, valuation, health, and execution." />
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(thesis.quality) as Array<keyof InvestmentThesis['quality']>).map(k => (
                  <ScoreBar key={k} label={qualityLabel(k)} value={thesis.quality[k]} onChange={v => patchQuality(k, v)} />
                ))}
              </div>
              <div className="grid gap-3">
                <div className="h-72 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={qualityData}>
                      <PolarGrid stroke="var(--border-default)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <Radar dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-40 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={thesis.convictionHistory}>
                      <XAxis dataKey="date" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="#22c55e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          <EditableListSection id="buy-zones" title="Buy Zones" icon={<Target size={18} />} items={thesis.buyZones} onAdd={() => onUpdate(t => ({ ...t, buyZones: [...t.buyZones, { id: uid(), label: 'New Zone', price: '', reason: '', allocation: '' }] }))}>
            <div className="mb-3 grid gap-3 md:grid-cols-3">
              <ReadOnly label="Current Price" value={fmtUsd(thesis.company.currentPrice)} />
              <ReadOnly label="Primary Buy Zone" value={thesis.buyZone || '--'} />
              <ReadOnly label="Target Upside" value={`${targetUpside >= 0 ? '+' : ''}${targetUpside.toFixed(1)}%`} valueClass={targetUpside >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'} />
            </div>
            {thesis.buyZones.map(zone => (
              <div key={zone.id} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03] md:grid-cols-[140px_180px_1fr_160px]">
                <input value={zone.label} onChange={e => patchBuyZone(thesis, onUpdate, zone.id, { label: e.target.value })} className={inputCls} />
                <input value={zone.price} onChange={e => patchBuyZone(thesis, onUpdate, zone.id, { price: e.target.value })} className={inputCls} />
                <input value={zone.reason} onChange={e => patchBuyZone(thesis, onUpdate, zone.id, { reason: e.target.value })} className={inputCls} />
                <input value={zone.allocation} onChange={e => patchBuyZone(thesis, onUpdate, zone.id, { allocation: e.target.value })} className={inputCls} />
              </div>
            ))}
          </EditableListSection>

          <Panel id="plan" title="Accumulation Plan" icon={<LineChartIcon size={18} />} sub="Rules for disciplined adds over months or years.">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Target Allocation %"><input type="number" value={thesis.accumulationPlan.targetAllocationPct} onChange={e => patch({ accumulationPlan: { ...thesis.accumulationPlan, targetAllocationPct: Number(e.target.value) } })} className={inputCls} /></Field>
              <Field label="Max Allocation %"><input type="number" value={thesis.accumulationPlan.maxAllocationPct} onChange={e => patch({ accumulationPlan: { ...thesis.accumulationPlan, maxAllocationPct: Number(e.target.value) } })} className={inputCls} /></Field>
              <Field label="Max Investment"><input type="number" value={thesis.accumulationPlan.maxInvestment} onChange={e => patch({ accumulationPlan: { ...thesis.accumulationPlan, maxInvestment: Number(e.target.value) } })} className={inputCls} /></Field>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (thesis.portfolio.currentAllocationPct / Math.max(thesis.accumulationPlan.targetAllocationPct, 1)) * 100)}%` }} />
            </div>
            <textarea value={thesis.accumulationPlan.steps.join('\n')} onChange={e => patch({ accumulationPlan: { ...thesis.accumulationPlan, steps: e.target.value.split('\n') } })} className={`${textareaCls} mt-3`} />
          </Panel>

          <EditableListSection id="catalysts" title="Catalysts" icon={<CalendarClock size={18} />} items={thesis.catalysts} onAdd={() => onUpdate(t => ({ ...t, catalysts: [...t.catalysts, { id: uid(), date: todayIso(), title: 'New catalyst', description: '', impact: 'Neutral', status: 'Upcoming' }] }))}>
            <div className="space-y-2">
              {thesis.catalysts.map(c => (
                <div key={c.id} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03] lg:grid-cols-[130px_1fr_130px_130px]">
                  <input type="date" value={c.date} onChange={e => patchCatalyst(thesis, onUpdate, c.id, { date: e.target.value })} className={inputCls} />
                  <input value={c.title} onChange={e => patchCatalyst(thesis, onUpdate, c.id, { title: e.target.value })} className={inputCls} />
                  <select value={c.impact} onChange={e => patchCatalyst(thesis, onUpdate, c.id, { impact: e.target.value as Impact })} className={inputCls}><option>Positive</option><option>Neutral</option><option>Negative</option></select>
                  <select value={c.status} onChange={e => patchCatalyst(thesis, onUpdate, c.id, { status: e.target.value as CatalystStatus })} className={inputCls}><option>Upcoming</option><option>Completed</option><option>Cancelled</option></select>
                </div>
              ))}
            </div>
          </EditableListSection>

          <EditableListSection id="risks" title="Risk Register" icon={<ShieldAlert size={18} />} items={thesis.risks} onAdd={() => onUpdate(t => ({ ...t, risks: [...t.risks, { id: uid(), title: 'New risk', severity: 'Medium', probability: 'Medium', notes: '' }] }))}>
            <div className="grid gap-3 md:grid-cols-2">
              {thesis.risks.map(r => (
                <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
                  <input value={r.title} onChange={e => patchRisk(thesis, onUpdate, r.id, { title: e.target.value })} className={inputCls} />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select value={r.severity} onChange={e => patchRisk(thesis, onUpdate, r.id, { severity: e.target.value as RiskLevel })} className={inputCls}><option>Low</option><option>Medium</option><option>High</option></select>
                    <select value={r.probability} onChange={e => patchRisk(thesis, onUpdate, r.id, { probability: e.target.value as RiskLevel })} className={inputCls}><option>Low</option><option>Medium</option><option>High</option></select>
                  </div>
                  <textarea value={r.notes} onChange={e => patchRisk(thesis, onUpdate, r.id, { notes: e.target.value })} className={`${textareaCls} mt-2 min-h-[80px]`} />
                </div>
              ))}
            </div>
          </EditableListSection>

          <EditableListSection id="news" title="News Journal" icon={<Globe2 size={18} />} items={thesis.newsJournal} onAdd={() => onUpdate(t => ({ ...t, newsJournal: [{ id: uid(), date: todayIso(), headline: 'New article insight', source: '', url: '', aiSummary: '', notes: '', impact: 'Neutral', confidence: 'Medium' }, ...t.newsJournal] }))}>
            <div className="space-y-3">
              {thesis.newsJournal.length === 0 && <EmptyState text="No news insights yet. Add articles as investment insights, not article archives." />}
              {thesis.newsJournal.map(n => (
                <div key={n.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
                  <div className="grid gap-2 lg:grid-cols-[130px_1fr_160px_130px_130px]">
                    <input type="date" value={n.date} onChange={e => patchNews(thesis, onUpdate, n.id, { date: e.target.value })} className={inputCls} />
                    <input value={n.headline} onChange={e => patchNews(thesis, onUpdate, n.id, { headline: e.target.value })} className={inputCls} />
                    <input value={n.source} onChange={e => patchNews(thesis, onUpdate, n.id, { source: e.target.value })} className={inputCls} />
                    <select value={n.impact} onChange={e => patchNews(thesis, onUpdate, n.id, { impact: e.target.value as Impact })} className={inputCls}><option>Positive</option><option>Neutral</option><option>Negative</option></select>
                    <select value={n.confidence} onChange={e => patchNews(thesis, onUpdate, n.id, { confidence: e.target.value as Confidence })} className={inputCls}><option>High</option><option>Medium</option><option>Low</option></select>
                  </div>
                  <input value={n.url} onChange={e => patchNews(thesis, onUpdate, n.id, { url: e.target.value })} placeholder="URL" className={`${inputCls} mt-2`} />
                  <textarea value={n.aiSummary} onChange={e => patchNews(thesis, onUpdate, n.id, { aiSummary: e.target.value })} placeholder="AI summary" className={`${textareaCls} mt-2 min-h-[80px]`} />
                  <textarea value={n.notes} onChange={e => patchNews(thesis, onUpdate, n.id, { notes: e.target.value })} placeholder="My notes" className={`${textareaCls} mt-2 min-h-[80px]`} />
                </div>
              ))}
            </div>
          </EditableListSection>

          <Panel id="timeline" title="Timeline" icon={<Clock3 size={18} />} sub="Chronological history of thesis changes, purchases, reviews, and catalysts.">
            <div className="space-y-3">
              {thesis.timeline.map((event, i) => (
                <div key={event.id} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="h-3 w-3 rounded-full bg-violet-500" />
                    {i < thesis.timeline.length - 1 && <span className="h-full min-h-10 w-px bg-slate-200 dark:bg-slate-700" />}
                  </div>
                  <div className="pb-3">
                    <div className="text-xs font-mono text-muted">{event.date}</div>
                    <div className="font-semibold text-heading">{event.title}</div>
                    <div className="text-sm text-secondary">{event.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <EditableListSection id="reviews" title="Quarterly Reviews" icon={<CheckCircle2 size={18} />} items={thesis.quarterlyReviews} onAdd={() => onUpdate(t => ({ ...t, quarterlyReviews: [{ id: uid(), quarter: 'New Review', revenueGrowth: false, marginsImprove: false, aiProgress: false, managementExecution: false, thesisStronger: false, valuationAttractive: false, convictionChange: 'Hold', notes: '' }, ...t.quarterlyReviews] }))}>
            <div className="space-y-3">
              {thesis.quarterlyReviews.length === 0 && <EmptyState text="No quarterly reviews yet. Create one after earnings." />}
              {thesis.quarterlyReviews.map(r => (
                <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
                  <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
                    <input value={r.quarter} onChange={e => patchReview(thesis, onUpdate, r.id, { quarter: e.target.value })} className={inputCls} />
                    <select value={r.convictionChange} onChange={e => patchReview(thesis, onUpdate, r.id, { convictionChange: e.target.value as QuarterlyReview['convictionChange'] })} className={inputCls}><option>Increase</option><option>Decrease</option><option>Hold</option></select>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(['revenueGrowth', 'marginsImprove', 'aiProgress', 'managementExecution', 'thesisStronger', 'valuationAttractive'] as const).map(key => (
                      <label key={key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-secondary dark:bg-slate-900/60">
                        <input type="checkbox" checked={r[key]} onChange={e => patchReview(thesis, onUpdate, r.id, { [key]: e.target.checked } as Partial<QuarterlyReview>)} className="accent-violet-600" />
                        {qualityLabel(key)}
                      </label>
                    ))}
                  </div>
                  <textarea value={r.notes} onChange={e => patchReview(thesis, onUpdate, r.id, { notes: e.target.value })} className={`${textareaCls} mt-3 min-h-[80px]`} />
                </div>
              ))}
            </div>
          </EditableListSection>

          <Panel id="checklist" title="Investment Checklist" icon={<CheckCircle2 size={18} />} sub="Research discipline before adding size.">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(thesis.checklist) as Array<keyof InvestmentChecklist>).map(k => (
                <label key={k} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-secondary dark:border-white/[0.07] dark:bg-white/[0.03]">
                  <input type="checkbox" checked={thesis.checklist[k]} onChange={e => patch({ checklist: { ...thesis.checklist, [k]: e.target.checked } })} className="accent-violet-600" />
                  {qualityLabel(k)}
                </label>
              ))}
            </div>
          </Panel>

          <section id="portfolio" className="grid gap-4 lg:grid-cols-2">
            <Panel title="Portfolio Snapshot" icon={<Building2 size={18} />} sub="Only shown as investing context. This is not a trade signal.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Owned Shares"><input type="number" value={thesis.portfolio.ownedShares} onChange={e => patch({ portfolio: { ...thesis.portfolio, ownedShares: Number(e.target.value) } })} className={inputCls} /></Field>
                <Field label="Average Cost"><input type="number" value={thesis.portfolio.averageCost} onChange={e => patch({ portfolio: { ...thesis.portfolio, averageCost: Number(e.target.value) } })} className={inputCls} /></Field>
                <ReadOnly label="Total Cost" value={fmtUsd(totalCost)} />
                <ReadOnly label="Current Value" value={fmtUsd(currentValue)} />
                <ReadOnly label="Gain / Loss" value={`${gain >= 0 ? '+' : ''}${fmtUsd(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)`} valueClass={getProfitLossTextClass(gain)} />
                <Field label="Dividend Yield %"><input type="number" value={thesis.portfolio.dividendYieldPct} onChange={e => patch({ portfolio: { ...thesis.portfolio, dividendYieldPct: Number(e.target.value) } })} className={inputCls} /></Field>
              </div>
            </Panel>
            <Panel id="signals" title="Trading Signals" icon={<AlertTriangle size={18} />} sub="Read-only context. Trading signals never modify investment conviction.">
              <div className="grid gap-3 sm:grid-cols-2">
                <SignalBox label="Day Trade" value={thesis.tradingSignals.dayTrade} />
                <SignalBox label="Swing Trade" value={thesis.tradingSignals.swingTrade} />
              </div>
              <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Investment and trading are independent. Do not raise or lower long-term conviction because of short-term price action alone.
              </div>
            </Panel>
          </section>
        </main>
      </div>
    </div>
  )
}

function HeroMetric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between text-muted">{icon}<span className="text-[10px] font-bold uppercase tracking-widest">{label}</span></div>
      <div className="text-xl font-bold text-heading">{value}</div>
      <div className="mt-1 text-xs text-tertiary">{sub}</div>
    </div>
  )
}

function DecisionCheck({ label, value, good, sub }: { label: string; value: string; good: boolean; sub: string }) {
  return (
    <div className={`rounded-xl border p-3 ${good ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-amber-400/30 bg-amber-500/10'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</span>
        {good ? <CheckCircle2 size={15} className="text-emerald-500" /> : <AlertTriangle size={15} className="text-amber-500" />}
      </div>
      <div className="mt-2 font-mono text-lg font-black text-heading">{value}</div>
      <div className="mt-1 text-xs text-tertiary">{sub}</div>
    </div>
  )
}

function ActionRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.07] dark:bg-slate-950/40">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
        {done ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      </span>
      <span className="text-sm font-medium text-secondary">{label}</span>
    </div>
  )
}

function SectionTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-lg font-bold text-heading">{icon}{title}</div>
        <p className="mt-1 text-sm text-tertiary">{sub}</p>
      </div>
    </div>
  )
}

function Panel({ id, title, icon, sub, children }: { id?: string; title: string; icon: React.ReactNode; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
      <SectionTitle icon={icon} title={title} sub={sub} />
      {children}
    </section>
  )
}

function EditableListSection({ id, title, icon, items, onAdd, children }: { id: string; title: string; icon: React.ReactNode; items: unknown[]; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionTitle icon={icon} title={title} sub={`${items.length} saved item${items.length === 1 ? '' : 's'}.`} />
        <button type="button" onClick={onAdd} className={`${getActionButtonClass('surface')} rounded-lg px-3 py-2 text-xs`}><Plus size={14} /> Add</button>
      </div>
      {children}
    </section>
  )
}

function ReadOnly({ label, value, valueClass = 'text-secondary' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 font-semibold ${valueClass}`}>{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-muted dark:border-slate-700">{text}</div>
}

function SignalBox({ label, value }: { label: string; value: 'Bullish' | 'Neutral' | 'Bearish' }) {
  const cls = value === 'Bullish' ? getDecisionBadgeClass('GO') : value === 'Bearish' ? getDecisionBadgeClass('EXIT_NOW') : getDecisionBadgeClass('WAIT')
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
      <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${cls}`}>{value}</span>
    </div>
  )
}

function qualityLabel(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .replace('Ai ', 'AI ')
    .replace('Tam', 'TAM')
    .replace('Ten Q', '10-Q')
}

function checklistCompletion(checklist: InvestmentChecklist) {
  const values = Object.values(checklist)
  if (!values.length) return 0
  return Math.round((values.filter(Boolean).length / values.length) * 100)
}

function daysSince(date: string) {
  const then = new Date(date).getTime()
  if (!Number.isFinite(then)) return 999
  return Math.max(0, Math.floor((Date.now() - then) / 86400000))
}

function thesisDecision(t: InvestmentThesis) {
  const score = convictionScore(t)
  const alloc = t.portfolio.currentAllocationPct
  const targetAlloc = t.portfolio.targetAllocationPct
  const maxAlloc = t.accumulationPlan.maxAllocationPct
  const price = t.company.currentPrice
  const targetUpside = price > 0 ? ((t.targetPrice - price) / price) * 100 : 0
  const health = researchHealth(t)

  if (t.status === 'Exited') {
    return {
      action: 'ARCHIVED',
      toneClass: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
      reason: 'This thesis is exited. Keep it for history and only reopen after a fresh business-quality review.',
    }
  }
  if (score < 55) {
    return {
      action: 'REASSESS',
      toneClass: 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      reason: 'Conviction is below the minimum long-term threshold. Revisit the thesis, risks, and latest quarterly evidence before adding capital.',
    }
  }
  if (alloc >= maxAlloc) {
    return {
      action: 'HOLD SIZE',
      toneClass: 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      reason: 'The position is at or above the maximum allocation plan. Do not add unless the max allocation rule changes after review.',
    }
  }
  if (health.highRiskCount > 0 || health.reviewDue) {
    return {
      action: 'REVIEW FIRST',
      toneClass: 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      reason: health.reason,
    }
  }
  if (score >= 82 && targetUpside >= 15 && alloc < targetAlloc) {
    return {
      action: 'ACCUMULATE',
      toneClass: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      reason: 'Conviction is high, upside remains attractive, and allocation is still below the target plan.',
    }
  }
  if (score >= 70 && targetUpside >= 8) {
    return {
      action: 'ADD ON WEAKNESS',
      toneClass: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      reason: 'The thesis remains investable, but the better action is to add near predefined buy zones instead of chasing price.',
    }
  }
  return {
    action: 'MONITOR',
    toneClass: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
    reason: 'Keep the thesis active, monitor catalysts and quarterly evidence, and wait for a better valuation or stronger conviction.',
  }
}

function researchHealth(t: InvestmentThesis) {
  const highRiskCount = t.risks.filter(r => r.severity === 'High' || r.probability === 'High').length
  const lastReviewAge = t.quarterlyReviews.length ? daysSince(t.lastUpdated) : 999
  const reviewDue = t.quarterlyReviews.length === 0 || lastReviewAge > 90
  const checklistPct = checklistCompletion(t.checklist)
  const priority = (reviewDue ? 4 : 0) + highRiskCount * 3 + (checklistPct < 60 ? 2 : 0) + (convictionScore(t) >= 80 ? 1 : 0)
  const reason = reviewDue
    ? 'Quarterly review is missing or stale.'
    : highRiskCount > 0
      ? `${highRiskCount} high risk item${highRiskCount === 1 ? '' : 's'} need review.`
      : checklistPct < 60
        ? 'Core research checklist is incomplete.'
        : 'Research file is current.'
  return { highRiskCount, reviewDue, checklistPct, priority, reason }
}

function generateSummary(t: InvestmentThesis) {
  return `${t.company.name} (${t.company.ticker}) is a ${t.status.toLowerCase()} long-term thesis in ${t.theme}. Conviction is ${convictionScore(t)}/100, with strongest scores in business quality and moat. The current buy zone is ${t.buyZone || 'not defined'}, target price is ${fmtUsd(t.targetPrice)}, and key risks should be reviewed before adding allocation.`
}

function detectDrift(t: InvestmentThesis) {
  const score = convictionScore(t)
  const original = t.originalThesis.initialConviction
  const direction = score > original + 10 ? 'stronger' : score < original - 10 ? 'weaker' : 'broadly consistent'
  return `Thesis drift check: current conviction is ${score}/100 versus original ${original}/100, so the thesis is ${direction}. Compare recent notes, risks, and quarterly reviews before changing allocation.`
}

function patchBuyZone(thesis: InvestmentThesis, onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void, id: string, partial: Partial<BuyZone>) {
  onUpdate(t => ({ ...t, buyZones: thesis.buyZones.map(z => z.id === id ? { ...z, ...partial } : z) }))
}

function patchCatalyst(thesis: InvestmentThesis, onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void, id: string, partial: Partial<Catalyst>) {
  onUpdate(t => ({ ...t, catalysts: thesis.catalysts.map(c => c.id === id ? { ...c, ...partial } : c) }))
}

function patchRisk(thesis: InvestmentThesis, onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void, id: string, partial: Partial<Risk>) {
  onUpdate(t => ({ ...t, risks: thesis.risks.map(r => r.id === id ? { ...r, ...partial } : r) }))
}

function patchNews(thesis: InvestmentThesis, onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void, id: string, partial: Partial<NewsEntry>) {
  onUpdate(t => ({ ...t, newsJournal: thesis.newsJournal.map(n => n.id === id ? { ...n, ...partial } : n) }))
}

function patchReview(thesis: InvestmentThesis, onUpdate: (updater: (t: InvestmentThesis) => InvestmentThesis) => void, id: string, partial: Partial<QuarterlyReview>) {
  onUpdate(t => ({ ...t, quarterlyReviews: thesis.quarterlyReviews.map(r => r.id === id ? { ...r, ...partial } : r) }))
}
