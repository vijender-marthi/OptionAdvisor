import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, CheckSquare, Square, TrendingUp, TrendingDown, Minus, Download, Save, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { fetchMyTickers, addMyTicker, searchTickers, type MyTickerEntry, type SearchTickerResult } from '../api/commandCenter'

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

interface StockNotes {
  observations: string
  mistakes: string
  gamePlan: string
}

interface EODStockEntry {
  ticker: string
  company: string
  sector: string
  close: string
  prevClose: string
  high: string
  low: string
  orHigh: string
  orLow: string
  vwap: string
  ma20: string
  ma50: string
  rsi: string
  macd: string
  rs: string
  volume: string
  avgVol: string
  volRatio: string
  ivr: string
  structure: string
  weeklyTrend: string
  sectorEtf: string
  bias: 'bull' | 'bear' | 'neutral'
  confidence: number
  scenarios: {
    bull: ScenarioData
    bear: ScenarioData
    neutral: NeutralScenario
  }
  notes: StockNotes
}

// ─── Static data ──────────────────────────────────────────────────────────────

const SECTORS = [
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

const STORAGE_KEY_PREFIX = 'eod_journal_'

function todayKey() {
  return new Date().toISOString().split('T')[0]
}

function blankEntry(ticker: string, company = ''): EODStockEntry {
  return {
    ticker,
    company,
    sector: '',
    close: '',
    prevClose: '',
    high: '',
    low: '',
    orHigh: '',
    orLow: '',
    vwap: '',
    ma20: '',
    ma50: '',
    rsi: '',
    macd: '',
    rs: '',
    volume: '',
    avgVol: '',
    volRatio: '',
    ivr: '',
    structure: 'HL/HH',
    weeklyTrend: 'neutral',
    sectorEtf: 'SPY',
    bias: 'neutral',
    confidence: 50,
    scenarios: {
      bull: { trigger: '', entry: '', stop: '', t1: '', t2: '', rr: '', probability: 40 },
      bear: { trigger: '', entry: '', stop: '', t1: '', t2: '', rr: '', probability: 45 },
      neutral: { trigger: '', entry: '', probability: 15 },
    },
    notes: { observations: '', mistakes: '', gamePlan: '' },
  }
}

function loadData(): Record<string, EODStockEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + todayKey())
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveData(data: Record<string, EODStockEntry>) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + todayKey(), JSON.stringify(data))
  } catch { /* quota */ }
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ isUp }: { isUp: boolean }) {
  const pts: number[] = []
  // Generate a simple simulated 20-day path
  let p = 100
  for (let i = 0; i < 20; i++) {
    p += (Math.random() - (isUp ? 0.48 : 0.52)) * 2
    pts.push(p)
  }
  pts[pts.length - 1] = isUp ? Math.max(...pts) * 0.98 : Math.min(...pts) * 1.02

  const mn = Math.min(...pts)
  const mx = Math.max(...pts)
  const W = 100, H = 40
  const sx = (i: number) => (i / (pts.length - 1)) * (W - 4) + 2
  const sy = (v: number) => H - 2 - ((v - mn) / (mx - mn + 0.001)) * (H - 6)

  const linePath = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const areaPath = linePath + ` L${sx(pts.length - 1).toFixed(1)},${H} L${sx(0).toFixed(1)},${H} Z`
  const color = isUp ? '#3fb950' : '#f85149'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56 }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={sx(pts.length - 1)} cy={sy(pts[pts.length - 1])} r="3" fill={color} />
    </svg>
  )
}

// ─── Field components ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: '10px', color: '#8b949e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#e6edf3',
  fontSize: 12,
  padding: '5px 8px',
  fontFamily: 'inherit',
  width: '100%',
  transition: 'border-color 0.15s',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 72,
  lineHeight: 1.6,
}

// ─── Scenario sub-form ────────────────────────────────────────────────────────

