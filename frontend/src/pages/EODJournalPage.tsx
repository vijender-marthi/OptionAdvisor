import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, CheckSquare, Square, RefreshCw, Download, Save, ChevronDown, ChevronUp, X, Loader2, AlertCircle } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import {
  fetchMyTickers, addMyTicker, searchTickers,
  fetchMarketPosition, fetchStockTargets,
  type MyTickerEntry, type SearchTickerResult,
} from '../api/commandCenter'
import { analyzeSwingTrade, type SwingTradeScanResult } from '../api/client'
import { fetchSignalFeed } from '../api/commandCenter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScenarioData {
  trigger: string
  entry: string
  stop: string
  t1: string
  t2: string
  rr: string
  probability: number
}

interface NeutralScenario {
  trigger: string
  entry: string
  probability: number
}

interface ComputedScenarios {
  bull: ScenarioData
  bear: ScenarioData
  neutral: NeutralScenario
}

interface StockAnalysis {
  ticker: string
  company: string
  sector: string
  close: number
  prevClose: number
  vwap: number | null
  ma20: number | null
  ma50: number | null
  rsi: number | null
  ivr: number | null
  structure: string
  weeklyTrend: string
  macd: string
  rs: string
  volRatio: number | null
  sectorEtf: string
  bias: 'bull' | 'bear' | 'neutral'
  bullScore: number
  bearScore: number
  confidence: number
  scenarios: ComputedScenarios
  fetchedAt: string
}

interface SectorEntry {
  name: string
  etf: string
  mom5d: number
  trend: 'up' | 'sideways' | 'down'
  rs: 'strong' | 'neutral' | 'weak' | 'index'
}

