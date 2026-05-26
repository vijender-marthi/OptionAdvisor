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

export default function MarketOverview({ ticker, companyName, sector, marketCap, signals }: Props) {
  const up = signals.price_change >= 0
  const rsiColor = signals.rsi >= 70 ? C.red : signals.rsi <= 30 ? C.green : '#fff'
  const ivColor = signals.iv_rank >= 65 ? C.red : signals.iv_rank < 35 ? C.green : C.amber

  const pill: React.CSSProperties = { fontSize: '0.68rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600, fontFamily: 'monospace' }

  return (
    <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
      {/* Row 1: Ticker + price + bias compact */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>{ticker}</span>
          <span style={{ fontSize: '0.72rem', color: C.muted }}>{companyName}</span>
          <span style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>${signals.current_price.toFixed(2)}</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: up ? C.green : C.red }}>
            {up ? '▲' : '▼'} {Math.abs(signals.price_change).toFixed(2)} ({signals.price_change_pct > 0 ? '+' : ''}{signals.price_change_pct.toFixed(2)}%)
          </span>
          {!!signals.ext_market_price && signals.ext_market_price > 0 && (
            <>
              <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 20, border: `1px solid ${C.purple}`, color: C.purple, background: 'rgba(107,127,212,0.08)' }}>
                {signals.ext_market_type === 'pre' ? 'Pre' : 'AH'}
              </span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>${signals.ext_market_price.toFixed(2)}</span>
              {!!signals.ext_market_change && signals.ext_market_change !== 0 && (
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: signals.ext_market_change >= 0 ? C.green : C.red }}>
                  {signals.ext_market_change >= 0 ? '▲' : '▼'}{Math.abs(signals.ext_market_change).toFixed(2)} ({(signals.ext_market_change_pct ?? 0) >= 0 ? '+' : ''}{(signals.ext_market_change_pct ?? 0).toFixed(2)}%)
                </span>
              )}
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: '0.6rem', color: C.muted }}>Bias</div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: trendColor(signals.directional_bias) }}>{signals.directional_bias}</div>
          <div style={{ fontSize: '0.6rem', color: C.muted }}>{signals.bias_confidence}%</div>
        </div>
      </div>

      {/* Row 2: Condensed metrics strip */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ ...pill, color: trendColor(signals.trend), border: `1px solid ${trendColor(signals.trend)}`, background: 'rgba(0,229,160,0.06)' }}>
          Trend: {signals.trend}
        </span>
        <span style={{ ...pill, color: rsiColor, border: `1px solid ${rsiColor}`, background: 'rgba(255,255,255,0.04)' }}>
          RSI: {signals.rsi.toFixed(1)} {signals.rsi_signal}
        </span>
        <span style={{ ...pill, color: ivColor, border: `1px solid ${ivColor}`, background: 'rgba(255,255,255,0.04)' }}>
          IV Rank: {signals.iv_rank.toFixed(0)}% {signals.iv_environment}
        </span>
        <span style={{ ...pill, color: signals.iv_vs_hv > 0 ? C.red : C.green, border: `1px solid ${signals.iv_vs_hv > 0 ? C.red : C.green}`, background: 'rgba(255,255,255,0.04)' }}>
          IV/HV: {signals.iv_vs_hv > 0 ? '+' : ''}{signals.iv_vs_hv.toFixed(1)}% ({signals.iv_vs_hv > 0 ? 'rich' : 'cheap'})
        </span>
        <span style={{ ...pill, color: signals.pcr_signal === 'Bearish' ? C.red : signals.pcr_signal === 'Bullish' ? C.green : C.muted, border: `1px solid ${signals.pcr_signal === 'Bearish' ? C.red : signals.pcr_signal === 'Bullish' ? C.green : C.border}` }}>
          P/C: {signals.put_call_ratio.toFixed(2)} {signals.pcr_signal}
        </span>
        <span style={{ ...pill, color: signals.volatility_regime === 'Sell Premium' ? C.amber : signals.volatility_regime === 'Buy Premium' ? C.green : '#fff', border: `1px solid ${signals.volatility_regime === 'Sell Premium' ? C.amber : signals.volatility_regime === 'Buy Premium' ? C.green : C.border}` }}>
          Vol: {signals.volatility_regime}
        </span>
      </div>

      {/* Row 3: IV regime note (single line) */}
      {signals.volatility_regime === 'Sell Premium' && (
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: C.amber }}>
          ⚡ IV Rank {signals.iv_rank.toFixed(0)}% · IV {signals.iv_vs_hv.toFixed(1)}% above HV · Credit strategies favored
        </div>
      )}
      {signals.volatility_regime === 'Buy Premium' && (
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: C.green }}>
          💰 IV Rank {signals.iv_rank.toFixed(0)}% · Options relatively cheap · Debit strategies favored
        </div>
      )}

      {/* Row 4: Moving Averages + MACD (single compact line) */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
        <span style={{ fontSize: '0.68rem', color: C.muted, alignSelf: 'center' }}>MAs:</span>
        <span style={{ ...pill, color: signals.above_ma20 ? C.green : C.red, border: `1px solid ${signals.above_ma20 ? C.green : C.red}`, background: signals.above_ma20 ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)' }}>
          {signals.above_ma20 ? '▲' : '▼'} MA20 ${signals.ma20.toFixed(0)}
        </span>
        <span style={{ ...pill, color: signals.above_ma50 ? C.green : C.red, border: `1px solid ${signals.above_ma50 ? C.green : C.red}`, background: signals.above_ma50 ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)' }}>
          {signals.above_ma50 ? '▲' : '▼'} MA50 ${signals.ma50.toFixed(0)}
        </span>
        <span style={{ ...pill, color: signals.above_ma200 ? C.green : C.red, border: `1px solid ${signals.above_ma200 ? C.green : C.red}`, background: signals.above_ma200 ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)' }}>
          {signals.above_ma200 ? '▲' : '▼'} MA200 ${signals.ma200.toFixed(0)}
        </span>
        <span style={{ ...pill, color: signals.ma50_slope > 0 ? C.green : C.red, border: `1px solid ${signals.ma50_slope > 0 ? C.green : C.red}`, background: signals.ma50_slope > 0 ? 'rgba(0,229,160,0.06)' : 'rgba(255,77,109,0.06)' }}>
          MA50 slope: {signals.ma50_slope > 0 ? '↑' : '↓'} {Math.abs(signals.ma50_slope).toFixed(2)}%
        </span>
        <span style={{ ...pill, color: signals.macd_crossover === 'Bullish' ? C.green : signals.macd_crossover === 'Bearish' ? C.red : C.muted, border: `1px solid ${signals.macd_crossover === 'Bullish' ? C.green : signals.macd_crossover === 'Bearish' ? C.red : C.border}` }}>
          MACD: {signals.macd_crossover === 'None' ? 'No crossover' : signals.macd_crossover + ' crossover'}
        </span>
      </div>
    </div>
  )
}