function ScenarioForm({
  label,
  color,
  data,
  onChange,
}: {
  label: string
  color: string
  data: ScenarioData
  onChange: (d: ScenarioData) => void
}) {
  const f = <K extends keyof ScenarioData>(k: K) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...data, [k]: k === 'probability' ? Number(e.target.value) : e.target.value })

  return (
    <div style={{ background: '#0d1117', border: `1px solid ${color}40`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Field label="Trigger">
          <input style={inputStyle} value={data.trigger} onChange={f('trigger')} placeholder="e.g. Gap above VWAP + volume" />
        </Field>
        <Field label="Entry">
          <input style={inputStyle} value={data.entry} onChange={f('entry')} placeholder="e.g. $305.50 on 1m confirmation" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
          <Field label="Stop">
            <input style={inputStyle} value={data.stop} onChange={f('stop')} placeholder="$0.00" />
          </Field>
          <Field label="Target 1">
            <input style={inputStyle} value={data.t1} onChange={f('t1')} placeholder="$0.00" />
          </Field>
          <Field label="Target 2">
            <input style={inputStyle} value={data.t2} onChange={f('t2')} placeholder="$0.00" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          <Field label="R/R">
            <input style={inputStyle} value={data.rr} onChange={f('rr')} placeholder="e.g. 2.5:1" />
          </Field>
          <Field label={`Probability (${data.probability}%)`}>
            <input
              type="range" min={0} max={100} value={data.probability}
              onChange={f('probability')}
              style={{ width: '100%', cursor: 'pointer', accentColor: color }}
            />
          </Field>
        </div>
        <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${data.probability}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>
    </div>
  )
}

function NeutralScenarioForm({
  data,
  onChange,
}: {
  data: NeutralScenario
  onChange: (d: NeutralScenario) => void
}) {
  return (
    <div style={{ background: '#1a1200', border: '1px solid #4a380040', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#d29922', marginBottom: 10 }}>→ NEUTRAL / CHOP — No Clear Direction</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 7 }}>
        <Field label="Trigger / Condition">
          <input style={inputStyle} value={data.trigger} onChange={e => onChange({ ...data, trigger: e.target.value })} placeholder="e.g. Open between levels, range-bound chop" />
        </Field>
        <Field label="Action">
          <input style={inputStyle} value={data.entry} onChange={e => onChange({ ...data, entry: e.target.value })} placeholder="Skip / Wait" />
        </Field>
        <Field label={`Probability (${data.probability}%)`}>
          <input
            type="range" min={0} max={100} value={data.probability}
            onChange={e => onChange({ ...data, probability: Number(e.target.value) })}
            style={{ width: '100%', cursor: 'pointer', marginTop: 14, accentColor: '#d29922' }}
          />
        </Field>
      </div>
    </div>
  )
}

// ─── Sector data form ─────────────────────────────────────────────────────────

interface SectorEntry { etf: string; chg: string; rs: 'strong' | 'neutral' | 'weak' | 'index'; trend: 'up' | 'sideways' | 'down' }

function SectorContextSection({ sectorEtf, bias }: { sectorEtf: string; bias: 'bull' | 'bear' | 'neutral' }) {
  const [sectors, setSectors] = useState<SectorEntry[]>(
    SECTORS.map(s => ({ etf: s.etf, chg: '', rs: 'neutral' as const, trend: 'sideways' as const }))
  )

  const update = (i: number, patch: Partial<SectorEntry>) =>
    setSectors(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  const mySector = sectors.find(s => s.etf === sectorEtf)
  const chgNum = mySector ? parseFloat(mySector.chg) || 0 : 0
  const aligned = (bias === 'bear' && mySector?.trend === 'down') || (bias === 'bull' && mySector?.trend === 'up')

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {SECTORS.map((sec, i) => {
          const s = sectors[i]
          const isRelated = sec.etf === sectorEtf || sec.etf === 'SPY'
          const chg = parseFloat(s.chg) || 0
          const pos = chg >= 0
          const barW = Math.min(100, Math.abs(chg) * 20)
          const chgColor = pos ? '#3fb950' : '#f85149'
          return (
            <div
              key={sec.etf}
              style={{
                background: '#161b22',
                border: `1px solid ${isRelated ? (pos ? '#3fb950' : '#f85149') : '#21262d'}`,
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{sec.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f0f6fc' }}>{sec.etf}</span>
                <input
                  style={{ ...inputStyle, width: 70, textAlign: 'right', padding: '2px 6px', color: chgColor }}
                  value={s.chg}
                  onChange={e => update(i, { chg: e.target.value })}
                  placeholder="+0.00%"
                />
              </div>
              <div style={{ height: 4, background: '#21262d', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${barW}%`, background: pos ? '#3fb950' : '#f85149', borderRadius: 2 }} />
              </div>
              <select
                style={{ ...inputStyle, padding: '2px 4px', fontSize: 10 }}
                value={s.rs}
                onChange={e => update(i, { rs: e.target.value as SectorEntry['rs'] })}
              >
                <option value="strong">RS: strong</option>
                <option value="neutral">RS: neutral</option>
                <option value="weak">RS: weak</option>
                <option value="index">RS: index</option>
              </select>
              <select
                style={{ ...inputStyle, padding: '2px 4px', fontSize: 10, marginTop: 4 }}
                value={s.trend}
                onChange={e => update(i, { trend: e.target.value as SectorEntry['trend'] })}
              >
                <option value="up">↑ Trending up</option>
                <option value="sideways">→ Sideways</option>
                <option value="down">↓ Trending down</option>
              </select>
              {isRelated && sec.etf !== 'SPY' && (
                <div style={{ fontSize: 10, color: '#58a6ff', marginTop: 4, fontWeight: 600 }}>← YOUR SECTOR</div>
              )}
            </div>
          )
        })}
      </div>
      {mySector && (
        <div style={{
          marginTop: 12,
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12,
          borderLeft: `3px solid ${aligned ? '#3fb950' : '#f85149'}`,
          background: aligned ? '#0d2011' : '#200d0d',
          color: aligned ? '#7ee787' : '#ffa29e',
          lineHeight: 1.7,
        }}>
          <strong>{aligned ? '✓ Sector Aligned:' : '⚠ Sector Conflict:'}</strong>{' '}
          {aligned
            ? `Sector (${sectorEtf}) trend supports the ${bias} bias. Higher probability setup — trade full plan.`
            : `Sector (${sectorEtf}) moves opposite to the ${bias} bias. Consider smaller size or wait for alignment.`
          }
          {chgNum !== 0 && ` Sector change: ${chgNum > 0 ? '+' : ''}${chgNum.toFixed(2)}%.`}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EODJournalPage() {
  const { theme } = useApp()
  const isDark = theme === 'dark'

  // Persist isDark ref for sparkline (no re-render needed)
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [stockData, setStockData] = useState<Record<string, EODStockEntry>>(loadData)
  const [selected, setSelected] = useState<string | null>(null)
  const [checkState, setCheckState] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(EOD_CHECKS.map((_, i) => [i, false]))
  )
  const [showAddForm, setShowAddForm] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchTickerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load My Tickers
  useEffect(() => {
    fetchMyTickers().then(res => setMyTickers(res.data?.tickers ?? [])).catch(() => {})
  }, [])

  // Persist on every change to stockData
  useEffect(() => { saveData(stockData) }, [stockData])

  // Ensure selected ticker has an entry
  useEffect(() => {
    if (!selected) return
    if (!stockData[selected]) {
      const mt = myTickers.find(t => t.symbol === selected)
      setStockData(prev => ({ ...prev, [selected]: blankEntry(selected, mt?.company_name ?? '') }))
    }
  }, [selected, myTickers, stockData])

  // Live search
  useEffect(() => {
    if (!addQuery.trim()) { setSearchResults([]); return }
    if (searchRef.current) clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(() => {
      searchTickers(addQuery.trim())
        .then(res => setSearchResults(res.data?.results ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [addQuery])

  const handleAddTicker = useCallback(async (symbol: string, company: string) => {
    setAdding(true)
    try {
      const res = await addMyTicker({ symbol, trade_types: ['swing'] })
      const updated = res.data?.tickers ?? myTickers
      setMyTickers(updated)
      if (!stockData[symbol]) {
        setStockData(prev => ({ ...prev, [symbol]: blankEntry(symbol, company) }))
      }
      setSelected(symbol)
      setShowAddForm(false)
      setAddQuery('')
      setSearchResults([])
    } catch { /* ignore duplicate */ } finally { setAdding(false) }
  }, [myTickers, stockData])

  const updateEntry = useCallback(<K extends keyof EODStockEntry>(ticker: string, key: K, value: EODStockEntry[K]) => {
    setStockData(prev => {
      const entry = prev[ticker] ?? blankEntry(ticker)
      return { ...prev, [ticker]: { ...entry, [key]: value } }
    })
  }, [])

  const updateScenario = useCallback((ticker: string, type: 'bull' | 'bear', value: ScenarioData) => {
    setStockData(prev => {
      const entry = prev[ticker] ?? blankEntry(ticker)
      return { ...prev, [ticker]: { ...entry, scenarios: { ...entry.scenarios, [type]: value } } }
    })
  }, [])

  const updateNeutral = useCallback((ticker: string, value: NeutralScenario) => {
    setStockData(prev => {
      const entry = prev[ticker] ?? blankEntry(ticker)
      return { ...prev, [ticker]: { ...entry, scenarios: { ...entry.scenarios, neutral: value } } }
    })
  }, [])

  const updateNotes = useCallback((ticker: string, key: keyof StockNotes, value: string) => {
    setStockData(prev => {
      const entry = prev[ticker] ?? blankEntry(ticker)
      return { ...prev, [ticker]: { ...entry, notes: { ...entry.notes, [key]: value } } }
    })
  }, [])

  const handleSave = useCallback(() => {
    saveData(stockData)
    setSaveFeedback('Saved ✓')
    setTimeout(() => setSaveFeedback(null), 2000)
  }, [stockData])

  const handleExport = useCallback(() => {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    let txt = `=== EOD JOURNAL — NEXT DAY PREP ===\nDate: ${date}\n\n`
    Object.values(stockData).forEach(s => {
      const chg = parseFloat(s.close) - parseFloat(s.prevClose)
      txt += `──────────────────────\n`
      txt += `${s.ticker} — $${s.close} (${!isNaN(chg) ? (chg >= 0 ? '+' : '') + chg.toFixed(2) : 'n/a'})\n`
      txt += `Structure: ${s.structure} | Bias: ${s.bias.toUpperCase()} | Confidence: ${s.confidence}%\n`
      txt += `VWAP: $${s.vwap} | MA20: $${s.ma20} | RSI: ${s.rsi} | IVR: ${s.ivr}\n\n`
      txt += `BULL CASE (${s.scenarios.bull.probability}%): ${s.scenarios.bull.trigger}\n`
      txt += `  Entry: ${s.scenarios.bull.entry} | Stop: ${s.scenarios.bull.stop} | T1: ${s.scenarios.bull.t1}\n\n`
      txt += `BEAR CASE (${s.scenarios.bear.probability}%): ${s.scenarios.bear.trigger}\n`
      txt += `  Entry: ${s.scenarios.bear.entry} | Stop: ${s.scenarios.bear.stop} | T1: ${s.scenarios.bear.t1}\n\n`
      if (s.notes.observations) txt += `OBSERVATIONS: ${s.notes.observations}\n`
      if (s.notes.mistakes) txt += `LESSON: ${s.notes.mistakes}\n`
      if (s.notes.gamePlan) txt += `GAME PLAN: ${s.notes.gamePlan}\n`
      txt += '\n'
    })
    const blob = new Blob([txt], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `eod_journal_${todayKey()}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [stockData])

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const doneChecks = Object.values(checkState).filter(Boolean).length
  const checkPct = Math.round((doneChecks / EOD_CHECKS.length) * 100)

  const entry = selected ? (stockData[selected] ?? blankEntry(selected)) : null
  const closeNum = entry ? parseFloat(entry.close) || 0 : 0
  const prevCloseNum = entry ? parseFloat(entry.prevClose) || 0 : 0
  const chgAbs = closeNum - prevCloseNum
  const chgPct = prevCloseNum > 0 ? (chgAbs / prevCloseNum) * 100 : 0
  const isUp = chgAbs >= 0

  const ivrNum = entry ? parseInt(entry.ivr) || 0 : 0
  const optionsType = ivrNum < 40
    ? (entry?.bias === 'bull' ? 'Buy ATM Call' : entry?.bias === 'bear' ? 'Buy ATM Put' : 'Buy ATM Direction')
    : ivrNum < 60
    ? (entry?.bias === 'bull' ? 'Debit Call Spread' : entry?.bias === 'bear' ? 'Debit Put Spread' : 'Debit Spread')
    : (entry?.bias === 'bull' ? 'Bull Put Spread' : entry?.bias === 'bear' ? 'Bear Call Spread' : 'Credit Spread')
  const optionsDTE = ivrNum < 40 ? '10–14 DTE' : ivrNum < 60 ? '14 DTE (spreads)' : '14–21 DTE (spreads)'
  const optionsWhy = ivrNum < 40
    ? 'IVR is low — options cheap. Buy direct. IV expansion benefits you.'
    : ivrNum < 60
    ? 'IVR mid-range. Use spreads to cap vega risk. Still directional.'
    : 'IVR elevated. Avoid buying premium. Sell premium or use spreads.'

  const bullPct = entry?.scenarios.bull.probability ?? 40
  const bearPct = entry?.scenarios.bear.probability ?? 45
  const primaryBias = bearPct > bullPct ? 'SHORT' : 'LONG'
  const domScenario = bearPct > bullPct ? entry?.scenarios.bear : entry?.scenarios.bull
  const domColor = bearPct > bullPct ? '#f85149' : '#3fb950'

  const bg = isDark ? '#0d1117' : '#f6f8fa'
  const cardBg = isDark ? '#161b22' : '#ffffff'
  const borderColor = isDark ? '#21262d' : '#d0d7de'
  const textPrimary = isDark ? '#f0f6fc' : '#1f2328'
  const textMuted = isDark ? '#8b949e' : '#57606a'

  // ─── Section header helper ────────────────────────────────────────────────

  function SectionHeader({ id, title, sub }: { id: string; title: string; sub?: string }) {
    const collapsed = collapsedSections[id]
    return (
      <button
        onClick={() => toggleSection(id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed ? 0 : 14,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: textPrimary }}>{title}</span>
        {sub && <span style={{ fontSize: 11, color: textMuted }}>{sub}</span>}
        <span style={{ marginLeft: 'auto', color: textMuted }}>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        background: isDark ? '#0d1117' : '#ffffff',
        borderBottom: `1px solid ${borderColor}`,
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: textPrimary, letterSpacing: '-0.3px' }}>EOD Journal · Next Day Prep</div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 1 }}>End-of-session analysis → Tomorrow's game plan</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: isDark ? '#1c2330' : '#f0f6ff', border: `1px solid ${borderColor}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: textMuted }}>
            {today}
          </div>
          <button
            onClick={handleSave}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: saveFeedback ? '#1a4a1f' : '#21a047', color: saveFeedback ? '#3fb950' : '#000', transition: 'all 0.2s' }}
          >
            <Save size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
            {saveFeedback ?? 'Save'}
          </button>
          <button
            onClick={handleExport}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid #1a3050', background: '#0d1a28', color: '#58a6ff' }}
          >
            <Download size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
            Export
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, minHeight: 0 }}>

        {/* ── Sidebar ── */}
        <div style={{
          background: isDark ? '#0d1117' : '#ffffff',
          borderRight: `1px solid ${borderColor}`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
        }}>

          {/* Watchlist */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: textMuted, marginBottom: 8 }}>Watchlist</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {myTickers.map(t => {
                const e = stockData[t.symbol]
                const bias = e?.bias ?? 'neutral'
                const close = e ? parseFloat(e.close) || t.last_price || null : t.last_price || null
                const prev = e ? parseFloat(e.prevClose) || null : null
                const chg = (close && prev) ? close - prev : null
                const pct = (chg && prev) ? (chg / prev) * 100 : null
                const pos = (chg ?? 0) >= 0
                const biasColor = bias === 'bull' ? '#3fb950' : bias === 'bear' ? '#f85149' : '#d29922'
                const isActive = selected === t.symbol
                return (
                  <div
                    key={t.symbol}
                    onClick={() => setSelected(t.symbol)}
                    style={{
                      background: isActive ? (isDark ? '#0d1a28' : '#e8f0fe') : cardBg,
                      border: `1px solid ${isActive ? '#58a6ff' : borderColor}`,
                      borderRadius: 8,
                      padding: '9px 11px',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: '50%', background: biasColor }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary, fontFamily: 'monospace' }}>{t.symbol}</span>
                      {close && <span style={{ fontSize: 12, fontWeight: 600, color: pos ? '#3fb950' : '#f85149', fontFamily: 'monospace' }}>${close.toFixed(2)}</span>}
                    </div>
                    {chg !== null && pct !== null && (
                      <div style={{ fontSize: 11, color: pos ? '#3fb950' : '#f85149', marginTop: 1 }}>
                        {pos ? '+' : ''}{chg.toFixed(2)} ({pos ? '+' : ''}{pct.toFixed(2)}%)
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: textMuted, marginTop: 3, fontWeight: 600, letterSpacing: '0.03em' }}>
                      {e?.structure || '—'} · {e?.weeklyTrend || 'unknown'}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add stock button / form */}
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  marginTop: 8,
                  width: '100%',
                  background: isDark ? '#1c2330' : '#f6f8fa',
                  border: `1px dashed ${borderColor}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: textMuted,
                  fontSize: 12,
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >
                <Plus size={13} /> Add Stock
              </button>
            ) : (
              <div style={{ marginTop: 8, background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: textMuted }}>Add to My Tickers</span>
                  <button onClick={() => { setShowAddForm(false); setAddQuery(''); setSearchResults([]) }} style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 2 }}><X size={13} /></button>
                </div>
                <input
                  autoFocus
                  style={{ ...inputStyle, background: isDark ? '#161b22' : '#f6f8fa' }}
                  value={addQuery}
                  onChange={e => setAddQuery(e.target.value)}
                  placeholder="Search ticker or name…"
                />
                {searching && <div style={{ fontSize: 11, color: textMuted, marginTop: 5 }}>Searching…</div>}
                {searchResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
                    {searchResults.slice(0, 5).map(r => (
                      <button
                        key={r.symbol}
                        onClick={() => handleAddTicker(r.symbol, r.company)}
                        disabled={adding}
                        style={{
                          background: isDark ? '#161b22' : '#f0f6ff',
                          border: `1px solid ${borderColor}`,
                          borderRadius: 5,
                          padding: '5px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 11,
                          color: textPrimary,
                        }}
                      >
                        <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{r.symbol}</span>
                        <span style={{ color: textMuted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: borderColor }} />

          {/* Market Pulse */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: textMuted, marginBottom: 8 }}>Market Pulse</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(['SPY', 'QQQ', 'VIX'] as const).map(sym => {
                const mt = myTickers.find(t => t.symbol === sym)
                const chg = mt?.price_change_pct
                const pos = (chg ?? 0) >= 0
                return (
                  <div key={sym} style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 7, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: textPrimary, fontFamily: 'monospace', fontSize: 12 }}>{sym}</span>
                      {chg != null
                        ? <span style={{ fontWeight: 700, color: pos ? '#3fb950' : '#f85149', fontSize: 12 }}>{pos ? '+' : ''}{chg.toFixed(2)}%</span>
                        : <span style={{ fontSize: 11, color: textMuted }}>—</span>
                      }
                    </div>
                    {mt?.last_price && (
                      <div style={{ fontSize: 11, color: textMuted, marginTop: 1 }}>${mt.last_price.toFixed(2)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: borderColor }} />

          {/* EOD Checklist */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: textMuted, marginBottom: 8 }}>EOD Checklist</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {EOD_CHECKS.map((c, i) => (
                <div
                  key={i}
                  onClick={() => setCheckState(prev => ({ ...prev, [i]: !prev[i] }))}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '6px 8px',
                    background: checkState[i] ? '#0d2011' : cardBg,
                    border: `1px solid ${checkState[i] ? '#1a4a1f' : borderColor}`,
                    borderRadius: 5,
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  {checkState[i]
                    ? <CheckSquare size={14} style={{ color: '#3fb950', flexShrink: 0, marginTop: 1 }} />
                    : <Square size={14} style={{ color: '#30363d', flexShrink: 0, marginTop: 1 }} />
                  }
                  <span style={{ fontSize: 11, color: checkState[i] ? '#6e7681' : textPrimary, textDecoration: checkState[i] ? 'line-through' : 'none', flex: 1, lineHeight: 1.4 }}>{c}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: textMuted, marginBottom: 4 }}>
                <span>Prep progress</span>
                <span style={{ color: checkPct === 100 ? '#3fb950' : '#d29922', fontWeight: 700 }}>{doneChecks}/{EOD_CHECKS.length}</span>
              </div>
              <div style={{ height: 4, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${checkPct}%`, background: checkPct === 100 ? '#3fb950' : '#d29922', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: textMuted, gap: 12 }}>
              <div style={{ fontSize: 40 }}>📓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: textPrimary }}>Select a ticker to begin</div>
              <div style={{ fontSize: 13 }}>Choose a stock from your watchlist or add one using "+ Add Stock"</div>
            </div>
          )}

          {selected && entry && (
            <>
              {/* ── Stock Hero ── */}
              <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: textPrimary, letterSpacing: '-1px', fontFamily: 'monospace' }}>{entry.ticker}</div>
                    <div style={{ fontSize: 12, color: textMuted, marginTop: 1 }}>
                      <input
                        style={{ ...inputStyle, display: 'inline', width: 220, padding: '2px 6px', background: isDark ? '#161b22' : '#f6f8fa' }}
                        value={entry.company}
                        onChange={e => updateEntry(selected, 'company', e.target.value)}
                        placeholder="Company name · Sector"
                      />
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Bias pill */}
                      {(['bull', 'bear', 'neutral'] as const).map(b => (
                        <button
                          key={b}
                          onClick={() => updateEntry(selected, 'bias', b)}
                          style={{
                            padding: '2px 10px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: `1px solid ${b === 'bull' ? '#1a4a1f' : b === 'bear' ? '#5a1a1a' : '#4a3800'}`,
                            background: entry.bias === b ? (b === 'bull' ? '#0d2011' : b === 'bear' ? '#200d0d' : '#1a1200') : 'transparent',
                            color: entry.bias === b ? (b === 'bull' ? '#3fb950' : b === 'bear' ? '#f85149' : '#d29922') : textMuted,
                            opacity: entry.bias === b ? 1 : 0.5,
                          }}
                        >
                          {b === 'bull' ? '↑ BULL' : b === 'bear' ? '↓ BEAR' : '→ NEUTRAL'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {closeNum > 0 && (
                      <>
                        <div style={{ fontSize: 24, fontWeight: 700, color: isUp ? '#3fb950' : '#f85149', fontFamily: 'monospace' }}>${closeNum.toFixed(2)}</div>
                        <div style={{ fontSize: 12, color: isUp ? '#3fb950' : '#f85149', marginTop: 2 }}>
                          {isUp ? '+' : ''}{chgAbs.toFixed(2)} ({isUp ? '+' : ''}{chgPct.toFixed(2)}%) today
                        </div>
                      </>
                    )}
                    <div style={{ marginTop: 4, display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: textMuted }}>IVR</span>
                      <input
                        style={{ ...inputStyle, width: 60, padding: '2px 6px', textAlign: 'center', background: isDark ? '#161b22' : '#f6f8fa' }}
                        value={entry.ivr}
                        onChange={e => updateEntry(selected, 'ivr', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'Close', field: 'close' as const, sub: 'Today\'s close' },
                    { label: 'VWAP', field: 'vwap' as const, sub: 'Key intraday ref' },
                    { label: 'MA20', field: 'ma20' as const, sub: 'Short-term MA' },
                    { label: 'MA50', field: 'ma50' as const, sub: 'Mid-term MA' },
                    { label: 'Prev Close', field: 'prevClose' as const, sub: 'Yesterday\'s close' },
                  ].map(({ label, field, sub }) => {
                    const val = parseFloat(entry[field]) || null
                    const refColor = val && closeNum
                      ? (field === 'close' ? '#58a6ff' : val > closeNum ? '#f85149' : '#3fb950')
                      : textPrimary
                    return (
                      <div key={field} style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 7, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, color: textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
                        <input
                          style={{ ...inputStyle, padding: '2px 4px', color: refColor, fontWeight: 700, background: 'transparent', border: 'none', fontSize: 13 }}
                          value={entry[field]}
                          onChange={e => updateEntry(selected, field, e.target.value)}
                          placeholder="$0.00"
                        />
                        <div style={{ fontSize: 10, color: textMuted, marginTop: 2 }}>{sub}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Extra stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'RSI (Daily)', field: 'rsi' as const, placeholder: '50' },
                    { label: 'OR High', field: 'orHigh' as const, placeholder: '$0.00' },
                    { label: 'OR Low', field: 'orLow' as const, placeholder: '$0.00' },
                    { label: 'Day High/Low', field: 'high' as const, placeholder: '$H / $L' },
                  ].map(({ label, field, placeholder }) => {
                    const rsiNum = field === 'rsi' ? parseInt(entry.rsi) || null : null
                    const rsiColor = rsiNum ? (rsiNum < 35 ? '#f85149' : rsiNum > 65 ? '#d29922' : '#3fb950') : textPrimary
                    return (
                      <div key={field} style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 7, padding: '7px 9px' }}>
                        <div style={{ fontSize: 10, color: textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
                        <input
                          style={{ ...inputStyle, padding: '2px 4px', color: field === 'rsi' ? rsiColor : textPrimary, fontWeight: 700, background: 'transparent', border: 'none', fontSize: 13 }}
                          value={entry[field]}
                          onChange={e => updateEntry(selected, field, e.target.value)}
                          placeholder={placeholder}
                        />
                      </div>
                    )
                  })}
                </div>

                {/* Sparkline */}
                <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', borderRadius: 6, overflow: 'hidden' }}>
                  <Sparkline isUp={isUp} />
                </div>
              </div>

              {/* ── Tomorrow's Scenarios ── */}
              <div>
                <SectionHeader id="scenarios" title="Tomorrow's Scenarios" sub="3 cases — define before open" />
                {!collapsedSections['scenarios'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <ScenarioForm
                        label="▲ BULL CASE — Gap Up / HL/HH"
                        color="#3fb950"
                        data={entry.scenarios.bull}
                        onChange={v => updateScenario(selected, 'bull', v)}
                      />
                      <ScenarioForm
                        label="▼ BEAR CASE — Gap Down / LL/LH"
                        color="#f85149"
                        data={entry.scenarios.bear}
                        onChange={v => updateScenario(selected, 'bear', v)}
                      />
                    </div>
                    <NeutralScenarioForm
                      data={entry.scenarios.neutral}
                      onChange={v => updateNeutral(selected, v)}
                    />
                    <div style={{ padding: '10px 14px', background: isDark ? '#1a0e00' : '#fff8f0', border: '1px solid #5a2a00', borderRadius: 7, fontSize: 12, color: '#ffa657', lineHeight: 1.7 }}>
                      <strong>Honest Rule:</strong> Probabilities must add to ~100%. If you can't write a clean trigger — you don't have a trade. No trigger = No entry = Capital preserved.
                    </div>
                  </div>
                )}
              </div>

              {/* ── Structure & Context ── */}
              <div>
                <SectionHeader id="structure" title="Structure & Context" sub="What today tells you about tomorrow" />
                {!collapsedSections['structure'] && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Today's Story */}
                    <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#58a6ff', flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: textMuted }}>Today's Story</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <Field label="Structure">
                            <select style={inputStyle} value={entry.structure} onChange={e => updateEntry(selected, 'structure', e.target.value)}>
                              {['HL/HH', 'LL/LH', 'HH/LL (reversal)', 'Ranging', 'Breakout', 'Breakdown'].map(v => <option key={v}>{v}</option>)}
                            </select>
                          </Field>
                          <Field label="Weekly Trend">
                            <select style={inputStyle} value={entry.weeklyTrend} onChange={e => updateEntry(selected, 'weeklyTrend', e.target.value)}>
                              {['bullish', 'neutral-bullish', 'neutral', 'neutral-bearish', 'bearish'].map(v => <option key={v}>{v}</option>)}
                            </select>
                          </Field>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <Field label="MACD Signal">
                            <select style={inputStyle} value={entry.macd} onChange={e => updateEntry(selected, 'macd', e.target.value)}>
                              {['bullish crossover', 'bullish histogram', 'neutral', 'bearish histogram', 'bearish crossover'].map(v => <option key={v}>{v}</option>)}
                            </select>
                          </Field>
                          <Field label="RS vs Sector">
                            <select style={inputStyle} value={entry.rs} onChange={e => updateEntry(selected, 'rs', e.target.value)}>
                              {['strong', 'neutral', 'weak', 'unknown'].map(v => <option key={v}>{v}</option>)}
                            </select>
                          </Field>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <Field label="Volume">
                            <input style={inputStyle} value={entry.volume} onChange={e => updateEntry(selected, 'volume', e.target.value)} placeholder="e.g. 2.1M" />
                          </Field>
                          <Field label="Avg Volume">
                            <input style={inputStyle} value={entry.avgVol} onChange={e => updateEntry(selected, 'avgVol', e.target.value)} placeholder="e.g. 1.4M" />
                          </Field>
                        </div>
                        {/* Derived signals */}
                        {(entry.close && entry.vwap) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                            {[
                              {
                                key: 'Close vs VWAP',
                                val: parseFloat(entry.close) < parseFloat(entry.vwap) ? 'Below VWAP ↓' : 'Above VWAP ↑',
                                col: parseFloat(entry.close) < parseFloat(entry.vwap) ? '#f85149' : '#3fb950',
                              },
                              {
                                key: 'Close vs MA20',
                                val: entry.ma20 ? (parseFloat(entry.close) < parseFloat(entry.ma20) ? 'Below MA20 ↓' : 'Above MA20 ↑') : '—',
                                col: entry.ma20 ? (parseFloat(entry.close) < parseFloat(entry.ma20) ? '#f85149' : '#3fb950') : textMuted,
                              },
                              {
                                key: 'Close vs MA50',
                                val: entry.ma50 ? (parseFloat(entry.close) < parseFloat(entry.ma50) ? 'Below MA50 ↓' : 'Above MA50 ↑') : '—',
                                col: entry.ma50 ? (parseFloat(entry.close) < parseFloat(entry.ma50) ? '#f85149' : '#3fb950') : textMuted,
                              },
                            ].map(row => (
                              <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${borderColor}`, fontSize: 12 }}>
                                <span style={{ color: textMuted }}>{row.key}</span>
                                <span style={{ fontWeight: 700, color: row.col }}>{row.val}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Key Price Levels */}
                    <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#d29922', flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: textMuted }}>Key Price Levels Tomorrow</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {[
                          { name: 'ORH (today)', field: 'orHigh' as const, note: 'Was OR high — now resistance' },
                          { name: 'VWAP (close)', field: 'vwap' as const, note: 'Overhead if below' },
                          { name: 'MA20 (daily)', field: 'ma20' as const, note: 'Short-term MA level' },
                          { name: 'MA50 (daily)', field: 'ma50' as const, note: 'Mid-term MA level' },
                          { name: 'Today\'s Close', field: 'close' as const, note: 'Tomorrow\'s reference open' },
                          { name: 'ORL (today)', field: 'orLow' as const, note: 'Key support / breakdown' },
                          { name: 'Day Low', field: 'low' as const, note: 'Stops cluster below here' },
                        ]
                          .filter(l => entry[l.field])
                          .sort((a, b) => (parseFloat(entry[b.field]) || 0) - (parseFloat(entry[a.field]) || 0))
                          .map(l => {
                            const val = parseFloat(entry[l.field]) || 0
                            const col = l.field === 'close' ? '#58a6ff' : val > closeNum ? '#f85149' : '#3fb950'
                            return (
                              <div key={l.field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${borderColor}`, fontSize: 12 }}>
                                <div>
                                  <div style={{ color: col, fontWeight: 600 }}>{l.name}</div>
                                  <div style={{ fontSize: 10, color: textMuted }}>{l.note}</div>
                                </div>
                                <div style={{ fontWeight: 700, color: col, fontFamily: 'monospace' }}>${val.toFixed(2)}</div>
                              </div>
                            )
                          })}
                        {!entry.close && <div style={{ fontSize: 12, color: textMuted, padding: '8px 0' }}>Enter price data above to see key levels</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sector Context ── */}
              <div>
                <SectionHeader id="sector" title="Sector Context" sub="Does the sector support the trade?" />
                {!collapsedSections['sector'] && (
                  <>
                    <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: textMuted }}>Stock's sector ETF:</span>
                      <select
                        style={{ ...inputStyle, width: 120, padding: '4px 8px' }}
                        value={entry.sectorEtf}
                        onChange={e => updateEntry(selected, 'sectorEtf', e.target.value)}
                      >
                        {SECTORS.map(s => <option key={s.etf} value={s.etf}>{s.etf} — {s.name}</option>)}
                      </select>
                    </div>
                    <SectorContextSection sectorEtf={entry.sectorEtf} bias={entry.bias} />
                  </>
                )}
              </div>

              {/* ── Perception Builder ── */}
              <div>
                <SectionHeader id="perception" title="Perception Builder" sub="Your mental model for tomorrow's open" />
                {!collapsedSections['perception'] && (
                  <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                      {/* Bull summary */}
                      <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3fb950' }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3fb950' }} />
                          Bull Case {bullPct}%
                        </div>
                        <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${borderColor}` }}>↑ {entry.scenarios.bull.trigger || 'No trigger set'}</li>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${borderColor}` }}>Entry: <strong style={{ color: textPrimary }}>{entry.scenarios.bull.entry || '—'}</strong></li>
                          <li style={{ padding: '3px 0' }}>Target: <span style={{ color: '#3fb950', fontWeight: 700 }}>{entry.scenarios.bull.t1 || '—'} → {entry.scenarios.bull.t2 || '—'}</span></li>
                        </ul>
                      </div>
                      {/* Bear summary */}
                      <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f85149' }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f85149' }} />
                          Bear Case {bearPct}%
                        </div>
                        <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${borderColor}` }}>↓ {entry.scenarios.bear.trigger || 'No trigger set'}</li>
                          <li style={{ padding: '3px 0', borderBottom: `1px solid ${borderColor}` }}>Entry: <strong style={{ color: textPrimary }}>{entry.scenarios.bear.entry || '—'}</strong></li>
                          <li style={{ padding: '3px 0' }}>Target: <span style={{ color: '#f85149', fontWeight: 700 }}>{entry.scenarios.bear.t1 || '—'} → {entry.scenarios.bear.t2 || '—'}</span></li>
                        </ul>
                      </div>
                      {/* Perception card */}
                      <div style={{ background: bearPct > bullPct ? '#200d0d' : '#0d2011', border: `1px solid ${bearPct > bullPct ? '#5a1a1a' : '#1a4a1f'}`, borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: domColor }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: domColor }} />
                          Tomorrow's Perception
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: domColor, marginBottom: 6 }}>{primaryBias} BIAS</div>
                        <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.7 }}>
                          {domScenario?.trigger
                            ? <>Primary watch: <strong style={{ color: textPrimary }}>{domScenario.trigger}</strong><br />If triggered → <strong style={{ color: domColor }}>{domScenario.entry}</strong></>
                            : 'Fill in scenarios above to see your perception summary'
                          }
                        </div>
                        <div style={{ marginTop: 8, padding: '7px 9px', background: 'rgba(0,0,0,.25)', borderRadius: 5, fontSize: 11, color: '#6e7681' }}>
                          If opposite case triggers → flip or stay flat. Never force the primary scenario.
                        </div>
                      </div>
                    </div>

                    {/* Confidence meter */}
                    <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: textPrimary }}>Setup Confidence</span>
                        <span style={{ fontSize: 18, fontWeight: 800, color: entry.confidence >= 70 ? '#3fb950' : entry.confidence >= 50 ? '#d29922' : '#f85149' }}>{entry.confidence}%</span>
                      </div>
                      <input
                        type="range" min={0} max={100} value={entry.confidence}
                        onChange={e => updateEntry(selected, 'confidence', Number(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', marginBottom: 8, accentColor: entry.confidence >= 70 ? '#3fb950' : entry.confidence >= 50 ? '#d29922' : '#f85149' }}
                      />
                      <div style={{ height: 8, background: isDark ? '#21262d' : '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{
                          height: '100%',
                          width: `${entry.confidence}%`,
                          background: entry.confidence >= 70 ? '#3fb950' : entry.confidence >= 50 ? '#d29922' : '#f85149',
                          borderRadius: 4,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                      <div style={{
                        borderRadius: 7,
                        padding: '8px 12px',
                        fontSize: 12,
                        borderLeft: `3px solid ${entry.confidence >= 70 ? '#3fb950' : entry.confidence >= 50 ? '#d29922' : '#f85149'}`,
                        background: entry.confidence >= 70 ? '#0d2011' : entry.confidence >= 50 ? '#1a1200' : '#200d0d',
                        color: entry.confidence >= 70 ? '#7ee787' : entry.confidence >= 50 ? '#f0c040' : '#ffa29e',
                        lineHeight: 1.7,
                      }}>
                        <strong>{entry.confidence >= 70 ? 'High conviction:' : entry.confidence >= 50 ? 'Moderate conviction:' : 'Low conviction — caution:'}</strong>{' '}
                        {entry.confidence >= 70
                          ? 'Structure, sector, and indicators aligned. Trade the plan. Standard size.'
                          : entry.confidence >= 50
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
                  sub={ivrNum > 0 ? `IVR ${ivrNum} · ${optionsDTE}` : 'Enter IVR in stock hero above'}
                />
                {!collapsedSections['options'] && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Recommended structure */}
                    <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bc8cff' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#bc8cff' }} />
                        Recommended Structure
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#bc8cff', marginBottom: 6 }}>{ivrNum > 0 ? optionsType : '—'}</div>
                      <div style={{ fontSize: 12, color: textMuted, marginBottom: 10 }}>{ivrNum > 0 ? `${optionsDTE} · ${optionsWhy}` : 'Enter IVR above to get options recommendation'}</div>
                      {[
                        { label: 'Entry trigger', val: domScenario?.trigger ? domScenario.trigger.split(' ').slice(0, 3).join(' ') + '…' : '—' },
                        { label: 'Option stop', val: '50% of premium paid', color: '#f85149' },
                        { label: 'Exit T1', val: '50–75% gain → sell half', color: '#3fb950' },
                        { label: 'Exit T2', val: 'Move stop to BE, let ride', color: '#3fb950' },
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${borderColor}`, fontSize: 12 }}>
                          <span style={{ color: textMuted }}>{row.label}</span>
                          <span style={{ fontWeight: 700, color: row.color ?? textPrimary }}>{row.val}</span>
                        </div>
                      ))}
                    </div>

                    {/* IV Warning */}
                    <div style={{ background: isDark ? '#1c2330' : '#f6f8fa', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#d29922' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#d29922' }} />
                        IV Warning
                      </div>
                      <ul style={{ listStyle: 'none', fontSize: 12, color: '#b1bac4', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <li style={{ padding: '4px 0', borderBottom: `1px solid ${borderColor}` }}>
                          <span style={{ color: '#d29922', fontWeight: 700 }}>IVR {ivrNum > 0 ? ivrNum : '?'}</span>
                          {' '}— {ivrNum < 40 ? 'Low — buy premium' : ivrNum < 60 ? 'Mid — use spreads' : 'High — sell premium'}
                        </li>
                        <li style={{ padding: '4px 0', borderBottom: `1px solid ${borderColor}` }}>Earnings within DTE? → <span style={{ color: '#f85149', fontWeight: 700 }}>skip or reduce size</span></li>
                        <li style={{ padding: '4px 0', borderBottom: `1px solid ${borderColor}` }}>Use <strong>stop-limit</strong> not stop-market on options</li>
                        <li style={{ padding: '4px 0', borderBottom: `1px solid ${borderColor}` }}>Set stock-price alert → manual option exit</li>
                        <li style={{ padding: '4px 0' }}>Never hold through expiration week</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Journal Notes ── */}
              <div>
                <SectionHeader id="notes" title={`Journal Notes — ${entry.ticker}`} />
                {!collapsedSections['notes'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Field label="What I observed today">
                      <textarea
                        style={textareaStyle}
                        value={entry.notes.observations}
                        onChange={e => updateNotes(selected, 'observations', e.target.value)}
                        placeholder="e.g. Broke ORL at 7:02, VWAP stayed overhead all day, sold off into close…"
                      />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <Field label="Mistake / Lesson">
                        <textarea
                          style={{ ...textareaStyle, minHeight: 60 }}
                          value={entry.notes.mistakes}
                          onChange={e => updateNotes(selected, 'mistakes', e.target.value)}
                          placeholder="e.g. Entered call before OR formed — thesis was wrong from start"
                        />
                      </Field>
                      <Field label="Tomorrow's Game Plan (1 sentence)">
                        <textarea
                          style={{ ...textareaStyle, minHeight: 60 }}
                          value={entry.notes.gamePlan}
                          onChange={e => updateNotes(selected, 'gamePlan', e.target.value)}
                          placeholder="e.g. Watch for ORL retest at $316 — short on rejection if VWAP stays overhead"
                        />
                      </Field>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleSave}
                        style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: saveFeedback ? '#1a4a1f' : '#21a047', color: saveFeedback ? '#3fb950' : '#000', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <Save size={13} /> {saveFeedback ?? 'Save Note'}
                      </button>
                      <button
                        onClick={handleExport}
                        style={{ padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid #1a3050', background: '#0d1a28', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <Download size={13} /> Export All
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom spacer */}
              <div style={{ height: 32 }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
