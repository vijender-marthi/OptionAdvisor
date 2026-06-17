import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, CheckSquare, Square, RefreshCw, Download, Save, ChevronDown, ChevronUp, X, Loader2, AlertCircle, Calendar } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import {
  fetchMyTickers, addMyTicker, searchTickers,
  fetchMarketPosition, fetchStockTargets,
  type MyTickerEntry, type SearchTickerResult,
} from '../api/commandCenter'
import { analyzeSwingTrade, type SwingTradeScanResult } from '../api/client'
import { fetchSignalFeed } from '../api/commandCenter'
import {
  buildFibData, detectFibMaConfluence, loadSwingToolSettings,
  FIB_PCTS, FIB_COLORS, FIB_ZONE_META,
  EMA9_TOOLTIP, FIB_TOOLTIP, CONFLUENCE_TOOLTIP,
  type FibData, type ConfluenceZone,
} from '../utils/fibConfluence'

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
  // ── Additive: 9 EMA early-momentum signal ──
  ema9: number | null
  ema9Slope: 'up' | 'flat' | 'down' | null
  priceVsEma9: 'above' | 'at' | 'below' | null
  // ── Additive: Fibonacci + confluence pullback tooling ──
  fib: FibData | null
  confluence: ConfluenceZone[]
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
  // ── Additive items (13–15): 9 EMA / Fib / Confluence pullback tooling ──
  '9 EMA crossed against my position? (early warning — tighten stop, do not exit)',
  'Identified fib retracement from recent swing high/low',
  'Found confluence zone for entry',
]

// Sub-notes for the additive checklist items, keyed by index.
const EOD_CHECK_NOTES: Record<number, string> = {
  12: 'If holding long and price closed below 9 EMA today: tighten stop, do not exit. 9 EMA is early warning. If the next 2 days also close below 9 EMA, exit. The actual exit trigger remains the MA20 break.',
  13: 'Draw fib from the last 20-day swing. Note which level current price is in (23.6%, 38.2%, 50%, 61.8%, 78.6%).',
  14: 'Two or more levels aligning within $1 = high-conviction entry zone. Three or more = strong setup. Set an alert at this price.',
}

const NOTES_KEY = 'eod_journal_notes_'
const CHECKS_KEY = 'eod_journal_checks_'
const EXIT_STRATEGY_KEY = 'exit_strategy_'
const SNAPSHOT_KEY = 'eod_journal_snapshot_'
const SNAPSHOT_KEEP_DAYS = 3

const EXIT_TOOLTIP = [
  "EV uses the scenario's probability as P(T1 hit).",
  "P(T2|T1): conditional probability T2 hits AFTER T1.",
  "Adjust based on conviction:",
  "  Strong trending: 60-70%",
  "  Average setup:   40-50%",
  "  Choppy/contested: 25-35%",
  "",
  "Options mode: $1 stock move ≈ $50 per contract (50 delta ATM).",
  "Shares mode: raw $ × shares.",
  "",
  "When all EVs are near zero — the setup is marginal.",
  "No exit strategy can fix a bad R/R.",
].join('\n')

function todayKey() { return new Date().toISOString().split('T')[0] }
function fmt(n: number, d = 2) { return `$${n.toFixed(d)}` }
function pct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

// ─── Exit Strategy Types & Helpers ────────────────────────────────────────────

interface ExitStrategyState {
  contracts: number
  pT2GivenT1: number
  mode: 'options' | 'shares'
}

