import { useEffect, useState, KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import type { StrategyMode } from '../types'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  violet:    '#7C5CFC',
  text:      '#E8EBF0',
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

const WIDTH_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Auto', value: null },
  { label: '$5',   value: 5 },
  { label: '$10',  value: 10 },
]

const STRATEGY_MODES: { label: string; sub: string; value: StrategyMode }[] = [
  { label: 'All Strategies',  sub: 'Engine picks best fit',           value: 'all'               },
  { label: 'Long Options',    sub: 'Long calls, puts, spreads',       value: 'long_only'         },
  { label: 'Credit Spreads',  sub: 'Defined-risk spreads only',       value: 'credit_only'       },
  { label: 'Straddles',       sub: 'Buy vol · ATM call + put',        value: 'straddle_only'     },
  { label: 'Short / Covered', sub: 'Naked short & covered plays',     value: 'short_or_covered'  },
]

export default function TickerInput({
  onAnalyze,
  loading,
  initialTicker = '',
  initialWeeks = 4,
  initialSpreadWidth = 5,
  initialStrategyMode = 'all',
}: Props) {
  const [ticker,       setTicker]       = useState('')
  const [weeks,        setWeeks]        = useState(4)
  const [spreadWidth,  setSpreadWidth]  = useState<number | null>(5)
  const [strategyMode, setStrategyMode] = useState<StrategyMode>('all')
  const [inputFocused, setInputFocused] = useState(false)
  const [hoveredMode, setHoveredMode] = useState<string | null>(null)
  const [hoveredWidth, setHoveredWidth] = useState<string | null>(null)
  const [hoveredChip, setHoveredChip] = useState<string | null>(null)

  useEffect(() => { setTicker(initialTicker) }, [initialTicker])
  useEffect(() => { setWeeks(initialWeeks) }, [initialWeeks])
  useEffect(() => { setSpreadWidth(initialSpreadWidth) }, [initialSpreadWidth])
  useEffect(() => { setStrategyMode(initialStrategyMode) }, [initialStrategyMode])

  const handle = () => {
    const t = ticker.trim().toUpperCase()
    if (t) onAnalyze(t, weeks, spreadWidth, strategyMode)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handle()
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: C.muted,
    marginBottom: 8,
    display: 'block',
  }

  return (
    <div style={{
      background: C.bgPanel,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: '20px 20px 16px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: C.text, fontFamily: 'monospace' }}>
          Strategy Finder
        </span>
        <span style={{
          fontSize: '0.65rem', color: C.muted,
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 20, padding: '2px 10px', marginLeft: 'auto',
        }}>
          Systematic Engine v2
        </span>
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          style={{
            flex: 1, minWidth: 160,
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
            boxShadow: inputFocused ? `0 0 0 3px rgba(74,124,255,0.15)` : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          placeholder="AAPL, TSLA, SPY..."
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={onKey}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <select
          style={{
            background: C.bgPage,
            border: `1px solid ${C.borderSub}`,
            borderRadius: 8,
            padding: '10px 12px',
            color: C.text,
            fontSize: '0.82rem',
            outline: 'none',
            cursor: 'pointer',
            minWidth: 130,
          }}
          value={weeks}
          onChange={e => setWeeks(Number(e.target.value))}
        >
          {MULTI_WEEK_TARGETS.map(w => (
            <option key={w} value={w}>{w} weeks out</option>
          ))}
        </select>
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
            gap: 6,
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

      {/* Strategy mode */}
      <div style={{ marginTop: 14 }}>
        <span style={labelStyle}>Strategy mode:</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STRATEGY_MODES.map(opt => {
            const active = strategyMode === opt.value
            const hovered = hoveredMode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStrategyMode(opt.value)}
                onMouseEnter={() => setHoveredMode(opt.value)}
                onMouseLeave={() => setHoveredMode(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${active ? C.violet : hovered ? C.accent : C.borderSub}`,
                  background: active ? 'rgba(124,92,252,0.12)' : C.bgCard,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: active ? '#fff' : hovered ? C.text : C.muted,
                }}>
                  {opt.label}
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: active ? 'rgba(124,92,252,0.8)' : C.muted,
                  opacity: active ? 1 : 0.6,
                  marginTop: 2,
                }}>
                  {opt.sub}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Spread width */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, marginBottom: 0 }}>Spread width:</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {WIDTH_OPTIONS.map(opt => {
            const active = spreadWidth === opt.value
            const hovered = hoveredWidth === String(opt.value)
            return (
              <button
                key={String(opt.value)}
                onClick={() => setSpreadWidth(opt.value)}
                onMouseEnter={() => setHoveredWidth(String(opt.value))}
                onMouseLeave={() => setHoveredWidth(null)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: `1px solid ${active ? C.violet : hovered ? C.accent : C.borderSub}`,
                  background: active ? 'rgba(124,92,252,0.15)' : C.bgCard,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: active ? '#fff' : C.muted,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: '0.72rem', color: C.muted, opacity: 0.6 }}>
          {spreadWidth === null
            ? 'Engine picks width based on OTM distance'
            : spreadWidth === 5
            ? 'Lower risk per trade · best for liquid names'
            : 'Higher absolute credit · fewer commissions'}
        </span>
      </div>

      {/* Quick picks */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', color: C.muted }}>Quick:</span>
        {POPULAR.map(t => {
          const hovered = hoveredChip === t
          return (
            <button
              key={t}
              onClick={() => { setTicker(t); onAnalyze(t, weeks, spreadWidth, strategyMode) }}
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
