import type { Signals } from '../types'

interface Props {
  ticker: string
  companyName: string
  sector: string
  marketCap: string
  signals: Signals
}

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

function trendColor(t: string): string {
  if (t.includes('Bullish')) return C.green
  if (t.includes('Bearish')) return C.red
  return C.amber
}
function trendBg(t: string): string {
  if (t.includes('Bullish')) return 'rgba(0,229,160,0.06)'
  if (t.includes('Bearish')) return 'rgba(255,77,109,0.06)'
  return 'rgba(245,166,35,0.06)'
}
function trendBorder(t: string): string {
  if (t.includes('Bullish')) return C.green
  if (t.includes('Bearish')) return C.red
  return C.amber
}

export default function MarketOverview({ ticker, companyName, sector, marketCap, signals }: Props) {
  const up = signals.price_change >= 0
  const rsiColor = signals.rsi >= 70 ? C.red : signals.rsi <= 30 ? C.green : '#fff'
  const ivColor = signals.iv_rank >= 65 ? C.red : signals.iv_rank < 35 ? C.green : C.amber
  const evColor = signals.iv_vs_hv > 0 ? C.red : C.green

  const cell: React.CSSProperties = { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }

  return (
    <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px' }}>
      {/* Row 1: Ticker header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>{ticker}</span>
            <span style={{ fontSize: '0.82rem', color: C.muted }}>{companyName}</span>
            <span style={{ fontSize: '0.65rem', color: C.muted, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 20, padding: '1px 8px' }}>{sector}</span>
            <span style={{ fontSize: '0.65rem', color: C.muted, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 20, padding: '1px 8px' }}>{marketCap}</span>
          </div>
          {/* Price + change */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>${signals.current_price.toFixed(2)}</span>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: up ? C.green : C.red }}>
              {up ? '▲' : '▼'} {Math.abs(signals.price_change).toFixed(2)} ({signals.price_change_pct > 0 ? '+' : ''}{signals.price_change_pct.toFixed(2)}%)
            </span>
          </div>
          {/* Extended hours */}
          {!!signals.ext_market_price && signals.ext_market_price > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                padding: '1px 8px', borderRadius: 20, border: '1px solid',
                color: signals.ext_market_type === 'pre' ? C.purple : C.purple,
                background: signals.ext_market_type === 'pre' ? 'rgba(107,127,212,0.08)' : 'rgba(107,127,212,0.08)',
                borderColor: signals.ext_market_type === 'pre' ? C.purple : C.purple,
              }}>
                {signals.ext_market_type === 'pre' ? 'Pre-Market' : 'After Hours'}
              </span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>${signals.ext_market_price.toFixed(2)}</span>
              {!!signals.ext_market_change && signals.ext_market_change !== 0 && (
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: signals.ext_market_change >= 0 ? C.green : C.red }}>
                  {signals.ext_market_change >= 0 ? '▲' : '▼'} {Math.abs(signals.ext_market_change).toFixed(2)} ({(signals.ext_market_change_pct ?? 0) >= 0 ? '+' : ''}{(signals.ext_market_change_pct ?? 0).toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bias badge */}
        <div style={{
          ...cell, textAlign: 'center', minWidth: 110,
          borderColor: trendBorder(signals.directional_bias),
          background: trendBg(signals.directional_bias),
        }}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>Overall Bias</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: trendColor(signals.directional_bias) }}>{signals.directional_bias}</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.bias_confidence}% confidence</div>
        </div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 14 }}>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>Trend</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: trendColor(signals.trend) }}>{signals.trend}</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.trend_strength}</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>RSI (14)</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'monospace', color: rsiColor }}>{signals.rsi.toFixed(1)}</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.rsi_signal}</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>IV Rank</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'monospace', color: ivColor }}>{signals.iv_rank.toFixed(0)}%</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.iv_environment}</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>IV vs HV20</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'monospace', color: evColor }}>{signals.iv_vs_hv > 0 ? '+' : ''}{signals.iv_vs_hv.toFixed(1)}%</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.iv_vs_hv > 0 ? 'IV rich' : 'IV cheap'}</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>Put/Call</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'monospace', color: signals.pcr_signal === 'Bearish' ? C.red : signals.pcr_signal === 'Bullish' ? C.green : '#fff' }}>{signals.put_call_ratio.toFixed(2)}</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>{signals.pcr_signal}</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: '0.65rem', color: C.muted, marginBottom: 2 }}>Vol Regime</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: signals.volatility_regime === 'Sell Premium' ? C.amber : signals.volatility_regime === 'Buy Premium' ? C.green : '#fff' }}>{signals.volatility_regime}</div>
          <div style={{ fontSize: '0.65rem', color: C.muted }}>Skew: {signals.skew_signal}</div>
        </div>
      </div>

      {/* Vol regime banner */}
      {signals.volatility_regime === 'Sell Premium' && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid rgba(245,166,35,0.25)`, background: 'rgba(245,166,35,0.06)', fontSize: '0.82rem', color: C.amber }}>
          ⚡ <strong>High IV Environment</strong> — IV Rank {signals.iv_rank.toFixed(0)}%, IV is {signals.iv_vs_hv.toFixed(1)}% above realized vol. Credit strategies (Iron Condor, Bull Put Spread, Bear Call Spread) are favored.
        </div>
      )}
      {signals.volatility_regime === 'Buy Premium' && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid rgba(0,229,160,0.25)`, background: 'rgba(0,229,160,0.06)', fontSize: '0.82rem', color: C.green }}>
          💰 <strong>Low IV Environment</strong> — IV Rank {signals.iv_rank.toFixed(0)}%. Options are relatively cheap. Debit strategies (Long Call/Put, Spreads) offer good value.
        </div>
      )}
      {signals.volatility_regime === 'Neutral' && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid rgba(74,124,255,0.25)`, background: 'rgba(74,124,255,0.06)', fontSize: '0.82rem', color: C.accent }}>
          📊 <strong>Moderate IV</strong> — IV Rank {signals.iv_rank.toFixed(0)}%. Spreads offer a balanced risk/reward.
        </div>
      )}

      {/* Moving Averages + MACD */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        <span style={{ fontSize: '0.72rem', color: C.muted, alignSelf: 'center' }}>Moving Averages:</span>
        {([
          [signals.above_ma20, `MA20 $${signals.ma20.toFixed(0)}`],
          [signals.above_ma50, `MA50 $${signals.ma50.toFixed(0)}`],
          [signals.above_ma200, `MA200 $${signals.ma200.toFixed(0)}`],
        ] as const).map(([above, label]) => (
          <span key={label} style={{
            fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600, fontFamily: 'monospace',
            color: above ? C.green : C.red, border: `1px solid ${above ? C.green : C.red}`,
            background: above ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)',
          }}>
            {above ? '▲' : '▼'} {label}
          </span>
        ))}
        <span style={{
          fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600, fontFamily: 'monospace',
          color: signals.ma50_slope > 0 ? C.green : C.red,
          border: `1px solid ${signals.ma50_slope > 0 ? C.green : C.red}`,
          background: signals.ma50_slope > 0 ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)',
        }}>
          MA50 slope: {signals.ma50_slope > 0 ? '↑' : '↓'} {Math.abs(signals.ma50_slope).toFixed(2)}%
        </span>
        <span style={{
          fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600, fontFamily: 'monospace',
          color: signals.macd_crossover === 'Bullish' ? C.green : signals.macd_crossover === 'Bearish' ? C.red : C.muted,
          border: `1px solid ${signals.macd_crossover === 'Bullish' ? C.green : signals.macd_crossover === 'Bearish' ? C.red : C.border}`,
          background: signals.macd_crossover === 'Bullish' ? 'rgba(0,229,160,0.06)' : signals.macd_crossover === 'Bearish' ? 'rgba(255,77,109,0.06)' : 'transparent',
        }}>
          MACD: {signals.macd_crossover === 'None' ? 'No crossover' : signals.macd_crossover + ' crossover'}
        </span>
      </div>
    </div>
  )
}