function parsePrice(s: string): number {
  const m = s.match(/\$?([\d,]+\.?\d*)/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0
}

function loadExitState(ticker: string, type: string): ExitStrategyState {
  try {
    const saved = localStorage.getItem(EXIT_STRATEGY_KEY + ticker + '_' + type + '_' + todayKey())
    if (saved) return JSON.parse(saved)
  } catch { /* */ }
  return { contracts: 1, pT2GivenT1: 50, mode: 'options' }
}

function saveExitState(ticker: string, type: string, state: ExitStrategyState) {
  try {
    localStorage.setItem(EXIT_STRATEGY_KEY + ticker + '_' + type + '_' + todayKey(), JSON.stringify(state))
  } catch { /* */ }
}

function useCountUp(target: number, duration = 350) {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const from = fromRef.current
    if (Math.abs(from - target) < 0.5) { fromRef.current = target; return }
    const start = performance.now()
    let raf: number
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - t) * (1 - t)
      setDisplay(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return display
}

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

// ─── Light/dark theme helpers (EOD Journal) ─────────────────────────────────
// Every value below resolves dark → light. Pass the page's `isDark` so inset
// panels, overlays, dividers and muted text match the rest of the app in light
// mode instead of rendering dark-on-light.
const eodBullBg   = (d: boolean) => (d ? '#0d2011' : '#eaf7ee')
const eodBearBg   = (d: boolean) => (d ? '#200d0d' : '#fdeded')
const eodNeutBg   = (d: boolean) => (d ? '#1a1200' : '#fef6e6')
const eodPanelBg  = (d: boolean) => (d ? '#0d1117' : '#ffffff')       // inset card surface
const eodInsetBg  = (d: boolean) => (d ? '#1c2330' : '#f6f8fa')       // stat box / dashed surface
const eodOverlay  = (d: boolean) => (d ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.55)')
const eodOverlay3 = (d: boolean) => (d ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.65)')
const eodDivider  = (d: boolean) => (d ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)')
const eodHairline = (d: boolean) => (d ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.09)')
const eodTxStrong = (d: boolean) => (d ? '#f0f6fc' : '#1f2328')
const eodTxMuted  = (d: boolean) => (d ? '#8b949e' : '#57606a')
const eodTxFaint  = (d: boolean) => (d ? '#6e7681' : '#8590a0')

// ─── Scenario Card ────────────────────────────────────────────────────────────

function ScenarioCard({ type, data, ticker, panelColors }: { type: 'bull' | 'bear'; data: ScenarioData; ticker: string; panelColors?: PanelColors }) {
  const isBull = type === 'bull'
  const isDark = panelColors?.isDark ?? true
  const color = isBull ? (isDark ? '#3fb950' : '#15803d') : (isDark ? '#f85149' : '#b91c1c')
  const bg    = isBull ? (isDark ? '#0d2011' : '#eaf7ee') : (isDark ? '#200d0d' : '#fdeded')
  const bdr   = isBull ? (isDark ? '#1a4a1f' : '#3d7a0f') : (isDark ? '#5a1a1a' : '#b91c1c')
  const icon  = isBull ? '▲' : '▼'
  const label = isBull ? 'BULL CASE — Gap Up / HL/HH' : 'BEAR CASE — Gap Down / LL/LH'

  // ── Exit strategy state (persisted per ticker + type + day) ──────────────
  const [contracts, setContracts] = useState(() => loadExitState(ticker, type).contracts)
  const [pT2GivenT1, setPT2GivenT1] = useState(() => loadExitState(ticker, type).pT2GivenT1)
  const [mode, setMode] = useState<'options' | 'shares'>(() => loadExitState(ticker, type).mode)

  useEffect(() => {
    saveExitState(ticker, type, { contracts, pT2GivenT1, mode })
  }, [ticker, type, contracts, pT2GivenT1, mode])

  // ── EV calculations ───────────────────────────────────────────────────────
  const entryNum = parsePrice(data.entry)
  const stopNum  = parsePrice(data.stop)
  const t1Num    = parsePrice(data.t1)
  const t2Num    = parsePrice(data.t2)

  const stopDist = Math.abs(entryNum - stopNum)
  const t1Dist   = Math.abs(t1Num - entryNum)
  const t2Dist   = Math.abs(t2Num - entryNum)

  // mult = dollar value of the full position per $1 stock move
  const mult = mode === 'options' ? 50 * contracts : contracts
  const prob = data.probability / 100
  const pT2  = pT2GivenT1 / 100

  const t1D  = t1Dist * mult
  const t2D  = t2Dist * mult
  const stpD = stopDist * mult

  // Strategy 1: Exit at T1
  const ev1 = prob * t1D - (1 - prob) * stpD

  // Strategy 2: Hold for T2 (T1 reverses = break-even; T1 missed = full stop)
  const ev2 = prob * pT2 * t2D - (1 - prob) * stpD

  // Strategy 3: Trail (half at T1 locked, half runs to T2; requires 2+ contracts)
  const ev3Raw = prob * (t1D / 2) + prob * pT2 * (t2D / 2) - (1 - prob) * stpD
  const ev3 = contracts >= 2 ? ev3Raw : null

  // Animated display values
  const animEv1 = useCountUp(ev1)
  const animEv2 = useCountUp(ev2)
  const animEv3 = useCountUp(ev3 ?? 0)

  // Win rates
  const wr1 = data.probability
  const wr2 = Math.round(prob * pT2 * 100)
  const wr3 = data.probability

  // ── Best strategy ─────────────────────────────────────────────────────────
  function isClose(a: number, b: number) {
    const mx = Math.max(Math.abs(a), Math.abs(b))
    return mx < 1 ? true : Math.abs(a - b) / mx <= 0.1
  }
  function getBestId() {
    if (contracts < 2) {
      if (isClose(ev1, ev2)) return 1 // prefer lower variance
      return ev1 >= ev2 ? 1 : 2
    }
    const e3 = ev3!
    if (isClose(e3, ev1)) return 3 // trail has better risk profile
    const maxEV = Math.max(ev1, ev2, e3)
    if (maxEV === e3) return 3
    if (maxEV === ev1) return 1
    return 2
  }
  const bestId = getBestId()

  // Marginal warning: all non-disabled EVs within $50 of zero
  const evList = [ev1, ev2, ...(ev3 !== null ? [ev3] : [])]
  const allMarginal = evList.every(e => Math.abs(e) < 50)

  // Recommendation text
  function getRecText() {
    const names: Record<number, string> = { 1: 'Exit at T1', 2: 'Hold for T2', 3: 'Trail Stop' }
    const bestEV = bestId === 1 ? ev1 : bestId === 2 ? ev2 : ev3!
    const sign = bestEV >= -0.5 ? '+' : '-'
    const amt  = `$${Math.abs(bestEV).toFixed(0)}`

    if (contracts < 2 && Math.abs(ev1 - ev2) < 5) {
      return `EVs are nearly identical with 1 contract. Exit at T1 chosen for lower variance. Upgrade to 2+ contracts to unlock Trail Stop.`
    }
    const reasons: Record<number, string> = {
      1: `${wr1}% win rate with lowest variance. Lock in T1 profit — don't give it back.`,
      2: `${wr2}% chance of reaching T2 after T1. Only use if setup is clearly trending.`,
      3: `Half locked at T1 with zero risk on second half. Best risk-adjusted return at ${contracts} contracts.`,
    }
    return `With ${contracts} contract${contracts > 1 ? 's' : ''} at ${data.probability}% probability, ${names[bestId]} gives best EV of ${sign}${amt}. ${reasons[bestId]}`
  }

  const rows: [string, string, string?][] = [
    ['Trigger',  data.trigger],
    ['Entry',    data.entry],
    ['Stop',     data.stop,  '#f85149'],
    ['Target 1', data.t1,   '#3fb950'],
    ['Target 2', data.t2,   '#3fb950'],
    ['R/R',      data.rr,   '#58a6ff'],
  ]

  const btnSm: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4, fontSize: 14, fontWeight: 700,
    border: `1px solid ${eodHairline(isDark)}`, background: isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)',
    color: eodTxStrong(isDark), cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 0, lineHeight: 1,
  }

  const stratCards = [
    { id: 1, name: 'EXIT AT T1',  icon: '🎯', col: '#58a6ff', ev: animEv1, variance: 'LOW',  wr: wr1, disabled: false },
    { id: 2, name: 'HOLD FOR T2', icon: '🚀', col: '#bc8cff', ev: animEv2, variance: 'HIGH', wr: wr2, disabled: false },
    { id: 3, name: 'TRAIL STOP',  icon: '⚡',  col: '#3fb950', ev: animEv3, variance: 'MED',  wr: wr3, disabled: contracts < 2 },
  ]

  const bestName  = bestId === 1 ? 'Exit at T1' : bestId === 2 ? 'Hold for T2' : 'Trail Stop'
  const bestColor = bestId === 1 ? '#58a6ff'    : bestId === 2 ? '#bc8cff'     : '#3fb950'

  return (
    <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 10, padding: '14px 16px' }}>
      {/* Header */}
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon} {label}
        <span style={{
          marginLeft: 'auto', padding: '1px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          color, border: `1px solid ${bdr}`, background: eodOverlay3(isDark),
        }}>{data.probability}% prob</span>
      </div>

      {/* Scenario rows */}
      {rows.map(([k, v, c]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: `1px solid ${eodDivider(isDark)}`, fontSize: 12 }}>
          <span style={{ color: eodTxMuted(isDark), flexShrink: 0 }}>{k}</span>
          <span style={{ fontWeight: 700, color: c ?? eodTxStrong(isDark), textAlign: 'right', maxWidth: '62%' }}>{v}</span>
        </div>
      ))}

      {/* Probability bar */}
      <div style={{ marginTop: 10, height: 4, background: isDark ? '#21262d' : '#d0d7de', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${data.probability}%`, background: color, borderRadius: 2 }} />
      </div>

      {/* If this happens */}
      <div style={{ marginTop: 10, background: eodOverlay(isDark), borderRadius: 6, padding: '8px 10px', fontSize: 11, color: eodTxMuted(isDark), lineHeight: 1.6 }}>
        <strong style={{ color: eodTxStrong(isDark), display: 'block', marginBottom: 3 }}>📋 If this happens:</strong>
        {isBull
          ? 'Watch for gap + VWAP reclaim in first 5 min. Do NOT chase open. Wait for 1m pullback to VWAP, confirm hold, then enter. Stop below VWAP.'
          : "Watch for weak open or retest of yesterday's close as resistance. Enter on VWAP rejection confirmation. Stop tight above level."
        }
      </div>

      {/* ── EXIT STRATEGY ─────────────────────────────────────────────────── */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${eodHairline(isDark)}`, paddingTop: 14 }}>

        {/* Header + tooltip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color }}>
            Exit Strategy
          </span>
          <span title={EXIT_TOOLTIP} style={{ fontSize: 12, color: eodTxMuted(isDark), cursor: 'help', userSelect: 'none' }}>ⓘ</span>
        </div>

        {/* Contracts + mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: eodTxMuted(isDark) }}>{mode === 'options' ? 'Contracts' : 'Shares'}</span>
            <button style={btnSm} onClick={() => setContracts(c => Math.max(1, c - 1))}>−</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: eodTxStrong(isDark), fontFamily: 'monospace', minWidth: 22, textAlign: 'center' }}>{contracts}</span>
            <button style={btnSm} onClick={() => setContracts(c => c + 1)}>+</button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', borderRadius: 5, overflow: 'hidden', border: `1px solid ${eodHairline(isDark)}` }}>
            {(['options', 'shares'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: mode === m ? 700 : 400,
                  background: mode === m ? color : 'transparent',
                  color: mode === m ? (isDark ? (isBull ? '#0d2011' : '#200d0d') : '#ffffff') : eodTxMuted(isDark),
                  border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                }}
              >{m}</button>
            ))}
          </div>
        </div>

        {/* P(T2|T1) slider */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
            <span style={{ color: eodTxMuted(isDark) }}>P(T2 | T1 hit)</span>
            <span style={{ fontWeight: 700, color: eodTxStrong(isDark), fontFamily: 'monospace' }}>{pT2GivenT1}%</span>
          </div>
          <input
            type="range" min="10" max="90" step="5"
            value={pT2GivenT1}
            onChange={e => setPT2GivenT1(Number(e.target.value))}
            style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
          />
        </div>

        {/* Marginal setup warning */}
        {allMarginal && (
          <div style={{ marginBottom: 10, padding: '7px 10px', background: eodNeutBg(isDark), border: `1px solid ${isDark ? '#5a3a00' : '#e0b050'}`, borderRadius: 6, fontSize: 11, color: isDark ? '#ffa657' : '#9a6700', lineHeight: 1.6 }}>
            ⚠ Marginal setup — EV near zero at this probability. No strategy fixes a bad R/R. Consider higher conviction before sizing up.
          </div>
        )}

        {/* Strategy mini-cards (3 across) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 11 }}>
          {stratCards.map(s => {
            const isBestCard = bestId === s.id && !s.disabled
            return (
              <div
                key={s.id}
                style={{
                  background: eodPanelBg(isDark),
                  border: isBestCard ? '1px solid #d29922' : `1px solid ${eodHairline(isDark)}`,
                  borderRadius: 7, padding: '10px 11px', minHeight: 96,
                  opacity: s.disabled ? 0.4 : 1, position: 'relative',
                  boxShadow: isBestCard ? '0 0 10px rgba(210,153,34,.2)' : 'none',
                  transition: 'border-color .2s, box-shadow .2s',
                }}
              >
                {isBestCard && (
                  <span style={{ position: 'absolute', top: -9, right: 2, fontSize: 13 }}>⭐</span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: s.col, letterSpacing: '0.05em' }}>{s.name}</span>
                  <span style={{ fontSize: 13 }}>{s.icon}</span>
                </div>
                {s.disabled ? (
                  <div style={{ fontSize: 10, color: eodTxMuted(isDark), lineHeight: 1.5, marginTop: 4 }}>
                    Requires<br />2+ contracts
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace', color: s.ev >= -0.5 ? '#3fb950' : '#f85149', marginBottom: 4 }}>
                      {s.ev >= -0.5 ? '+' : '-'}${Math.abs(s.ev).toFixed(0)}
                    </div>
                    <div style={{ fontSize: 10, color: eodTxFaint(isDark), lineHeight: 1.6 }}>
                      <span style={{ color: eodTxMuted(isDark) }}>Var </span>{s.variance}
                      {' · '}
                      <span style={{ color: eodTxMuted(isDark) }}>Win </span>{s.wr}%
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Recommendation */}
        <div style={{ background: eodOverlay3(isDark), borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: eodTxStrong(isDark), marginBottom: 4 }}>
            ▸ Recommendation:{' '}
            <span style={{ color: bestColor }}>{bestName}</span>
          </div>
          <div style={{ fontSize: 11, color: eodTxMuted(isDark), lineHeight: 1.7 }}>{getRecText()}</div>
        </div>

      </div>
    </div>
  )
}

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, color, tooltip }: { label: string; value: string; sub: string; color?: string; tooltip?: string }) {
  const { theme } = useApp()
  const isDark = theme !== 'light'
  return (
    <div style={{ background: eodInsetBg(isDark), border: `1px solid ${isDark ? '#21262d' : '#e1e4e8'}`, borderRadius: 7, padding: '9px 11px' }}>
      <div style={{ fontSize: 10, color: eodTxMuted(isDark), fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {tooltip && <span title={tooltip} style={{ cursor: 'help', userSelect: 'none', color: eodTxFaint(isDark) }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? eodTxStrong(isDark), fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: eodTxMuted(isDark), marginTop: 2 }}>{sub}</div>
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
  const { theme } = useApp()
  const isDark = theme !== 'light'
  return (
    <button
      onClick={() => onToggle(id)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed ? 0 : 14, background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: eodTxStrong(isDark) }}>{title}</span>
      {sub && <span style={{ fontSize: 11, color: eodTxMuted(isDark) }}>{sub}</span>}
      <span style={{ marginLeft: 'auto', color: eodTxMuted(isDark) }}>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
    </button>
  )
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadNotes(dateKey: string): Record<string, StockNotes> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY + dateKey) ?? '{}') } catch { return {} }
}
function saveNotes(dateKey: string, notes: Record<string, StockNotes>) {
  try { localStorage.setItem(NOTES_KEY + dateKey, JSON.stringify(notes)) } catch { /* quota */ }
}
function loadChecks(dateKey: string): Record<number, boolean> {
  try { return JSON.parse(localStorage.getItem(CHECKS_KEY + dateKey) ?? '{}') } catch { return {} }
}
function saveChecks(dateKey: string, c: Record<number, boolean>) {
  try { localStorage.setItem(CHECKS_KEY + dateKey, JSON.stringify(c)) } catch { /* quota */ }
}

