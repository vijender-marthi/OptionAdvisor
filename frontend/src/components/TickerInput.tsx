import { useEffect, useState, KeyboardEvent } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { StrategyMode } from '../types'

const C = {
  bgPage:    'var(--surface-canvas)',
  bgPanel:   'var(--surface-card)',
  bgCard:    'var(--surface-elevated)',
  border:    'var(--border-default)',
  borderSub: 'var(--border-subtle)',
  muted:     'var(--text-muted)',
  accent:    'var(--info)',
  violet:    'var(--accent)',
  green:     'var(--bullish)',
  text:      'var(--text-primary)',
}

interface Props {
  onAnalyze: (ticker: string, weeksOut: number, spreadWidth: number | null, strategyMode: StrategyMode) => void
  loading: boolean
  initialTicker?: string
  initialWeeks?: number
  initialSpreadWidth?: number | null
  initialStrategyMode?: StrategyMode
}

const POPULAR = ['AAPL', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'AMZN', 'MSFT']

type HoldingPeriod = 'day' | 'carry' | 'swing' | 'leaps'

const HOLDING_PERIODS: { id: HoldingPeriod; label: string; sub: string; weeksOut: number }[] = [
  { id: 'day', label: 'Day', sub: 'Fast intent', weeksOut: 3 },
  { id: 'carry', label: 'Carry', sub: 'Overnight', weeksOut: 4 },
  { id: 'swing', label: 'Swing', sub: '2-6 weeks', weeksOut: 5 },
  { id: 'leaps', label: 'LEAPS', sub: 'Long-term', weeksOut: 6 },
]

const periodFromWeeks = (weeks: number): HoldingPeriod => {
  if (weeks >= 6) return 'leaps'
  if (weeks === 3) return 'day'
  if (weeks === 4) return 'carry'
  return 'swing'
}

const STRATEGY_MODES: { label: string; sub: string; value: StrategyMode }[] = [
  { label: 'Auto',             sub: 'Recommended',                         value: 'all'               },
  { label: 'Directional',      sub: 'Long calls / long puts',              value: 'long_only'         },
  { label: 'Income',           sub: 'Credit spreads',                      value: 'credit_only'       },
  { label: 'Volatility',       sub: 'Straddles / strangles',               value: 'straddle_only'     },
  { label: 'Time Decay',       sub: 'Calendar / diagonal',                 value: 'calendar_only'     },
  { label: 'Stock Strategies', sub: 'Covered calls / cash-secured puts',   value: 'short_or_covered'  },
]

export default function TickerInput({
  onAnalyze,
  loading,
  initialTicker = '',
  initialWeeks = 4,
  initialSpreadWidth = null,
  initialStrategyMode = 'all',
}: Props) {
  const [ticker,       setTicker]       = useState('')
  const [holdingPeriod, setHoldingPeriod] = useState<HoldingPeriod>('swing')
  const [spreadWidth,  setSpreadWidth]  = useState<number | null>(null)
  const [strategyMode, setStrategyMode] = useState<StrategyMode>('all')
  const [inputFocused, setInputFocused] = useState(false)
  const [hoveredChip, setHoveredChip] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => { setTicker(initialTicker) }, [initialTicker])
  useEffect(() => { setHoldingPeriod(periodFromWeeks(initialWeeks)) }, [initialWeeks])
  useEffect(() => { setSpreadWidth(initialSpreadWidth) }, [initialSpreadWidth])
  useEffect(() => { setStrategyMode(initialStrategyMode) }, [initialStrategyMode])

  const handle = () => {
    const t = ticker.trim().toUpperCase()
    const period = HOLDING_PERIODS.find(p => p.id === holdingPeriod) ?? HOLDING_PERIODS[2]
    if (t) onAnalyze(t, period.weeksOut, spreadWidth, strategyMode)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handle()
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: C.muted,
    marginBottom: '6px',
    display: 'block',
  }

  return (
    <div className="ticker-input" style={{
      background: C.bgPanel,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: '20px 20px 16px',
    }}>
      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Ticker</span>
        <input
          style={{
            width: '100%',
            background: C.bgPage,
            border: `1px solid ${inputFocused ? C.accent : C.borderSub}`,
            borderRadius: 8,
            padding: '10px 14px',
            color: C.text,
            fontFamily: 'monospace',
            fontSize: '1.1rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            outline: 'none',
            boxShadow: inputFocused ? `0 0 0 3px var(--info-bg)` : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          placeholder="AAPL, TSLA, SPY..."
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={onKey}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Holding Period</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {HOLDING_PERIODS.map(period => {
            const active = holdingPeriod === period.id
            return (
              <button
                key={period.id}
                type="button"
                onClick={() => setHoldingPeriod(period.id)}
                style={{
                  padding: '9px 10px',
                  borderRadius: 10,
                  border: `1px solid ${active ? C.accent : C.borderSub}`,
                  background: active ? 'var(--info-bg)' : C.bgCard,
                  color: active ? C.text : C.muted,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 800 }}>{period.label}</div>
                <div style={{ fontSize: '0.64rem', marginTop: 1, color: active ? C.accent : C.muted }}>{period.sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handle}
          disabled={loading || !ticker.trim()}
          style={{
            background: loading || !ticker.trim() ? C.bgCard : C.accent,
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            color: loading || !ticker.trim() ? C.muted : '#fff',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: loading || !ticker.trim() ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            whiteSpace: 'nowrap',
            transition: 'background 0.15s',
          }}
        >
          {loading ? (
            <>
              <svg style={{ animation: 'spin 1s linear infinite', width: 14, height: 14 }} fill="none" viewBox="0 0 24 24">
                <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing...
            </>
          ) : (
            <><Search size={14} /> Analyze</>
          )}
        </button>
      </div>

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.borderSub}`, paddingTop: 12 }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(p => !p)}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: C.text,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted }}>
            Strategy Preference
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: strategyMode === 'all' ? C.green : C.accent }}>
            {STRATEGY_MODES.find(o => o.value === strategyMode)?.label ?? 'Auto'}
            <ChevronDown size={14} style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </span>
        </button>
        <div style={{
          marginTop: 8,
          display: advancedOpen ? 'grid' : 'none',
          gridTemplateColumns: '1fr',
          gap: 6,
        }}>
          {STRATEGY_MODES.map(opt => {
            const active = strategyMode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStrategyMode(opt.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${active ? C.accent : C.borderSub}`,
                  background: active ? 'var(--info-bg)' : C.bgPage,
                  color: active ? C.text : C.muted,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800 }}>{opt.label}</span>
                  {opt.value === 'all' && <span style={{ fontSize: '0.62rem', color: C.green }}>Recommended</span>}
                </div>
                <div style={{ fontSize: '0.66rem', marginTop: 1 }}>{opt.sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Quick picks */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', color: C.muted }}>Quick:</span>
        {POPULAR.map(t => {
          const hovered = hoveredChip === t
          return (
            <button
              key={t}
              onClick={() => {
                const period = HOLDING_PERIODS.find(p => p.id === holdingPeriod) ?? HOLDING_PERIODS[2]
                setTicker(t)
                onAnalyze(t, period.weeksOut, spreadWidth, strategyMode)
              }}
              onMouseEnter={() => setHoveredChip(t)}
              onMouseLeave={() => setHoveredChip(null)}
              style={{
                padding: '3px 9px',
                borderRadius: 4,
                border: `1px solid ${hovered ? C.accent : C.borderSub}`,
                background: C.bgCard,
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: hovered ? C.text : C.muted,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