interface StockNotes {
  observations: string
  mistakes: string
  gamePlan: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTOR_ETFS: { name: string; etf: string }[] = [
  { name: 'Semiconductors', etf: 'SOXX' },
  { name: 'Tech Large Cap', etf: 'XLK' },
  { name: 'Financials', etf: 'XLF' },
  { name: 'Energy', etf: 'XLE' },
  { name: 'Healthcare', etf: 'XLV' },
  { name: 'Consumer Disc.', etf: 'XLY' },
  { name: 'Industrials', etf: 'XLI' },
  { name: 'S&P 500', etf: 'SPY' },
]

const EOD_CHECKS = [
  'Marked ORH and ORL on each stock',
  'Noted VWAP position at close',
  'Checked MA20 and MA50 proximity',
  'Recorded RSI level on daily',
  'Checked MACD histogram color',
  'Noted volume vs average',
  'Checked IVR before options plan',
  'Identified sector ETF trend',
  'Written tomorrow scenarios (Bull/Bear/Neutral)',
  'Set price alerts for trigger levels',
  'Defined entry, stop, and target for each setup',
  'Checked earnings calendar — no surprises',
]

const NOTES_KEY = 'eod_journal_notes_'
const CHECKS_KEY = 'eod_journal_checks_'

function todayKey() { return new Date().toISOString().split('T')[0] }
function fmt(n: number, d = 2) { return `$${n.toFixed(d)}` }
function pct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

// ─── Scenario generation (mirrors HTML logic) ─────────────────────────────────

function generateScenarios(
  close: number,
  vwap: number | null,
  ma20: number | null,
  ma50: number | null,
  bullScore: number,
  bearScore: number,
  breakoutLevel: number | null,
  riskBelow: number | null,
  scalpTarget: number | null,
): ComputedScenarios {
  const v = vwap ?? close
  const m20 = ma20 ?? close * 1.01
  const m50 = ma50 ?? close * 0.95
  const aboveVwap = close >= v

  // Map bull_score/bear_score to probabilities (0-100 → realistic %)
  const total = bullScore + bearScore || 100
  const baseBull = Math.round((bullScore / total) * 80)
  const baseBear = Math.round((bearScore / total) * 80)
  const bullProb = Math.max(10, Math.min(70, baseBull))
  const bearProb = Math.max(20, Math.min(75, baseBear))
  const neutralProb = Math.max(5, 100 - bullProb - bearProb)

  // ── Bull scenario ─────────────────────────────────────────────────────────
  const bullTriggerPx = aboveVwap ? (breakoutLevel ?? close * 1.01) : v
  const bullEntryPx   = aboveVwap ? (breakoutLevel ? breakoutLevel * 1.001 : close * 1.012) : (v + 0.10)
  const bullStopPx    = riskBelow ?? (aboveVwap ? v * 0.997 : close * 0.99)
  const bullT1Px      = scalpTarget ?? (aboveVwap ? m20 : (close + m20) / 2)
  const bullT2Px      = m20
  const bullRRn       = bullT1Px > bullEntryPx && bullEntryPx > bullStopPx
    ? ((bullT1Px - bullEntryPx) / (bullEntryPx - bullStopPx)).toFixed(1)
    : '2.5'

  const bullTrigger = aboveVwap
    ? `Hold above VWAP ${fmt(v)} + break above ${fmt(bullTriggerPx)} with volume`
    : `Gap up above ${fmt(bullTriggerPx)} with volume + VWAP reclaim`

  // ── Bear scenario ─────────────────────────────────────────────────────────
  const bearTriggerPx = aboveVwap ? v : close
  const bearEntryPx   = aboveVwap ? (v * 0.998) : (close * 0.998)
  const bearStopPx    = aboveVwap ? (v * 1.006) : (v + 0.50)
  const bearT1Px      = m50 < close * 0.975 ? m50 : close * 0.97
  const bearT2Px      = m50 < close * 0.95  ? m50 * 0.99 : close * 0.94
  const bearRRn       = bearEntryPx > bearT1Px && bearStopPx > bearEntryPx
    ? ((bearEntryPx - bearT1Px) / (bearStopPx - bearEntryPx)).toFixed(1)
    : '2.5'

  const bearTrigger = aboveVwap
    ? `Lose VWAP ${fmt(v)}, breakdown continues below ${fmt(bearTriggerPx)}`
    : `Open below ${fmt(bearTriggerPx)}, retest ${fmt(close)}-${fmt(v)} zone and fail`

  return {
    bull: {
      trigger: bullTrigger,
      entry: `${fmt(bullEntryPx)} on 1m hold above VWAP`,
      stop: fmt(bullStopPx),
      t1: `${fmt(bullT1Px)}${ma20 && Math.abs(bullT1Px - ma20) < 0.5 ? ' (MA20)' : ''}`,
      t2: `${fmt(bullT2Px)} (MA20)`,
      rr: `${bullRRn}:1`,
      probability: bullProb,
    },
    bear: {
      trigger: bearTrigger,
      entry: aboveVwap
        ? `${fmt(bearEntryPx)} short on VWAP breakdown`
        : `${fmt(bearEntryPx)} short on rejection`,
      stop: fmt(bearStopPx),
      t1: `${fmt(bearT1Px)}${ma50 && Math.abs(bearT1Px - ma50) < 0.5 ? ' (MA50)' : ''}`,
      t2: fmt(bearT2Px),
      rr: `${bearRRn}:1`,
      probability: bearProb,
    },
    neutral: {
      trigger: `Open ${fmt(close * 0.99)}–${fmt(close * 1.01)}, chop inside range`,
      entry: 'No trade — wait for breakout of range',
      probability: neutralProb,
    },
  }
}

function deriveStructure(close: number, ma20: number | null, ma50: number | null): string {
  const abMa20 = ma20 ? close > ma20 : false
  const abMa50 = ma50 ? close > ma50 : false
  if (abMa20 && abMa50)   return 'HL/HH'
  if (!abMa20 && !abMa50) return 'LL/LH'
  if (abMa50 && !abMa20)  return 'HL/LH (pullback)'
  return 'Recovery'
}

function deriveWeeklyTrend(mom5d: number): string {
  if (mom5d > 3)  return 'bullish'
  if (mom5d > 1)  return 'neutral-bullish'
  if (mom5d < -3) return 'bearish'
  if (mom5d < -1) return 'neutral-bearish'
  return 'neutral'
}

function deriveMacd(mom5d: number, close: number, ma20: number | null): string {
  const belowMa20 = ma20 ? close < ma20 : false
  if (mom5d < -2 && belowMa20) return 'bearish crossover'
  if (mom5d < 0  && belowMa20) return 'bearish histogram'
  if (mom5d > 2  && !belowMa20) return 'bullish crossover'
  if (mom5d > 0  && !belowMa20) return 'bullish histogram'
  return 'neutral'
}

function deriveSectorTrend(mom5d: number): SectorEntry['trend'] {
  if (mom5d > 1.5)  return 'up'
  if (mom5d < -1.5) return 'down'
  return 'sideways'
}

function deriveSectorRS(etfMom5d: number, spyMom5d: number, etf: string): SectorEntry['rs'] {
  if (etf === 'SPY') return 'index'
  const diff = etfMom5d - spyMom5d
  if (diff > 0.5)  return 'strong'
  if (diff < -0.5) return 'weak'
  return 'neutral'
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ isUp, label, price }: { isUp: boolean; label: string; price: string }) {
  const pts: number[] = []
  let p = 100
  for (let i = 0; i < 20; i++) {
    p += (Math.random() - (isUp ? 0.47 : 0.53)) * 2
    pts.push(p)
  }
  pts[pts.length - 1] = isUp ? Math.max(...pts) * 0.98 : Math.min(...pts) * 1.02
  const mn = Math.min(...pts), mx = Math.max(...pts)
  const W = 100, H = 40
  const sx = (i: number) => (i / (pts.length - 1)) * (W - 4) + 2
  const sy = (v: number) => H - 2 - ((v - mn) / (mx - mn + 0.001)) * (H - 6)
  const linePath = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${sx(pts.length - 1).toFixed(1)},${H} L${sx(0).toFixed(1)},${H} Z`
  const color = isUp ? '#3fb950' : '#f85149'
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, display: 'block' }}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sg)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={sx(pts.length - 1)} cy={sy(pts[pts.length - 1])} r="2.5" fill={color} />
      </svg>
      <div style={{ position: 'absolute', top: 6, left: 10, fontSize: 10, color: '#8b949e' }}>{label}</div>
      <div style={{ position: 'absolute', top: 6, right: 10, fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{price}</div>
    </div>
  )
}

// ─── Scenario Card ────────────────────────────────────────────────────────────

function ScenarioCard({ type, data }: { type: 'bull' | 'bear'; data: ScenarioData }) {
  const isBull = type === 'bull'
  const color = isBull ? '#3fb950' : '#f85149'
  const bg    = isBull ? '#0d2011' : '#200d0d'
  const bdr   = isBull ? '#1a4a1f' : '#5a1a1a'
  const icon  = isBull ? '▲' : '▼'
  const label = isBull ? 'BULL CASE — Gap Up / HL/HH' : 'BEAR CASE — Gap Down / LL/LH'
  const rows: [string, string, string?][] = [
    ['Trigger', data.trigger],
    ['Entry',   data.entry],
    ['Stop',    data.stop,  '#f85149'],
    ['Target 1', data.t1,  '#3fb950'],
    ['Target 2', data.t2,  '#3fb950'],
    ['R/R',     data.rr,   '#58a6ff'],
  ]
  return (
    <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon} {label}
        <span style={{
          marginLeft: 'auto', padding: '1px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          color, border: `1px solid ${bdr}`, background: 'rgba(0,0,0,.3)',
        }}>{data.probability}% prob</span>
      </div>
      {rows.map(([k, v, c]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 12 }}>
          <span style={{ color: '#8b949e', flexShrink: 0 }}>{k}</span>
          <span style={{ fontWeight: 700, color: c ?? '#f0f6fc', textAlign: 'right', maxWidth: '62%' }}>{v}</span>
        </div>
      ))}
      <div style={{ marginTop: 10, height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${data.probability}%`, background: color, borderRadius: 2 }} />
      </div>
      <div style={{ marginTop: 10, background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#8b949e', lineHeight: 1.6 }}>
        <strong style={{ color: '#e6edf3', display: 'block', marginBottom: 3 }}>📋 If this happens:</strong>
        {isBull
          ? 'Watch for gap + VWAP reclaim in first 5 min. Do NOT chase open. Wait for 1m pullback to VWAP, confirm hold, then enter. Stop below VWAP.'
          : 'Watch for weak open or retest of yesterday\'s close as resistance. Enter on VWAP rejection confirmation. Stop tight above level.'
        }
      </div>
    </div>
  )
}

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div style={{ background: '#1c2330', border: '1px solid #21262d', borderRadius: 7, padding: '9px 11px' }}>
      <div style={{ fontSize: 10, color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#f0f6fc', fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({ color, bg, border, children }: { color: string; bg: string; border: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, color, background: bg, border: `1px solid ${border}` }}>
      {children}
    </span>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  id, title, sub, collapsed, onToggle,
}: { id: string; title: string; sub?: string; collapsed: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      onClick={() => onToggle(id)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed ? 0 : 14, background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>{title}</span>
      {sub && <span style={{ fontSize: 11, color: '#8b949e' }}>{sub}</span>}
      <span style={{ marginLeft: 'auto', color: '#8b949e' }}>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
    </button>
  )
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadNotes(): Record<string, StockNotes> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY + todayKey()) ?? '{}') } catch { return {} }
}
function saveNotes(notes: Record<string, StockNotes>) {
  try { localStorage.setItem(NOTES_KEY + todayKey(), JSON.stringify(notes)) } catch { /* quota */ }
}
function loadChecks(): Record<number, boolean> {
  try { return JSON.parse(localStorage.getItem(CHECKS_KEY + todayKey()) ?? '{}') } catch { return {} }
}
function saveChecks(c: Record<number, boolean>) {
  try { localStorage.setItem(CHECKS_KEY + todayKey(), JSON.stringify(c)) } catch { /* quota */ }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EODJournalPage() {
  const { theme } = useApp()
  const isDark = theme !== 'light'

  const [myTickers,   setMyTickers]   = useState<MyTickerEntry[]>([])
  const [selected,    setSelected]    = useState<string | null>(null)
  const [analysis,    setAnalysis]    = useState<StockAnalysis | null>(null)
  const [sectors,     setSectors]     = useState<SectorEntry[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [dataError,   setDataError]   = useState<string | null>(null)
  const [spyChg,      setSpyChg]      = useState<number | null>(null)
  const [qqqChg,      setQqqChg]      = useState<number | null>(null)
  const [vixVal,      setVixVal]      = useState<number | null>(null)
  const [checkState,  setCheckState]  = useState<Record<number, boolean>>(loadChecks)
  const [notes,       setNotes]       = useState<Record<string, StockNotes>>(loadNotes)
  const [collapsed,   setCollapsed]   = useState<Record<string, boolean>>({})
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addQuery,    setAddQuery]    = useState('')
  const [searchRes,   setSearchRes]   = useState<SearchTickerResult[]>([])
  const [searching,   setSearching]   = useState(false)
  const [adding,      setAdding]      = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load My Tickers + Market Pulse on mount ───────────────────────────────
  useEffect(() => {
    fetchMyTickers().then(r => setMyTickers(r.data?.tickers ?? [])).catch(() => {})
    fetchMarketPosition().then(r => {
      if (r.data) {
        setSpyChg(r.data.spy_change_pct ?? null)
        setQqqChg(r.data.qqq_change_pct ?? null)
        setVixVal(r.data.vix ?? null)
      }
    }).catch(() => {})
  }, [])

  // ── Live ticker search ────────────────────────────────────────────────────
  useEffect(() => {
    if (!addQuery.trim()) { setSearchRes([]); return }
    if (searchRef.current) clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(() => {
      searchTickers(addQuery.trim())
        .then(r => setSearchRes(r.data?.results ?? []))
        .catch(() => setSearchRes([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [addQuery])

  // ── Fetch analysis for selected ticker ───────────────────────────────────
  const loadTickerData = useCallback(async (ticker: string) => {
    setLoadingData(true)
    setDataError(null)
    setAnalysis(null)

    try {
      const mt = myTickers.find(t => t.symbol === ticker)

      // Fetch in parallel: stock targets + swing analysis + signal feed (for IV rank)
      const [targetsRes, swingRes, feedRes, sectorRes] = await Promise.allSettled([
        fetchStockTargets(ticker),
        analyzeSwingTrade(ticker) as Promise<SwingTradeScanResult>,
        fetchSignalFeed({ search: ticker, page_size: 5 }),
        Promise.allSettled(SECTOR_ETFS.map(s => fetchStockTargets(s.etf))),
      ])

      const targets  = targetsRes.status  === 'fulfilled' ? targetsRes.value  : null
      const swing    = swingRes.status    === 'fulfilled' ? swingRes.value    : null
      const feed     = feedRes.status     === 'fulfilled' ? feedRes.value     : null
      const sectorResults = sectorRes.status === 'fulfilled' ? sectorRes.value : []

      if (!targets && !swing) {
        setDataError('Could not fetch data. Please try again.')
        return
      }

      // ── Prices ─────────────────────────────────────────────────────────
      const close     = targets?.current_price ?? mt?.last_price ?? 0
      const chgAmt    = mt?.price_change ?? 0
      const prevClose = close > 0 ? (close - chgAmt) : 0
      const mom5d     = targets?.mom_5d ?? 0

      // ── Swing metrics ───────────────────────────────────────────────────
      const eg       = swing?.entry_guidance as ({
        vwap?: number; breakout_level?: number; risk_below?: number; scalp_target?: number
      }) | undefined
      const vwap     = eg?.vwap ?? null
      const brkLvl   = eg?.breakout_level ?? null
      const riskBel  = eg?.risk_below ?? null
      const scalpTgt = eg?.scalp_target ?? null
      const bias: 'bull' | 'bear' | 'neutral' = swing?.bias === 'long' ? 'bull' : swing?.bias === 'short' ? 'bear' : 'neutral'
      const bullScore = swing?.bull_score ?? 45
      const bearScore = swing?.bear_score ?? 45
      const conf      = swing?.confidence ?? 50

      // ── Derived technical fields ────────────────────────────────────────
      const ma20   = targets?.ma20 ?? null
      const ma50   = targets?.ma50 ?? null
      const rsi    = targets?.rsi ?? null
      const struct = deriveStructure(close, ma20, ma50)
      const wkTrnd = deriveWeeklyTrend(mom5d)
      const macd   = deriveMacd(mom5d, close, ma20)

      // ── IV rank from signal feed ─────────────────────────────────────────
      const feedRow = feed?.data?.rows?.find(r => r.ticker.toUpperCase() === ticker.toUpperCase())
      const ivr     = feedRow?.metrics?.iv_rank ?? null
      const rs      = feedRow?.metrics?.relative_strength != null
        ? feedRow.metrics.relative_strength > 60 ? 'strong vs sector'
          : feedRow.metrics.relative_strength > 40 ? 'neutral vs sector'
          : 'weak vs sector'
        : 'neutral'
      const volRatio = feedRow?.metrics?.volume_ratio ?? null

      // ── Company / sector ─────────────────────────────────────────────────
      const company   = swing?.company_name ?? mt?.company_name ?? ''
      const sector    = feedRow?.sector ?? ''
      const sectorEtf = sector.toLowerCase().includes('semi') ? 'SOXX'
        : sector.toLowerCase().includes('tech') ? 'XLK'
        : sector.toLowerCase().includes('financ') ? 'XLF'
        : sector.toLowerCase().includes('energy') ? 'XLE'
        : sector.toLowerCase().includes('health') ? 'XLV'
        : sector.toLowerCase().includes('consumer') ? 'XLY'
        : sector.toLowerCase().includes('industri') ? 'XLI'
        : 'SPY'

      // ── Generate scenarios ───────────────────────────────────────────────
      const scenarios = generateScenarios(
        close, vwap, ma20, ma50,
        bullScore, bearScore,
        brkLvl, riskBel, scalpTgt,
      )

      // ── Sector data ──────────────────────────────────────────────────────
      const spyTargets = sectorResults.find((_, i) => SECTOR_ETFS[i]?.etf === 'SPY')
      const spyMom5d = spyTargets?.status === 'fulfilled' ? spyTargets.value.mom_5d : 0

      const newSectors: SectorEntry[] = SECTOR_ETFS.map((sec, i) => {
        const r = sectorResults[i]
        const mom = r?.status === 'fulfilled' ? r.value.mom_5d : 0
        return {
          name: sec.name,
          etf:  sec.etf,
          mom5d: mom,
          trend: deriveSectorTrend(mom),
          rs:    deriveSectorRS(mom, spyMom5d, sec.etf),
        }
      })
      setSectors(newSectors)

      setAnalysis({
        ticker, company, sector,
        close, prevClose, vwap,
        ma20, ma50, rsi,
        ivr, structure: struct,
        weeklyTrend: wkTrnd,
        macd, rs, volRatio,
        sectorEtf, bias,
        bullScore, bearScore,
        confidence: conf,
        scenarios,
        fetchedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      })
    } catch (e) {
      setDataError((e instanceof Error ? e.message : null) ?? 'Data fetch failed')
    } finally {
      setLoadingData(false)
    }
  }, [myTickers])

  // Auto-load when ticker selected
  useEffect(() => {
    if (selected) loadTickerData(selected)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddTicker = useCallback(async (symbol: string, company: string) => {
    setAdding(true)
    try {
      const r = await addMyTicker({ symbol, trade_types: ['swing'] })
      setMyTickers(r.data?.tickers ?? myTickers)
      setSelected(symbol)
      setShowAddForm(false)
      setAddQuery('')
      setSearchRes([])
    } catch { /* duplicate */ } finally { setAdding(false) }
  }, [myTickers])

  const toggleCheck = (i: number) => {
    setCheckState(prev => {
      const next = { ...prev, [i]: !prev[i] }
      saveChecks(next)
      return next
    })
  }

  const toggleSection = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const updateNote = (ticker: string, key: keyof StockNotes, val: string) => {
    setNotes(prev => {
      const next = { ...prev, [ticker]: { ...(prev[ticker] ?? { observations: '', mistakes: '', gamePlan: '' }), [key]: val } }
      saveNotes(next)
      return next
    })
  }

  const handleSaveNotes = () => {
    saveNotes(notes)
    setSaveFeedback('Saved ✓')
    setTimeout(() => setSaveFeedback(null), 2000)
  }

  const handleExport = useCallback(() => {
    if (!analysis) return
    const a = analysis
    const n = notes[a.ticker] ?? { observations: '', mistakes: '', gamePlan: '' }
    const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    let txt = `=== EOD JOURNAL — NEXT DAY PREP ===\nDate: ${date}\n\n`
    txt += `──────────────────────\n`
    txt += `${a.ticker} — ${fmt(a.close)} (${pct((a.close - a.prevClose) / a.prevClose * 100)})\n`
    txt += `Structure: ${a.structure} | Bias: ${a.bias.toUpperCase()} | Confidence: ${a.confidence}%\n`
    txt += `VWAP: ${a.vwap ? fmt(a.vwap) : '—'} | MA20: ${a.ma20 ? fmt(a.ma20) : '—'} | RSI: ${a.rsi ?? '—'} | IVR: ${a.ivr ?? '—'}\n\n`
    txt += `BULL CASE (${a.scenarios.bull.probability}%):\n  ${a.scenarios.bull.trigger}\n  Entry: ${a.scenarios.bull.entry} | Stop: ${a.scenarios.bull.stop} | T1: ${a.scenarios.bull.t1}\n\n`
    txt += `BEAR CASE (${a.scenarios.bear.probability}%):\n  ${a.scenarios.bear.trigger}\n  Entry: ${a.scenarios.bear.entry} | Stop: ${a.scenarios.bear.stop} | T1: ${a.scenarios.bear.t1}\n\n`
    if (n.observations) txt += `OBSERVATIONS: ${n.observations}\n`
    if (n.mistakes)     txt += `LESSON: ${n.mistakes}\n`
    if (n.gamePlan)     txt += `GAME PLAN: ${n.gamePlan}\n`

    const blob = new Blob([txt], { type: 'text/plain' })
    const el = document.createElement('a')
    el.href = URL.createObjectURL(blob)
    el.download = `eod_journal_${todayKey()}_${a.ticker}.txt`
    el.click()
    URL.revokeObjectURL(el.href)
  }, [analysis, notes])

  // ── Derived display values ────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const doneChecks = Object.values(checkState).filter(Boolean).length
  const checkPct   = Math.round((doneChecks / EOD_CHECKS.length) * 100)

  const chgAbs = analysis ? analysis.close - analysis.prevClose : 0
  const chgPct = analysis && analysis.prevClose > 0 ? (chgAbs / analysis.prevClose) * 100 : 0
  const isUp   = chgAbs >= 0

  const ivrNum       = analysis?.ivr ?? 0
  const optionsType  = ivrNum < 40
    ? (analysis?.bias === 'bull' ? 'Buy ATM Call' : 'Buy ATM Put')
    : ivrNum < 60
    ? (analysis?.bias === 'bull' ? 'Debit Call Spread' : 'Debit Put Spread')
    : (analysis?.bias === 'bull' ? 'Bull Put Spread' : 'Bear Call Spread')
  const optionsDTE   = ivrNum < 40 ? '10–14 DTE' : ivrNum < 60 ? '14 DTE spreads' : '14–21 DTE spreads'
  const optionsWhy   = ivrNum < 40
    ? 'IVR low — options cheap. Buy direct. IV expansion benefits you.'
    : ivrNum < 60
    ? 'IVR mid-range. Use spreads to cap vega risk. Still directional.'
    : 'IVR elevated. Avoid buying premium. Sell premium or use spreads.'

  const bullPct = analysis?.scenarios.bull.probability ?? 40
  const bearPct = analysis?.scenarios.bear.probability ?? 45
  const domColor = bearPct > bullPct ? '#f85149' : '#3fb950'
  const primaryBias = bearPct > bullPct ? 'SHORT' : 'LONG'
  const domScenario = bearPct > bullPct ? analysis?.scenarios.bear : analysis?.scenarios.bull

  const conf = analysis?.confidence ?? 50

  const mySector = analysis ? sectors.find(s => s.etf === analysis.sectorEtf) : null
  const spySector = sectors.find(s => s.etf === 'SPY')
  const sectorAligned = analysis && mySector
    ? (analysis.bias === 'bear' && mySector.trend === 'down') || (analysis.bias === 'bull' && mySector.trend === 'up')
    : null

  const curNotes = selected ? (notes[selected] ?? { observations: '', mistakes: '', gamePlan: '' }) : null

  // ── Colors ────────────────────────────────────────────────────────────────

  const pageBg   = isDark ? '#080b10' : '#f6f8fa'
  const sideBg   = isDark ? '#0d1117' : '#ffffff'
  const cardBg   = isDark ? '#161b22' : '#ffffff'
  const cardBg2  = isDark ? '#1c2330' : '#f6f8fa'
  const bdr      = isDark ? '#21262d' : '#d0d7de'
  const tx       = isDark ? '#f0f6fc' : '#1f2328'
  const txMuted  = isDark ? '#8b949e' : '#57606a'

  const iStyle: React.CSSProperties = {
    background: isDark ? '#0d1117' : '#f6f8fa',
    border: `1px solid ${bdr}`,
    borderRadius: 6, color: tx, fontSize: 12, padding: '6px 9px',
    fontFamily: 'inherit', width: '100%',
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: pageBg }}>

      {/* Header */}
      <div style={{ background: sideBg, borderBottom: `1px solid ${bdr}`, padding: '13px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: tx, letterSpacing: '-0.3px' }}>EOD Journal · Next Day Prep</div>
          <div style={{ fontSize: 11, color: txMuted, marginTop: 1 }}>End-of-session analysis → Tomorrow's game plan</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: txMuted }}>{today}</div>
          {analysis && (
            <button onClick={() => loadTickerData(analysis.ticker)} disabled={loadingData} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${bdr}`, background: cardBg2, color: txMuted, display: 'flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={12} className={loadingData ? 'animate-spin' : ''} />
              {loadingData ? 'Fetching…' : 'Refresh'}
            </button>
          )}
          <button onClick={handleExport} disabled={!analysis} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: analysis ? 'pointer' : 'default', border: '1px solid #1a3050', background: '#0d1a28', color: analysis ? '#58a6ff' : '#3a5a7a', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1 }}>

        {/* ── Sidebar ── */}
        <div style={{ background: sideBg, borderRight: `1px solid ${bdr}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 'calc(100vh - 57px)', position: 'sticky', top: 57 }}>

          {/* Watchlist */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: txMuted, marginBottom: 8 }}>Watchlist</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {myTickers.map(t => {
                const isActive = selected === t.symbol
                const pos = (t.price_change_pct ?? 0) >= 0
                const biasColor = analysis?.ticker === t.symbol
                  ? (analysis.bias === 'bull' ? '#3fb950' : analysis.bias === 'bear' ? '#f85149' : '#d29922')
                  : '#6e7681'
                return (
                  <div key={t.symbol} onClick={() => setSelected(t.symbol)} style={{ background: isActive ? (isDark ? '#0d1a28' : '#e8f0fe') : cardBg, border: `1px solid ${isActive ? '#58a6ff' : bdr}`, borderRadius: 8, padding: '9px 11px', cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s' }}>
                    <div style={{ position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: '50%', background: biasColor }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: tx, fontFamily: 'monospace' }}>{t.symbol}</span>
                      {t.last_price && <span style={{ fontSize: 12, fontWeight: 600, color: pos ? '#3fb950' : '#f85149', fontFamily: 'monospace' }}>${t.last_price.toFixed(2)}</span>}
                    </div>
                    {t.price_change_pct != null && (
                      <div style={{ fontSize: 11, color: pos ? '#3fb950' : '#f85149', marginTop: 1 }}>
                        {pos ? '+' : ''}{t.price_change_pct.toFixed(2)}%
                      </div>
                    )}
                    {analysis?.ticker === t.symbol && (
                      <div style={{ fontSize: 10, color: txMuted, marginTop: 3, letterSpacing: '0.03em', fontWeight: 600 }}>
                        {analysis.structure} · {analysis.weeklyTrend}
                      </div>
                    )}
                    {loadingData && selected === t.symbol && (
                      <div style={{ position: 'absolute', top: 9, right: 20 }}>
                        <Loader2 size={11} className="animate-spin" style={{ color: '#58a6ff' }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Add stock */}
            {!showAddForm ? (
              <button onClick={() => setShowAddForm(true)} style={{ marginTop: 8, width: '100%', background: isDark ? '#1c2330' : '#f6f8fa', border: `1px dashed ${bdr}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', color: txMuted, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Plus size={12} /> Add Stock
              </button>
            ) : (
              <div style={{ marginTop: 8, background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: txMuted }}>Add to My Tickers</span>
                  <button onClick={() => { setShowAddForm(false); setAddQuery(''); setSearchRes([]) }} style={{ background: 'none', border: 'none', color: txMuted, cursor: 'pointer', padding: 2 }}><X size={12} /></button>
                </div>
                <input autoFocus style={iStyle} value={addQuery} onChange={e => setAddQuery(e.target.value)} placeholder="Search ticker…" />
                {searching && <div style={{ fontSize: 11, color: txMuted, marginTop: 4 }}>Searching…</div>}
                {searchRes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
                    {searchRes.slice(0, 5).map(r => (
                      <button key={r.symbol} onClick={() => handleAddTicker(r.symbol, r.company)} disabled={adding} style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 5, padding: '5px 8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: tx }}>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{r.symbol}</span>
                        <span style={{ color: txMuted, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: bdr }} />

          {/* Market Pulse */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: txMuted, marginBottom: 8 }}>Market Pulse</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                { sym: 'SPY',  chg: spyChg,  note: spyChg != null ? (spyChg < 0 ? 'Below VWAP, bearish' : 'Above VWAP, bullish') : 'Loading…' },
                { sym: 'QQQ',  chg: qqqChg,  note: qqqChg != null ? (qqqChg < 0 ? 'OR low breakdown' : 'OR high reclaim') : 'Loading…' },
                { sym: 'VIX',  chg: vixVal,  note: vixVal != null ? (vixVal > 25 ? 'Fear elevated' : vixVal > 18 ? 'Moderately elevated' : 'Contained') : 'Loading…' },
              ].map(({ sym, chg, note }) => (
                <div key={sym} style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 7, padding: '7px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: tx, fontFamily: 'monospace', fontSize: 12 }}>{sym}</span>
                    {chg != null
                      ? <span style={{ fontWeight: 700, fontSize: 12, color: sym === 'VIX' ? (chg > 25 ? '#f85149' : '#d29922') : (chg >= 0 ? '#3fb950' : '#f85149') }}>
                          {sym === 'VIX' ? chg.toFixed(2) : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}
                        </span>
                      : <span style={{ fontSize: 11, color: txMuted }}>—</span>
                    }
                  </div>
                  <div style={{ fontSize: 11, color: txMuted, marginTop: 1 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: bdr }} />

          {/* EOD Checklist */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: txMuted, marginBottom: 8 }}>EOD Checklist</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {EOD_CHECKS.map((c, i) => (
                <div key={i} onClick={() => toggleCheck(i)} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '5px 7px', background: checkState[i] ? '#0d2011' : cardBg, border: `1px solid ${checkState[i] ? '#1a4a1f' : bdr}`, borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {checkState[i] ? <CheckSquare size={13} style={{ color: '#3fb950', flexShrink: 0, marginTop: 1 }} /> : <Square size={13} style={{ color: '#30363d', flexShrink: 0, marginTop: 1 }} />}
                  <span style={{ fontSize: 11, color: checkState[i] ? '#6e7681' : tx, textDecoration: checkState[i] ? 'line-through' : 'none', flex: 1, lineHeight: 1.4 }}>{c}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: txMuted, marginBottom: 3 }}>
                <span>Prep progress</span>
                <span style={{ color: checkPct === 100 ? '#3fb950' : '#d29922', fontWeight: 700 }}>{doneChecks}/{EOD_CHECKS.length}</span>
              </div>
              <div style={{ height: 4, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${checkPct}%`, background: checkPct === 100 ? '#3fb950' : '#d29922', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Empty state */}
          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: txMuted, gap: 12 }}>
              <div style={{ fontSize: 40 }}>📓</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: tx }}>Select a ticker to begin</div>
              <div style={{ fontSize: 13 }}>Choose a stock from your watchlist, or use "+ Add Stock" to add from My Tickers</div>
            </div>
          )}

          {/* Loading */}
          {selected && loadingData && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
              <Loader2 size={36} className="animate-spin" style={{ color: '#58a6ff' }} />
              <div style={{ color: tx, fontWeight: 700, fontSize: 15 }}>Fetching {selected} data…</div>
              <div style={{ color: txMuted, fontSize: 12 }}>Running swing analysis + technical indicators</div>
            </div>
          )}

          {/* Error */}
          {selected && !loadingData && dataError && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
              <AlertCircle size={32} style={{ color: '#f85149' }} />
              <div style={{ color: '#f85149', fontWeight: 700 }}>{dataError}</div>
              <button onClick={() => loadTickerData(selected)} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${bdr}`, background: cardBg2, color: tx }}>Retry</button>
            </div>
          )}

          {/* Analysis loaded */}
          {selected && !loadingData && analysis && (

            <>
              {/* ── Stock Hero ── */}
              <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: tx, letterSpacing: '-1px', fontFamily: 'monospace' }}>{analysis.ticker}</div>
                    <div style={{ fontSize: 12, color: txMuted, marginTop: 2 }}>{analysis.company}{analysis.sector ? ` · ${analysis.sector}` : ''}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Bias pill */}
                      {analysis.bias === 'bull' && <Pill color="#3fb950" bg="#0d2011" border="#1a4a1f">↑ BULL BIAS</Pill>}
                      {analysis.bias === 'bear' && <Pill color="#f85149" bg="#200d0d" border="#5a1a1a">↓ BEAR BIAS</Pill>}
                      {analysis.bias === 'neutral' && <Pill color="#d29922" bg="#1a1200" border="#4a3800">→ NEUTRAL</Pill>}
                      {/* Structure */}
                      <Pill color="#58a6ff" bg="#0d1a28" border="#1a3050">{analysis.structure}</Pill>
                      {/* IVR */}
                      {analysis.ivr != null && (
                        <>
                          <Pill color="#bc8cff" bg="#140d20" border="#3a1a5a">IVR {analysis.ivr.toFixed(0)}</Pill>
                          <Pill
                            color={analysis.ivr < 35 ? '#3fb950' : analysis.ivr < 60 ? '#d29922' : '#f85149'}
                            bg={analysis.ivr < 35 ? '#0d2011' : analysis.ivr < 60 ? '#1a1200' : '#200d0d'}
                            border={analysis.ivr < 35 ? '#1a4a1f' : analysis.ivr < 60 ? '#4a3800' : '#5a1a1a'}
                          >
                            {analysis.ivr < 35 ? 'BUY OPTIONS' : analysis.ivr < 60 ? 'USE SPREADS' : 'SELL PREMIUM'}
                          </Pill>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: isUp ? '#3fb950' : '#f85149', fontFamily: 'monospace' }}>{fmt(analysis.close)}</div>
                    <div style={{ fontSize: 12, color: isUp ? '#3fb950' : '#f85149', marginTop: 2 }}>
                      {isUp ? '+' : ''}{fmt(Math.abs(chgAbs))} ({isUp ? '+' : ''}{chgPct.toFixed(2)}%) today
                    </div>
                    <div style={{ marginTop: 5, display: 'flex', justifyContent: 'flex-end' }}>
                      <Pill
                        color={analysis.rs.includes('strong') ? '#3fb950' : analysis.rs.includes('weak') ? '#f85149' : '#d29922'}
                        bg={analysis.rs.includes('strong') ? '#0d2011' : analysis.rs.includes('weak') ? '#200d0d' : '#1a1200'}
                        border={analysis.rs.includes('strong') ? '#1a4a1f' : analysis.rs.includes('weak') ? '#5a1a1a' : '#4a3800'}
                      >
                        RS: {analysis.rs}
                      </Pill>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 10, color: txMuted }}>fetched {analysis.fetchedAt}</div>
                  </div>
                </div>

                {/* Stat boxes */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
                  <StatBox
                    label="Close"
                    value={fmt(analysis.close)}
                    sub="Today's close"
                    color="#58a6ff"
                  />
                  <StatBox
                    label="VWAP"
                    value={analysis.vwap ? fmt(analysis.vwap) : '—'}
                    sub={analysis.vwap ? (analysis.close < analysis.vwap ? 'Close below VWAP' : 'Close above VWAP') : 'Not available'}
                    color={analysis.vwap ? (analysis.close < analysis.vwap ? '#f85149' : '#3fb950') : txMuted}
                  />
                  <StatBox
                    label="MA20"
                    value={analysis.ma20 ? fmt(analysis.ma20) : '—'}
                    sub={analysis.ma20 ? (analysis.close < analysis.ma20 ? 'Below — bearish' : 'Above — bullish') : ''}
                    color={analysis.ma20 ? (analysis.close < analysis.ma20 ? '#f85149' : '#3fb950') : txMuted}
                  />
                  <StatBox
                    label="MA50"
                    value={analysis.ma50 ? fmt(analysis.ma50) : '—'}
                    sub={analysis.ma50 ? (analysis.close < analysis.ma50 ? 'Below — danger' : 'Above — support') : ''}
                    color={analysis.ma50 ? (analysis.close < analysis.ma50 ? '#f85149' : '#3fb950') : txMuted}
                  />
                  <StatBox
                    label="RSI (Daily)"
                    value={analysis.rsi != null ? String(analysis.rsi) : '—'}
                    sub={analysis.rsi != null ? (analysis.rsi < 35 ? 'Oversold' : analysis.rsi > 65 ? 'Overbought' : 'Neutral zone') : ''}
                    color={analysis.rsi != null ? (analysis.rsi < 35 ? '#f85149' : analysis.rsi > 65 ? '#d29922' : '#3fb950') : txMuted}
                  />
                </div>

                {/* Sparkline */}
                <div style={{ background: cardBg2, borderRadius: 6, overflow: 'hidden', border: `1px solid ${bdr}` }}>
                  <Sparkline isUp={isUp} label="20-day price action" price={fmt(analysis.close)} />
                </div>
              </div>

              {/* ── Tomorrow's Scenarios ── */}
              <div>
                <SectionHeader id="scenarios" title="Tomorrow's Scenarios" sub="3 cases — define before open" collapsed={!!collapsed['scenarios']} onToggle={toggleSection} />
                {!collapsed['scenarios'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <ScenarioCard type="bull" data={analysis.scenarios.bull} />
                      <ScenarioCard type="bear" data={analysis.scenarios.bear} />
                    </div>

                    {/* Neutral strip */}
                    <div style={{ background: '#1a1200', border: '1px solid #4a3800', borderRadius: 10, padding: '12px 16px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#d29922', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          → NEUTRAL / CHOP — No Clear Direction
                          <span style={{ marginLeft: 'auto', padding: '1px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#d29922', border: '1px solid #4a3800', background: 'rgba(0,0,0,.3)' }}>{analysis.scenarios.neutral.probability}% prob</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 12 }}>
                          <span style={{ color: '#8b949e' }}>Trigger</span>
                          <span style={{ fontWeight: 700, color: '#d29922', textAlign: 'right', maxWidth: '65%' }}>{analysis.scenarios.neutral.trigger}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                          <span style={{ color: '#8b949e' }}>Action</span>
                          <span style={{ fontWeight: 700, color: '#f0f6fc' }}>{analysis.scenarios.neutral.entry}</span>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: '9px 11px', fontSize: 11, color: '#8b949e', lineHeight: 1.7 }}>
                        <strong style={{ color: '#f0f6fc', display: 'block', marginBottom: 3 }}>Honest Rule:</strong>
                        If market opens flat and your stock chops between two obvious levels — <span style={{ color: '#f85149', fontWeight: 600 }}>no trade is a trade.</span> Flat = +$0. Forced trades = -$.
                      </div>
                    </div>

                    <div style={{ padding: '9px 13px', background: isDark ? '#1a0e00' : '#fff8f0', border: '1px solid #5a2a00', borderRadius: 7, fontSize: 12, color: '#ffa657', lineHeight: 1.7 }}>
                      <strong>Rule:</strong> Probabilities derived from live swing analysis. Bull {analysis.scenarios.bull.probability}% · Bear {analysis.scenarios.bear.probability}% · Neutral {analysis.scenarios.neutral.probability}%. If you can't write a clean trigger — you don't have a trade.
                    </div>
                  </div>
                )}
              </div>

              {/* ── Structure & Context ── */}
              <div>
                <SectionHeader id="structure" title="Structure & Context" sub="What today tells you about tomorrow" collapsed={!!collapsed['structure']} onToggle={toggleSection} />
                {!collapsed['structure'] && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Today's Story */}
                    <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#58a6ff' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: txMuted }}>Today's Story</span>
                      </div>
                      {[
                        { k: 'Today\'s Structure', v: analysis.structure, c: analysis.structure.includes('LL') ? '#f85149' : '#3fb950' },
                        { k: 'Weekly Trend', v: analysis.weeklyTrend, c: analysis.weeklyTrend.includes('bear') ? '#f85149' : analysis.weeklyTrend.includes('bull') ? '#3fb950' : '#d29922' },
                        { k: 'Close vs VWAP', v: analysis.vwap ? (analysis.close < analysis.vwap ? 'Below VWAP ↓' : 'Above VWAP ↑') : '—', c: analysis.vwap ? (analysis.close < analysis.vwap ? '#f85149' : '#3fb950') : txMuted },
                        { k: 'Close vs MA20', v: analysis.ma20 ? (analysis.close < analysis.ma20 ? 'Below MA20 ↓' : 'Above MA20 ↑') : '—', c: analysis.ma20 ? (analysis.close < analysis.ma20 ? '#f85149' : '#3fb950') : txMuted },
                        { k: 'Close vs MA50', v: analysis.ma50 ? (analysis.close < analysis.ma50 ? 'Below MA50 ↓' : 'Above MA50 ↑') : '—', c: analysis.ma50 ? (analysis.close < analysis.ma50 ? '#f85149' : '#3fb950') : txMuted },
                        { k: 'MACD Signal', v: analysis.macd, c: analysis.macd.includes('bear') ? '#f85149' : analysis.macd.includes('bull') ? '#3fb950' : '#d29922' },
                        { k: 'Volume Ratio', v: analysis.volRatio != null ? `${analysis.volRatio.toFixed(2)}x avg` : '—', c: analysis.volRatio && analysis.volRatio > 1.2 ? '#ffa657' : txMuted },
                      ].map(({ k, v, c }) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${bdr}`, fontSize: 12 }}>
                          <span style={{ color: txMuted }}>{k}</span>
                          <span style={{ fontWeight: 700, color: c }}>{v}</span>
                        </div>
                      ))}
                    </div>

                    {/* Key Price Levels */}
                    <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#d29922' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: txMuted }}>Key Price Levels Tomorrow</span>
                      </div>
                      {[
                        { name: 'VWAP (close)', val: analysis.vwap, note: analysis.vwap ? (analysis.close < analysis.vwap ? 'Overhead — key resistance' : 'Below — key support') : 'Not available' },
                        { name: 'MA20 (daily)', val: analysis.ma20, note: analysis.ma20 ? (analysis.close < analysis.ma20 ? 'Resistance overhead' : 'Support below') : '' },
                        { name: 'MA50 (daily)', val: analysis.ma50, note: analysis.ma50 ? (analysis.close < analysis.ma50 ? 'Broken — danger zone' : 'Support holding') : '' },
                        { name: 'Today\'s Close', val: analysis.close, note: 'Tomorrow\'s reference open' },
                        { name: 'Prev Close', val: analysis.prevClose > 0 ? analysis.prevClose : null, note: 'Yesterday\'s close' },
                      ]
                        .filter(l => l.val != null && l.val > 0)
                        .sort((a, b) => (b.val ?? 0) - (a.val ?? 0))
                        .map(l => {
                          const v = l.val ?? 0
                          const col = Math.abs(v - analysis.close) < 0.01 ? '#58a6ff' : v > analysis.close ? '#f85149' : '#3fb950'
                          return (
                            <div key={l.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${bdr}`, fontSize: 12 }}>
                              <div>
                                <div style={{ color: col, fontWeight: 600 }}>{l.name}</div>
                                <div style={{ fontSize: 10, color: txMuted }}>{l.note}</div>
                              </div>
                              <div style={{ fontWeight: 700, color: col, fontFamily: 'monospace' }}>{fmt(v)}</div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sector Context ── */}
              <div>
                <SectionHeader id="sector" title="Sector Context" sub="Does the sector support the trade?" collapsed={!!collapsed['sector']} onToggle={toggleSection} />
                {!collapsed['sector'] && sectors.length > 0 && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                      {sectors.map(sec => {
                        const isRelated = sec.etf === analysis.sectorEtf || sec.etf === 'SPY'
                        const pos = sec.mom5d >= 0
                        const barW = Math.min(100, Math.abs(sec.mom5d) * 15)
                        const chgColor = pos ? '#3fb950' : '#f85149'
                        const borderColor2 = isRelated ? (pos ? '#3fb950' : '#f85149') : bdr
                        return (
                          <div key={sec.etf} style={{ background: isDark ? '#161b22' : '#ffffff', border: `1px solid ${borderColor2}`, borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: txMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{sec.name}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: tx, fontFamily: 'monospace' }}>{sec.etf}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: chgColor }}>{pos ? '+' : ''}{sec.mom5d.toFixed(2)}%<span style={{ fontSize: 9, color: txMuted }}> 5d</span></span>
                            </div>
                            <div style={{ height: 4, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${barW}%`, background: pos ? '#3fb950' : '#f85149', borderRadius: 2 }} />
                            </div>
                            <div style={{ fontSize: 10, color: sec.rs === 'strong' ? '#3fb950' : sec.rs === 'weak' ? '#f85149' : txMuted }}>
                              RS: {sec.rs} · {sec.trend}
                            </div>
                            {isRelated && sec.etf !== 'SPY' && (
                              <div style={{ fontSize: 10, color: '#58a6ff', marginTop: 3, fontWeight: 600 }}>← YOUR SECTOR</div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Sector verdict */}
                    {mySector && (
                      <div style={{ marginTop: 12, borderRadius: 8, padding: '10px 14px', fontSize: 12, borderLeft: `3px solid ${sectorAligned ? '#3fb950' : '#f85149'}`, background: sectorAligned ? '#0d2011' : '#200d0d', color: sectorAligned ? '#7ee787' : '#ffa29e', lineHeight: 1.7 }}>
                        <strong>{sectorAligned ? '✓ Sector Aligned:' : '⚠ Sector Conflict:'}</strong>{' '}
                        {analysis.ticker}'s sector ({mySector.name} / {mySector.etf}) is {mySector.trend} with {mySector.mom5d >= 0 ? '+' : ''}{mySector.mom5d.toFixed(2)}% (5d).{' '}
                        {sectorAligned
                          ? `This supports the ${analysis.bias} bias. Sector tailwind behind the trade — higher probability.`
                          : `Sector is moving ${mySector.trend} while your trade bias is ${analysis.bias}. Consider smaller size or wait for sector alignment.`
                        }
                      </div>
                    )}
                  </>
                )}
                {!collapsed['sector'] && sectors.length === 0 && (
                  <div style={{ color: txMuted, fontSize: 12 }}>Loading sector data…</div>
                )}
              </div>

              {/* ── Perception Builder ── */}
              <div>
                <SectionHeader id="perception" title="Perception Builder" sub="Your mental model for tomorrow's open" collapsed={!!collapsed['perception']} onToggle={toggleSection} />
                {!collapsed['perception'] && (
                  <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                      {/* Bull summary */}
                      <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3fb950' }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3fb950' }} />
                          Bull Case {bullPct}%
                        </div>
                        <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 3, padding: 0 }}>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${bdr}` }}>↑ {analysis.scenarios.bull.trigger}</li>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${bdr}` }}>Entry: <strong style={{ color: tx }}>{analysis.scenarios.bull.entry}</strong></li>
                          <li style={{ padding: '3px 0' }}>Target: <span style={{ color: '#3fb950', fontWeight: 700 }}>{analysis.scenarios.bull.t1} → {analysis.scenarios.bull.t2}</span></li>
                        </ul>
                      </div>
                      {/* Bear summary */}
                      <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f85149' }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f85149' }} />
                          Bear Case {bearPct}%
                        </div>
                        <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 3, padding: 0 }}>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${bdr}` }}>↓ {analysis.scenarios.bear.trigger}</li>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${bdr}` }}>Entry: <strong style={{ color: tx }}>{analysis.scenarios.bear.entry}</strong></li>
                          <li style={{ padding: '3px 0' }}>Target: <span style={{ color: '#f85149', fontWeight: 700 }}>{analysis.scenarios.bear.t1} → {analysis.scenarios.bear.t2}</span></li>
                        </ul>
                      </div>
                      {/* Perception */}
                      <div style={{ background: bearPct > bullPct ? '#200d0d' : '#0d2011', border: `1px solid ${bearPct > bullPct ? '#5a1a1a' : '#1a4a1f'}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: domColor }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: domColor }} />
                          Tomorrow's Perception
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: domColor, marginBottom: 6 }}>{primaryBias} BIAS</div>
                        <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.7 }}>
                          Primary watch: <strong style={{ color: tx }}>{domScenario?.trigger}</strong><br />
                          If triggered → enter <strong style={{ color: domColor }}>{domScenario?.entry}</strong><br />
                          Stop at <strong style={{ color: '#f85149' }}>{domScenario?.stop}</strong> · T1 <strong style={{ color: '#3fb950' }}>{domScenario?.t1}</strong>
                        </div>
                        <div style={{ marginTop: 8, padding: '7px 9px', background: 'rgba(0,0,0,.25)', borderRadius: 5, fontSize: 11, color: '#6e7681' }}>
                          If opposite case triggers → flip or stay flat. Never force the primary scenario.
                        </div>
                      </div>
                    </div>

                    {/* Confidence meter */}
                    <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: tx }}>Setup Confidence</span>
                        <span style={{ fontSize: 18, fontWeight: 800, color: conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149' }}>{conf}%</span>
                      </div>
                      <div style={{ height: 8, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ height: '100%', width: `${conf}%`, background: conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149', borderRadius: 4, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{ borderRadius: 7, padding: '8px 12px', fontSize: 12, borderLeft: `3px solid ${conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149'}`, background: conf >= 70 ? '#0d2011' : conf >= 50 ? '#1a1200' : '#200d0d', color: conf >= 70 ? '#7ee787' : conf >= 50 ? '#f0c040' : '#ffa29e', lineHeight: 1.7 }}>
                        <strong>{conf >= 70 ? 'High conviction:' : conf >= 50 ? 'Moderate conviction:' : 'Low conviction — caution:'}</strong>{' '}
                        {conf >= 70
                          ? 'Structure, sector, and indicators aligned. Trade the plan. Standard size.'
                          : conf >= 50
                          ? 'Setup exists but some signals mixed. Reduce size by 30–50%. Wait for clean trigger.'
                          : 'Too many conflicting signals. Skip or paper trade. Capital preservation first.'
                        }
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Options Plan ── */}
              <div>
                <SectionHeader
                  id="options"
                  title="Options Plan for Tomorrow"
                  sub={analysis.ivr != null ? `IVR ${analysis.ivr.toFixed(0)} · ${optionsDTE}` : 'IV Rank not available'}
                  collapsed={!!collapsed['options']}
                  onToggle={toggleSection}
                />
                {!collapsed['options'] && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bc8cff' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#bc8cff' }} />
                        Recommended Structure
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#bc8cff', marginBottom: 6 }}>{analysis.ivr != null ? optionsType : '—'}</div>
                      <div style={{ fontSize: 12, color: txMuted, marginBottom: 10 }}>{analysis.ivr != null ? `${optionsDTE} · ${optionsWhy}` : 'Enter IVR to get recommendation'}</div>
                      {[
                        { label: 'Entry trigger', val: domScenario?.trigger.split(' ').slice(0, 5).join(' ') + '…' },
                        { label: 'Option stop',   val: '50% of premium paid',   col: '#f85149' },
                        { label: 'Exit T1',        val: '50–75% gain → sell half', col: '#3fb950' },
                        { label: 'Exit T2',        val: 'Move stop to BE, let ride', col: '#3fb950' },
                      ].map(r => (
                        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${bdr}`, fontSize: 12 }}>
                          <span style={{ color: txMuted }}>{r.label}</span>
                          <span style={{ fontWeight: 700, color: r.col ?? tx }}>{r.val}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#d29922' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#d29922' }} />
                        IV Warning
                      </div>
                      <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 2, padding: 0 }}>
                        {[
                          `IVR ${analysis.ivr != null ? analysis.ivr.toFixed(0) : '?'} — ${analysis.ivr != null ? (analysis.ivr < 40 ? 'Low — buy premium' : analysis.ivr < 60 ? 'Mid — use spreads' : 'High — sell premium') : 'unknown'}`,
                          'Earnings within DTE? → skip or reduce size',
                          'Use stop-limit not stop-market on options',
                          'Set stock-price alert → manual option exit',
                          'Never hold through expiration week',
                        ].map((item, i) => (
                          <li key={i} style={{ padding: '3px 0', borderBottom: i < 4 ? `1px solid ${bdr}` : 'none' }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Journal Notes (MANUAL INPUT ONLY) ── */}
              <div>
                <SectionHeader id="notes" title={`Journal Notes — ${analysis.ticker}`} collapsed={!!collapsed['notes']} onToggle={toggleSection} />
                {!collapsed['notes'] && curNotes && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Manual text areas */}
                    <div>
                      <label style={{ fontSize: 10, color: txMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>What I observed today</label>
                      <textarea
                        style={{ width: '100%', background: isDark ? '#0d1117' : '#f6f8fa', border: `1px solid ${bdr}`, borderRadius: 8, padding: 12, color: tx, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 80, lineHeight: 1.6, outline: 'none' }}
                        value={curNotes.observations}
                        onChange={e => updateNote(selected!, 'observations', e.target.value)}
                        placeholder={`e.g. ${analysis.ticker} broke ORL at open, VWAP stayed overhead all day, sold off into close…`}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 10, color: txMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Mistake / Lesson</label>
                        <textarea
                          style={{ width: '100%', background: isDark ? '#0d1117' : '#f6f8fa', border: `1px solid ${bdr}`, borderRadius: 8, padding: 12, color: tx, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 64, lineHeight: 1.6, outline: 'none' }}
                          value={curNotes.mistakes}
                          onChange={e => updateNote(selected!, 'mistakes', e.target.value)}
                          placeholder="e.g. Entered call before OR formed — thesis was wrong from start"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: txMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Tomorrow's Game Plan (1 sentence)</label>
                        <textarea
                          style={{ width: '100%', background: isDark ? '#0d1117' : '#f6f8fa', border: `1px solid ${bdr}`, borderRadius: 8, padding: 12, color: tx, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 64, lineHeight: 1.6, outline: 'none' }}
                          value={curNotes.gamePlan}
                          onChange={e => updateNote(selected!, 'gamePlan', e.target.value)}
                          placeholder={`e.g. Watch for ${analysis.scenarios[analysis.bias === 'bear' ? 'bear' : 'bull'].trigger.toLowerCase().slice(0, 50)}…`}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleSaveNotes} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: saveFeedback ? '#1a4a1f' : '#21a047', color: saveFeedback ? '#3fb950' : '#000', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Save size={13} /> {saveFeedback ?? 'Save Notes'}
                      </button>
                      <button onClick={handleExport} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid #1a3050', background: '#0d1a28', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Download size={13} /> Export
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ height: 32 }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