// ─── Dated snapshots ───────────────────────────────────────────────────────────
// The analysis is live data that changes through the day. Snapshotting it per
// date+ticker lets the trader save an EOD entry and review the last few days
// instead of always seeing the latest fetch.

interface SnapshotEntry { analysis: StockAnalysis; sectors: SectorEntry[]; savedAt: string }

/** Most recent N calendar days as ISO date keys (today first). */
function recentDateKeys(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(d.toISOString().split('T')[0])
  }
  return out
}
function loadDaySnapshots(dateKey: string): Record<string, SnapshotEntry> {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY + dateKey) ?? '{}') } catch { return {} }
}
function loadSnapshot(dateKey: string, ticker: string): SnapshotEntry | null {
  return loadDaySnapshots(dateKey)[ticker] ?? null
}
function saveSnapshot(dateKey: string, ticker: string, analysis: StockAnalysis, sectors: SectorEntry[]) {
  try {
    const day = loadDaySnapshots(dateKey)
    day[ticker] = { analysis, sectors, savedAt: new Date().toISOString() }
    localStorage.setItem(SNAPSHOT_KEY + dateKey, JSON.stringify(day))
  } catch { /* quota */ }
}
/** Drop snapshot buckets older than the retention window. */
function pruneSnapshots(keepDays: number) {
  const keep = new Set(recentDateKeys(keepDays))
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(SNAPSHOT_KEY) && !keep.has(k.slice(SNAPSHOT_KEY.length))) {
        localStorage.removeItem(k)
      }
    }
  } catch { /* ignore */ }
}

