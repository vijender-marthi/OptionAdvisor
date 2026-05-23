import { useState } from 'react'
import type { DeskWatchlistItem } from '../../api/client'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
  purple:    '#6B7FD4',
}

const QUICK_TICKERS = ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'TSLA', 'SPY', 'QQQ']

type TradeType = 'day' | 'swing'

function signalBadgeStyle(verdict: string): React.CSSProperties {
  const u = verdict.toUpperCase()
  if (u.includes('ENTER') || u === 'GO' || u === 'STRONG GO') {
    return { background: 'rgba(0,229,160,0.1)', color: C.green, border: `1px solid rgba(0,229,160,0.2)` }
  }
  if (u.includes('WATCH')) {
    return { background: 'rgba(245,166,35,0.1)', color: C.amber, border: `1px solid rgba(245,166,35,0.2)` }
  }
  if (u.includes('WAIT')) {
    return { background: 'rgba(107,127,212,0.1)', color: C.purple, border: `1px solid rgba(107,127,212,0.2)` }
  }
  return { background: 'rgba(255,77,109,0.1)', color: C.red, border: `1px solid rgba(255,77,109,0.2)` }
}

function signalLabel(verdict: string): string {
  const u = verdict.toUpperCase()
  if (u === 'STRONG GO') return 'ENTER'
  if (u === 'GO') return 'ENTER'
  if (u.includes('ENTER') || u.includes('READY')) return 'ENTER'
  if (u.includes('WATCH')) return 'WATCH'
  if (u.includes('WAIT')) return 'WAIT'
  if (u.includes('NO-GO') || u.includes('AVOID') || u.includes('CONFLICT')) return 'AVOID'
  return u.slice(0, 5)
}

interface Props {
  watchlist: DeskWatchlistItem[]
  selectedTicker: string
  tradeType: string
  tradeTypeValue: TradeType
  onLoadTicker: (ticker: string) => void
  onRemove: (ticker: string) => void
  onTradeTypeChange: (tt: TradeType) => void
  openTradeSet: Set<string>
  alertTickerSet: Set<string>
  verdicts: Record<string, string>
}

export default function LeftPanel({
  watchlist,
  selectedTicker,
  tradeType,
  tradeTypeValue,
  onLoadTicker,
  onRemove,
  onTradeTypeChange,
  openTradeSet,
  alertTickerSet,
  verdicts,
}: Props) {
  const [tickerInput, setTickerInput] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)

  const handleSubmit = () => {
    const t = tickerInput.trim().toUpperCase()
    if (t) {
      onLoadTicker(t)
      setTickerInput('')
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: C.bgPanel, borderRight: `1px solid ${C.border}`,
    }}>
      {/* Section 1 — Ticker input */}
      <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
        <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Analyze Ticker
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{
              flex: 1, minWidth: 0, background: C.bgPage, border: `1px solid ${C.borderSub}`,
              borderRadius: 7, padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700,
              fontSize: '0.9rem', color: '#fff', outline: 'none', textTransform: 'uppercase',
            }}
            placeholder="AAPL…"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            onFocus={e => (e.target.style.borderColor = C.accent)}
            onBlur={e => (e.target.style.borderColor = C.borderSub)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              background: C.accent, border: 'none', borderRadius: 7,
              padding: '7px 12px', color: '#fff', fontWeight: 700,
              fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Ana→
          </button>
        </div>
      </div>

      {/* Section 2 — Trade type tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        {(['day', 'swing'] as TradeType[]).map(tt => {
          const active = tradeTypeValue === tt
          return (
            <button
              key={tt}
              type="button"
              onClick={() => onTradeTypeChange(tt)}
              style={{
                flex: 1, padding: '8px 0', background: active ? 'rgba(74,124,255,0.15)' : 'transparent',
                border: 'none', borderBottom: active ? `2px solid ${C.accent}` : `2px solid transparent`,
                color: active ? C.accent : C.muted,
                fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {tt}
            </button>
          )
        })}
      </div>

      {/* Section 3 — Quick Add chips */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {QUICK_TICKERS.map(t => {
          const active = t === selectedTicker
          return (
            <button
              key={t}
              type="button"
              onClick={() => onLoadTicker(t)}
              style={{
                background: active ? 'rgba(74,124,255,0.12)' : C.bgCard,
                border: `1px solid ${active ? C.accent : C.borderSub}`,
                color: active ? C.accent : C.muted,
                borderRadius: 5, padding: '3px 8px',
                fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      {/* Section 4 — Watchlist */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Today's Setups
          </span>
          <span style={{ fontSize: '0.62rem', color: C.muted }}>{watchlist.length}/10</span>
        </div>

        {watchlist.length === 0 ? (
          <p style={{ textAlign: 'center', color: C.muted, fontSize: '0.78rem', padding: '16px 12px' }}>Add tickers above</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {watchlist.map(item => {
              const key = `${item.ticker}:${item.trade_type}`
              const isSelected = item.ticker === selectedTicker && item.trade_type === tradeType
              const verdict = verdicts[key] || ''
              const hasOpen = openTradeSet.has(item.ticker)
              const hasAlert = alertTickerSet.has(item.ticker)

              return (
                <li
                  key={key}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onLoadTicker(item.ticker)}
                  style={{
                    position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px 10px 13px', cursor: 'pointer',
                    background: isSelected ? C.bgCard : 'transparent',
                    borderLeft: `3px solid ${isSelected ? C.accent : 'transparent'}`,
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.88rem', color: '#fff' }}>
                      {item.ticker}
                      {hasOpen && <span style={{ marginLeft: 5, fontSize: '0.6rem', color: C.amber }}>●</span>}
                      {hasAlert && <span style={{ marginLeft: 3, fontSize: '0.6rem', color: C.accent }}>🔔</span>}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: C.muted, marginTop: 1 }}>
                      {item.ticker} · {item.trade_type}
                    </div>
                  </div>
                  {verdict && (
                    <span style={{
                      ...signalBadgeStyle(verdict),
                      borderRadius: 5, padding: '2px 7px', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {signalLabel(verdict)}
                    </span>
                  )}
                  {hovered === key && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onRemove(item.ticker) }}
                      style={{
                        position: 'absolute', right: 10, background: 'transparent', border: 'none',
                        color: C.muted, cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px',
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