// ─── Fibonacci + Confluence panels (additive) ──────────────────────────────────

interface PanelColors { isDark: boolean; cardBg: string; cardBg2: string; bdr: string; tx: string; txMuted: string }

function fmtSwingDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Fib ladder — dotted horizontal lines per level, labelled with % + price (Part 13).
function FibLadder({ fib, price, colors }: { fib: FibData; price: number; colors: PanelColors }) {
  const vals = FIB_PCTS.map(p => fib.levels[p])
  const lo = Math.min(...vals, price, fib.swingLow)
  const hi = Math.max(...vals, price, fib.swingHigh)
  const span = hi - lo || 1
  const H = 150, W = 320, padX = 8
  const y = (v: number) => 8 + (1 - (v - lo) / span) * (H - 16)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {FIB_PCTS.map(p => {
        const yy = y(fib.levels[p])
        const col = FIB_COLORS[p]
        const isCur = fib.currentZone === p
        return (
          <g key={p}>
            <line x1={padX} y1={yy} x2={W - padX} y2={yy} stroke={col} strokeWidth={isCur ? 1.6 : 1} strokeDasharray="4 3" opacity={isCur ? 1 : 0.7} />
            <text x={padX} y={yy - 3} fontSize="9" fill={col} fontFamily="monospace" fontWeight={isCur ? 700 : 400}>{p}%</text>
            <text x={W - padX} y={yy - 3} fontSize="9" fill={col} fontFamily="monospace" textAnchor="end" fontWeight={isCur ? 700 : 400}>${fib.levels[p].toFixed(2)}</text>
          </g>
        )
      })}
      {/* Current price marker */}
      <line x1={padX} y1={y(price)} x2={W - padX} y2={y(price)} stroke={colors.isDark ? '#f0f6fc' : '#1f2328'} strokeWidth={1.4} />
      <text x={(W) / 2} y={y(price) - 3} fontSize="9" fill={colors.isDark ? '#f0f6fc' : '#1f2328'} fontFamily="monospace" textAnchor="middle" fontWeight={700}>now ${price.toFixed(2)}</text>
    </svg>
  )
}

function FibPanel({ fib, price, colors }: { fib: FibData; price: number; colors: PanelColors }) {
  const { cardBg, cardBg2, bdr, tx, txMuted } = colors
  const zoneMeta = FIB_ZONE_META[fib.currentZone]
  return (
    <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: tx }}>Fibonacci Retracement</span>
        <span title={FIB_TOOLTIP} style={{ fontSize: 12, color: txMuted, cursor: 'help', userSelect: 'none' }}>ⓘ</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: fib.direction === 'up' ? '#3fb950' : '#f85149', fontWeight: 700 }}>
          {fib.direction === 'up' ? 'Bullish — measuring pullback zones' : 'Bearish — measuring bounce zones'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: txMuted, marginBottom: 12 }}>
        Swing High: <span style={{ color: tx, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(fib.swingHigh)}</span>{fib.swingHighDate ? ` (${fmtSwingDate(fib.swingHighDate)})` : ''}
        {'  →  '}
        Swing Low: <span style={{ color: tx, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(fib.swingLow)}</span>{fib.swingLowDate ? ` (${fmtSwingDate(fib.swingLowDate)})` : ''}
      </div>

      <div className="eod-journal-fib-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* Level rows */}
        <div>
          {FIB_PCTS.map(p => {
            const meta = FIB_ZONE_META[p]
            const isCur = fib.currentZone === p
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, marginBottom: 2, background: isCur ? (colors.isDark ? 'rgba(255,255,255,.05)' : '#f0f4f8') : 'transparent', border: isCur ? `1px solid ${meta.color}` : '1px solid transparent' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, fontFamily: 'monospace', minWidth: 44 }}>{p}%</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: tx, fontFamily: 'monospace', minWidth: 70 }}>{fmt(fib.levels[p])}</span>
                <span style={{ fontSize: 11, color: txMuted, flex: 1 }}>← {meta.label}</span>
                {isCur && <span style={{ fontSize: 9, fontWeight: 700, color: meta.color, textTransform: 'uppercase' }}>here</span>}
              </div>
            )
          })}
        </div>
        {/* Ladder visual */}
        <div style={{ background: cardBg2, borderRadius: 6, border: `1px solid ${bdr}`, padding: '6px 4px' }}>
          <FibLadder fib={fib} price={price} colors={colors} />
        </div>
      </div>

      {/* Verdict */}
      <div style={{ marginTop: 12, borderRadius: 7, padding: '9px 12px', fontSize: 12, borderLeft: `3px solid ${zoneMeta.color}`, background: colors.isDark ? 'rgba(0,0,0,.25)' : '#f6f8fa', color: tx, lineHeight: 1.6 }}>
        Current price <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{fmt(price)}</span> → in the{' '}
        <span style={{ color: zoneMeta.color, fontWeight: 700 }}>{fib.currentZone}% zone</span>.{' '}
        <strong>Verdict:</strong> {zoneMeta.verdict}
      </div>
    </div>
  )
}

function ConfluencePanel({ zones, price, colors }: { zones: ConfluenceZone[]; price: number; colors: PanelColors }) {
  const { cardBg, bdr, tx, txMuted } = colors
  return (
    <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: tx }}>Confluence Zones</span>
        <span title={CONFLUENCE_TOOLTIP} style={{ fontSize: 12, color: txMuted, cursor: 'help', userSelect: 'none' }}>ⓘ</span>
        <span style={{ fontSize: 11, color: txMuted }}>Where multiple levels align</span>
      </div>
      {zones.length === 0 ? (
        <div style={{ fontSize: 12, color: txMuted, lineHeight: 1.6 }}>
          No levels aligning within the confluence threshold right now. Wait for price to pull back toward a zone where 9 EMA, MA20/50, or a fib level cluster.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {zones.map((z, i) => {
            const strong = z.strength === 'STRONG'
            const col = strong ? '#3fb950' : '#d29922'
            const below = z.price <= price
            const dist = Math.abs(z.price - price)
            const type = below ? 'Pullback support — high-conviction buy zone' : 'Resistance — caution if approaching'
            return (
              <div key={i} style={{ borderLeft: `3px solid ${col}`, background: colors.isDark ? 'rgba(0,0,0,.25)' : '#f6f8fa', borderRadius: 7, padding: '9px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: tx, fontFamily: 'monospace' }}>{fmt(z.price)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: col, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{strong ? '⭐ STRONG' : 'MEDIUM'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: txMuted, fontFamily: 'monospace' }}>{fmt(dist)} {below ? 'below' : 'above'}</span>
                </div>
                <div style={{ fontSize: 11, color: tx, marginBottom: 2 }}>Levels: <span style={{ color: col, fontWeight: 700 }}>{z.levelsAligned.join(' + ')}</span></div>
                <div style={{ fontSize: 11, color: txMuted }}>Type: {type}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Static worked example for first-time users (Part 11). Collapsed by default.
function ArmExamplePanel({ colors }: { colors: PanelColors }) {
  const { cardBg2, bdr, tx, txMuted } = colors
  const rows: [string, string][] = [
    ['23.6%', '$366.12'], ['38.2%', '$354.44'], ['50.0%', '$345.00'], ['61.8%', '$335.56'], ['78.6%', '$322.12'],
  ]
  return (
    <div style={{ background: cardBg2, border: `1px dashed ${bdr}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: txMuted, lineHeight: 1.7 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Example — ARM (how to read fib + 9 EMA + MAs)</div>
      <div>Recent swing low: <strong style={{ color: tx }}>$305 (Jun 11)</strong> → swing high: <strong style={{ color: tx }}>$385 (Jun 13)</strong>. Direction: <span style={{ color: '#3fb950', fontWeight: 700 }}>Bullish</span> — measuring pullback zones.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, margin: '8px 0' }}>
        {rows.map(([p, v]) => (
          <div key={p} style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, color: tx, fontFamily: 'monospace' }}>{p}</div>
            <div style={{ fontFamily: 'monospace' }}>{v}</div>
          </div>
        ))}
      </div>
      <div>MAs: 9 EMA <strong style={{ color: tx }}>$355</strong> · MA20 <strong style={{ color: tx }}>$345</strong> · MA50 <strong style={{ color: tx }}>$315</strong>.</div>
      <div style={{ marginTop: 6 }}>
        <span style={{ color: '#d29922', fontWeight: 700 }}>$354 zone</span> = 38.2% Fib + 9 EMA (within $1) → MEDIUM.{' '}
        <span style={{ color: '#3fb950', fontWeight: 700 }}>$345 zone ⭐</span> = 50% Fib + MA20 (exact) → STRONG.
      </div>
      <div style={{ marginTop: 6, color: tx }}>
        If ARM pulls back, watch $354 first (early support). If $354 fails, $345 is the high-conviction buy zone where 50% Fib and MA20 both support. Below $335 (61.8% Fib), the trend is in question.
      </div>
    </div>
  )
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
  const [viewDate,    setViewDate]    = useState<string>(todayKey())
  const [checkState,  setCheckState]  = useState<Record<number, boolean>>(() => loadChecks(todayKey()))
  const [notes,       setNotes]       = useState<Record<string, StockNotes>>(() => loadNotes(todayKey()))
  const [entrySaved,  setEntrySaved]  = useState<string | null>(null)
  const [collapsed,   setCollapsed]   = useState<Record<string, boolean>>({ fibExample: true })
  const [showEma9]                    = useState(() => loadSwingToolSettings().showEma9)
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
      const swingSettings = loadSwingToolSettings()

      // Fetch in parallel: stock targets + swing analysis + signal feed (for IV rank)
      const [targetsRes, swingRes, feedRes, sectorRes] = await Promise.allSettled([
        fetchStockTargets(ticker, undefined, swingSettings.fibLookback),
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

      // ── 9 EMA + Fibonacci + confluence (additive pullback tooling) ───────
      const ema9        = targets?.ema9 ?? null
      const ema9Slope   = targets?.ema9_slope ?? null
      const priceVsEma9 = targets?.price_vs_ema9 ?? null
      const fib = buildFibData(
        targets?.fib_swing_high, targets?.fib_swing_high_date,
        targets?.fib_swing_low,  targets?.fib_swing_low_date,
        targets?.fib_direction,  close,
      )
      const confluence = detectFibMaConfluence(
        { close, ema9, ma20, ma50, fibLevels: fib?.levels ?? null },
        swingSettings.confluenceTightness,
      )

      // ── Generate scenarios ───────────────────────────────────────────────
      const scenarios = generateScenarios(
        close, vwap, ma20, ma50,
        bullScore, bearScore,
        brkLvl, riskBel, scalpTgt,
      )

      // Enhance the bull entry with the nearest support confluence zone (Part 7).
      const supportZone = confluence.find(z => z.price <= close)
      if (supportZone) {
        scenarios.bull.entry =
          `${fmt(supportZone.price)} confluence zone (${supportZone.levelsAligned.join(' + ')} align here)`
      }

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

      const analysisObj: StockAnalysis = {
        ticker, company, sector,
        close, prevClose, vwap,
        ma20, ma50, rsi,
        ivr,
        ema9, ema9Slope, priceVsEma9,
        fib, confluence,
        structure: struct,
        weeklyTrend: wkTrnd,
        macd, rs, volRatio,
        sectorEtf, bias,
        bullScore, bearScore,
        confidence: conf,
        scenarios,
        fetchedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      }
      setAnalysis(analysisObj)
      // Auto-snapshot today's entry so history accumulates without manual saves.
      saveSnapshot(todayKey(), ticker, analysisObj, newSectors)
      pruneSnapshots(SNAPSHOT_KEEP_DAYS)
    } catch (e) {
      setDataError((e instanceof Error ? e.message : null) ?? 'Data fetch failed')
    } finally {
      setLoadingData(false)
    }
  }, [myTickers])

  // Load when ticker or viewed date changes: live fetch for today, saved
  // snapshot for past dates (so the EOD entry isn't overwritten by live data).
  useEffect(() => {
    if (!selected) { setAnalysis(null); setSectors([]); return }
    if (viewDate === todayKey()) {
      loadTickerData(selected)
    } else {
      const snap = loadSnapshot(viewDate, selected)
      if (snap) {
        setAnalysis(snap.analysis)
        setSectors(snap.sectors)
        setDataError(null)
      } else {
        setAnalysis(null)
        setSectors([])
        setDataError(`No saved entry for ${selected} on this date. Entries are kept for the last ${SNAPSHOT_KEEP_DAYS} days.`)
      }
      setLoadingData(false)
    }
  }, [selected, viewDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notes + checklist are per-date; reload them when the viewed date changes.
  useEffect(() => {
    setCheckState(loadChecks(viewDate))
    setNotes(loadNotes(viewDate))
  }, [viewDate])

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
      saveChecks(viewDate, next)
      return next
    })
  }

  const toggleSection = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const updateNote = (ticker: string, key: keyof StockNotes, val: string) => {
    setNotes(prev => {
      const next = { ...prev, [ticker]: { ...(prev[ticker] ?? { observations: '', mistakes: '', gamePlan: '' }), [key]: val } }
      saveNotes(viewDate, next)
      return next
    })
  }

  const handleSaveNotes = () => {
    saveNotes(viewDate, notes)
    setSaveFeedback('Saved ✓')
    setTimeout(() => setSaveFeedback(null), 2000)
  }

  // Explicitly snapshot today's entry (analysis + notes) so it can be reviewed later.
  const handleSaveEntry = () => {
    if (!analysis) return
    saveSnapshot(todayKey(), analysis.ticker, analysis, sectors)
    saveNotes(todayKey(), notes)
    pruneSnapshots(SNAPSHOT_KEEP_DAYS)
    setEntrySaved('Saved ✓')
    setTimeout(() => setEntrySaved(null), 2000)
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

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { setIsMobile(e.matches); if (e.matches) setSidebarOpen(false) }
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void)
    handler(mq)
    return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void)
  }, [])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const isToday = viewDate === todayKey()
  const doneChecks = Object.values(checkState).filter(Boolean).length
  const checkPct   = Math.round((doneChecks / EOD_CHECKS.length) * 100)

  const chgAbs = analysis ? analysis.close - analysis.prevClose : 0
  const chgPct = analysis && analysis.prevClose > 0 ? (chgAbs / analysis.prevClose) * 100 : 0
  const isUp   = chgAbs >= 0

  // ── 9 EMA display: color + sub (Part 1) ──
  // Above + rising = green (strong); above + flat = yellow (slowing); below = red (early warning)
  const ema9Color = analysis?.ema9 == null ? '#8b949e'
    : analysis.priceVsEma9 === 'below' ? '#f85149'
    : analysis.ema9Slope === 'up' ? '#3fb950'
    : '#d29922'
  const ema9Sub = analysis?.ema9 == null ? 'Not available'
    : analysis.priceVsEma9 === 'below' ? 'Below — early warning'
    : analysis.ema9Slope === 'up' ? 'Above — strong momentum'
    : analysis.ema9Slope === 'down' ? 'Above — momentum fading'
    : 'Above — momentum slowing'

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

  const baseConf = analysis?.confidence ?? 50
  // Part 12: nudge the displayed confidence by the current fib zone (scenario logic unchanged).
  const fibAdjust = analysis?.fib ? FIB_ZONE_META[analysis.fib.currentZone].probAdjust : 0
  const conf = Math.max(0, Math.min(100, baseConf + fibAdjust))

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

  const panelColors: PanelColors = { isDark, cardBg, cardBg2, bdr, tx, txMuted }
  const gc = (cols: string, mobileCols = '1fr') => ({ gridTemplateColumns: isMobile ? mobileCols : cols })

  const iStyle: React.CSSProperties = {
    background: isDark ? '#0d1117' : '#f6f8fa',
    border: `1px solid ${bdr}`,
    borderRadius: 6, color: tx, fontSize: 12, padding: '6px 9px',
    fontFamily: 'inherit', width: '100%',
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
    <style>{`
      @media (max-width: 768px) {
        .eod-journal-stat-grid { grid-template-columns: repeat(2,1fr) !important; }
        .eod-journal-scenarios-grid { grid-template-columns: 1fr !important; }
        .eod-journal-two-col { grid-template-columns: 1fr !important; }
        .eod-journal-sector-grid { grid-template-columns: repeat(2,1fr) !important; }
        .eod-journal-three-col { grid-template-columns: 1fr !important; }
        .eod-journal-fib-grid { grid-template-columns: 1fr !important; }
      }
      @media (max-width: 480px) {
        .eod-journal-stat-grid { grid-template-columns: 1fr !important; }
        .eod-journal-sector-grid { grid-template-columns: 1fr !important; }
      }
      .sidebar-toggle { display: none; }
      @media (max-width: 768px) { .sidebar-toggle { display: inline-flex !important; } }
    `}</style>
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: pageBg }}>

      {/* Header */}
      <div style={{ background: sideBg, borderBottom: `1px solid ${bdr}`, padding: '13px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar" style={{ display: 'none', padding: '4px 8px', borderRadius: 5, border: `1px solid ${bdr}`, background: cardBg2, color: tx, cursor: 'pointer', fontSize: 16, lineHeight: 1 }} className="sidebar-toggle">☰</button>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: tx, letterSpacing: '-0.3px' }}>Swing EOD Journal · Next Day Prep</div>
            <div style={{ fontSize: 11, color: txMuted, marginTop: 1 }}>End-of-session analysis → Tomorrow's game plan</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Date history selector — last few days of saved entries */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 6, padding: 3 }}>
            <Calendar size={12} style={{ color: txMuted, margin: '0 3px' }} />
            {recentDateKeys(SNAPSHOT_KEEP_DAYS).map(dk => {
              const active = dk === viewDate
              const label = dk === todayKey() ? 'Today' : new Date(dk + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              return (
                <button key={dk} onClick={() => setViewDate(dk)} title={dk} style={{
                  padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: active ? '#1f6feb' : 'transparent', color: active ? '#fff' : txMuted,
                }}>{label}</button>
              )
            })}
          </div>
          {!isToday && analysis && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 5, border: `1px solid ${bdr}`, color: isDark ? '#d29922' : '#9a6700', background: eodNeutBg(isDark) }}>
              Saved entry{analysis.fetchedAt ? ` · ${analysis.fetchedAt}` : ''}
            </span>
          )}
          {isToday && analysis && (
            <button onClick={() => loadTickerData(analysis.ticker)} disabled={loadingData} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${bdr}`, background: cardBg2, color: txMuted, display: 'flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={12} className={loadingData ? 'animate-spin' : ''} />
              {loadingData ? 'Fetching…' : 'Refresh'}
            </button>
          )}
          {isToday && (
            <button onClick={handleSaveEntry} disabled={!analysis} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: analysis ? 'pointer' : 'default', border: 'none', background: isDark ? (entrySaved ? '#1a4a1f' : '#21a047') : (entrySaved ? '#3d7a0f' : '#21a047'), color: isDark ? (entrySaved ? '#3fb950' : '#000') : '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Save size={12} /> {entrySaved ?? 'Save Entry'}
            </button>
          )}
          <button onClick={handleExport} disabled={!analysis} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: analysis ? 'pointer' : 'default', border: `1px solid ${isDark ? '#1a3050' : '#58a6ff'}`, background: isDark ? '#0d1a28' : '#e8f0fe', color: analysis ? '#58a6ff' : '#8b949e', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', flex: 1 }}>

        {/* ── Sidebar ── */}
        {(isMobile ? sidebarOpen : true) && (
        <div style={{ background: sideBg, borderRight: `1px solid ${bdr}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: isMobile ? 'none' : 'calc(100vh - 57px)', position: isMobile ? 'static' : 'sticky', top: 57 }}>

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
                <div key={i} onClick={() => toggleCheck(i)} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '5px 7px', background: checkState[i] ? eodBullBg(isDark) : cardBg, border: `1px solid ${checkState[i] ? (isDark ? '#1a4a1f' : '#3d7a0f') : bdr}`, borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {checkState[i] ? <CheckSquare size={13} style={{ color: '#3fb950', flexShrink: 0, marginTop: 1 }} /> : <Square size={13} style={{ color: '#30363d', flexShrink: 0, marginTop: 1 }} />}
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: checkState[i] ? eodTxFaint(isDark) : tx, textDecoration: checkState[i] ? 'line-through' : 'none', lineHeight: 1.4, display: 'block' }}>{c}</span>
                    {EOD_CHECK_NOTES[i] && (
                      <span style={{ fontSize: 10, color: txMuted, lineHeight: 1.4, display: 'block', marginTop: 2 }}>{EOD_CHECK_NOTES[i]}</span>
                    )}
                  </span>
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
        )}

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
                      {analysis.bias === 'bull' && <Pill color={isDark ? '#3fb950' : '#15803d'} bg={eodBullBg(isDark)} border={isDark ? '#1a4a1f' : '#3d7a0f'}>↑ BULL BIAS</Pill>}
                      {analysis.bias === 'bear' && <Pill color={isDark ? '#f85149' : '#b91c1c'} bg={eodBearBg(isDark)} border={isDark ? '#5a1a1a' : '#b91c1c'}>↓ BEAR BIAS</Pill>}
                      {analysis.bias === 'neutral' && <Pill color={isDark ? '#d29922' : '#9a6700'} bg={eodNeutBg(isDark)} border={isDark ? '#4a3800' : '#e0b050'}>→ NEUTRAL</Pill>}
                      {/* Structure */}
                      <Pill color="#58a6ff" bg="#0d1a28" border="#1a3050">{analysis.structure}</Pill>
                      {/* IVR */}
                      {analysis.ivr != null && (
                        <>
                          <Pill color={isDark ? '#bc8cff' : '#7c3aed'} bg={isDark ? '#140d20' : '#f3eafe'} border={isDark ? '#3a1a5a' : '#c4a0f0'}>IVR {analysis.ivr.toFixed(0)}</Pill>
                          <Pill
                            color={analysis.ivr < 35 ? (isDark ? '#3fb950' : '#15803d') : analysis.ivr < 60 ? (isDark ? '#d29922' : '#9a6700') : (isDark ? '#f85149' : '#b91c1c')}
                            bg={analysis.ivr < 35 ? eodBullBg(isDark) : analysis.ivr < 60 ? eodNeutBg(isDark) : eodBearBg(isDark)}
                            border={analysis.ivr < 35 ? (isDark ? '#1a4a1f' : '#3d7a0f') : analysis.ivr < 60 ? (isDark ? '#4a3800' : '#e0b050') : (isDark ? '#5a1a1a' : '#b91c1c')}
                          >
                            {analysis.ivr < 35 ? 'BUY OPTIONS' : analysis.ivr < 60 ? 'USE SPREADS' : 'SELL PREMIUM'}
                          </Pill>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: isUp ? (isDark ? '#3fb950' : '#15803d') : (isDark ? '#f85149' : '#b91c1c'), fontFamily: 'monospace' }}>{fmt(analysis.close)}</div>
                    <div style={{ fontSize: 12, color: isUp ? (isDark ? '#3fb950' : '#15803d') : (isDark ? '#f85149' : '#b91c1c'), marginTop: 2 }}>
                      {isUp ? '+' : ''}{fmt(Math.abs(chgAbs))} ({isUp ? '+' : ''}{chgPct.toFixed(2)}%) today
                    </div>
                    <div style={{ marginTop: 5, display: 'flex', justifyContent: 'flex-end' }}>
                      <Pill
                        color={analysis.rs.includes('strong') ? (isDark ? '#3fb950' : '#15803d') : analysis.rs.includes('weak') ? (isDark ? '#f85149' : '#b91c1c') : (isDark ? '#d29922' : '#9a6700')}
                        bg={analysis.rs.includes('strong') ? eodBullBg(isDark) : analysis.rs.includes('weak') ? eodBearBg(isDark) : eodNeutBg(isDark)}
                        border={analysis.rs.includes('strong') ? (isDark ? '#1a4a1f' : '#3d7a0f') : analysis.rs.includes('weak') ? (isDark ? '#5a1a1a' : '#b91c1c') : (isDark ? '#4a3800' : '#e0b050')}
                      >
                        RS: {analysis.rs}
                      </Pill>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 10, color: txMuted }}>fetched {analysis.fetchedAt}</div>
                  </div>
                </div>

                {/* Stat boxes */}
                <div className="eod-journal-stat-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${showEma9 && analysis.ema9 != null ? 6 : 5}, 1fr)`, gap: 8, marginBottom: 10 }}>
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
                  {showEma9 && analysis.ema9 != null && (
                    <StatBox
                      label="9 EMA"
                      value={fmt(analysis.ema9)}
                      sub={ema9Sub}
                      color={ema9Color}
                      tooltip={EMA9_TOOLTIP}
                    />
                  )}
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
                    <div className="eod-journal-scenarios-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <ScenarioCard type="bull" data={analysis.scenarios.bull} ticker={analysis.ticker} panelColors={panelColors} />
                      <ScenarioCard type="bear" data={analysis.scenarios.bear} ticker={analysis.ticker} panelColors={panelColors} />
                    </div>

                    {/* Neutral strip */}
                    <div style={{ background: eodNeutBg(isDark), border: `1px solid ${isDark ? '#4a3800' : '#e0b050'}`, borderRadius: 10, padding: '12px 16px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#d29922' : '#9a6700', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          → NEUTRAL / CHOP — No Clear Direction
                          <span style={{ marginLeft: 'auto', padding: '1px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: isDark ? '#d29922' : '#9a6700', border: `1px solid ${isDark ? '#4a3800' : '#e0b050'}`, background: eodOverlay3(isDark) }}>{analysis.scenarios.neutral.probability}% prob</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${eodDivider(isDark)}`, fontSize: 12 }}>
                          <span style={{ color: eodTxMuted(isDark) }}>Trigger</span>
                          <span style={{ fontWeight: 700, color: isDark ? '#d29922' : '#9a6700', textAlign: 'right', maxWidth: '65%' }}>{analysis.scenarios.neutral.trigger}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                          <span style={{ color: eodTxMuted(isDark) }}>Action</span>
                          <span style={{ fontWeight: 700, color: eodTxStrong(isDark) }}>{analysis.scenarios.neutral.entry}</span>
                        </div>
                      </div>
                      <div style={{ background: eodOverlay(isDark), borderRadius: 6, padding: '9px 11px', fontSize: 11, color: eodTxMuted(isDark), lineHeight: 1.7 }}>
                        <strong style={{ color: eodTxStrong(isDark), display: 'block', marginBottom: 3 }}>Honest Rule:</strong>
                        If market opens flat and your stock chops between two obvious levels — <span style={{ color: isDark ? '#f85149' : '#b91c1c', fontWeight: 600 }}>no trade is a trade.</span> Flat = +$0. Forced trades = -$.
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
                  <div className="eod-journal-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

              {/* ── Fibonacci & Confluence (additive pullback tooling) ── */}
              <div>
                <SectionHeader id="fib" title="Fibonacci & Confluence" sub="Pullback zones + where levels align" collapsed={!!collapsed['fib']} onToggle={toggleSection} />
                {!collapsed['fib'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {analysis.fib
                      ? <FibPanel fib={analysis.fib} price={analysis.close} colors={panelColors} />
                      : <div style={{ background: cardBg, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: txMuted }}>Swing high/low not available for fib calculation.</div>
                    }
                    <ConfluencePanel zones={analysis.confluence} price={analysis.close} colors={panelColors} />
                    {/* First-time example */}
                    <div>
                      <SectionHeader id="fibExample" title="Example" sub="ARM — how to read this" collapsed={!!collapsed['fibExample']} onToggle={toggleSection} />
                      {!collapsed['fibExample'] && <ArmExamplePanel colors={panelColors} />}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sector Context ── */}
              <div>
                <SectionHeader id="sector" title="Sector Context" sub="Does the sector support the trade?" collapsed={!!collapsed['sector']} onToggle={toggleSection} />
                {!collapsed['sector'] && sectors.length > 0 && (
                  <>
                    <div className="eod-journal-sector-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
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
                      <div style={{ marginTop: 12, borderRadius: 8, padding: '10px 14px', fontSize: 12, borderLeft: `3px solid ${sectorAligned ? '#3fb950' : '#f85149'}`, background: sectorAligned ? eodBullBg(isDark) : eodBearBg(isDark), color: sectorAligned ? (isDark ? '#7ee787' : '#15803d') : (isDark ? '#ffa29e' : '#b91c1c'), lineHeight: 1.7 }}>
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
                    <div className="eod-journal-three-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
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
                      <div style={{ background: bearPct > bullPct ? eodBearBg(isDark) : eodBullBg(isDark), border: `1px solid ${bearPct > bullPct ? (isDark ? '#5a1a1a' : '#b91c1c') : (isDark ? '#1a4a1f' : '#3d7a0f')}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: domColor }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: domColor }} />
                          Tomorrow's Perception
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: domColor, marginBottom: 6 }}>{primaryBias} BIAS</div>
                        <div style={{ fontSize: 11, color: eodTxMuted(isDark), lineHeight: 1.7 }}>
                          Primary watch: <strong style={{ color: tx }}>{domScenario?.trigger}</strong><br />
                          If triggered → enter <strong style={{ color: domColor }}>{domScenario?.entry}</strong><br />
                          Stop at <strong style={{ color: isDark ? '#f85149' : '#b91c1c' }}>{domScenario?.stop}</strong> · T1 <strong style={{ color: isDark ? '#3fb950' : '#15803d' }}>{domScenario?.t1}</strong>
                        </div>
                        <div style={{ marginTop: 8, padding: '7px 9px', background: eodOverlay(isDark), borderRadius: 5, fontSize: 11, color: eodTxFaint(isDark) }}>
                          If opposite case triggers → flip or stay flat. Never force the primary scenario.
                        </div>
                      </div>
                    </div>

                    {/* Confidence meter */}
                    <div style={{ background: cardBg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: tx }}>Setup Confidence</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          {fibAdjust !== 0 && (
                            <span title={`Adjusted ${fibAdjust > 0 ? '+' : ''}${fibAdjust}% — price in ${analysis.fib?.currentZone}% fib zone`} style={{ fontSize: 11, fontWeight: 700, color: fibAdjust > 0 ? '#3fb950' : '#f85149' }}>
                              {fibAdjust > 0 ? '+' : ''}{fibAdjust}% fib
                            </span>
                          )}
                          <span style={{ fontSize: 18, fontWeight: 800, color: conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149' }}>{conf}%</span>
                        </span>
                      </div>
                      <div style={{ height: 8, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ height: '100%', width: `${conf}%`, background: conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149', borderRadius: 4, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{ borderRadius: 7, padding: '8px 12px', fontSize: 12, borderLeft: `3px solid ${conf >= 70 ? '#3fb950' : conf >= 50 ? '#d29922' : '#f85149'}`, background: conf >= 70 ? eodBullBg(isDark) : conf >= 50 ? eodNeutBg(isDark) : eodBearBg(isDark), color: conf >= 70 ? (isDark ? '#7ee787' : '#15803d') : conf >= 50 ? (isDark ? '#f0c040' : '#9a6700') : (isDark ? '#ffa29e' : '#b91c1c'), lineHeight: 1.7 }}>
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
                  <div className="eod-journal-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                    <div className="eod-journal-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                      <button onClick={handleSaveNotes} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: isDark ? '#1a4a1f' : '#21a047', color: isDark ? '#3fb950' : '#000', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Save size={13} /> {saveFeedback ?? 'Save Notes'}
                      </button>
                      <button onClick={handleExport} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${isDark ? '#1a3050' : '#58a6ff'}`, background: isDark ? '#0d1a28' : '#e8f0fe', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 5 }}>
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
    </>
  )
}
