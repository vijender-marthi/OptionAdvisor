import type { Signals } from '../types'

interface Props {
  ticker: string
  companyName: string
  sector: string
  marketCap: string
  signals: Signals
}

const trendColor = (t: string) =>
  t.includes('Bullish') ? 'text-green-400' : t.includes('Bearish') ? 'text-red-400' : 'text-amber-400'

const trendBg = (t: string) =>
  t.includes('Bullish') ? 'bg-green-900/40 border-green-700' : t.includes('Bearish') ? 'bg-red-900/40 border-red-700' : 'bg-amber-900/40 border-amber-700'

function MetricCard({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`font-bold text-lg font-mono ${valueColor || 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function MaBadge({ label, above }: { label: string; above: boolean }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium border
      ${above ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-red-900/40 text-red-400 border-red-800'}`}>
      {above ? '▲' : '▼'} {label}
    </span>
  )
}

export default function MarketOverview({ ticker, companyName, sector, marketCap, signals }: Props) {
  const up = signals.price_change >= 0
  const rsiColor = signals.rsi >= 70 ? 'text-red-400' : signals.rsi <= 30 ? 'text-green-400' : 'text-white'
  const ivColor = signals.iv_rank >= 65 ? 'text-red-400' : signals.iv_rank < 35 ? 'text-green-400' : 'text-amber-400'
  const evColor = signals.iv_vs_hv > 0 ? 'text-red-400' : 'text-green-400'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl font-bold font-mono text-white">{ticker}</span>
            <span className="text-gray-400 text-sm">{companyName}</span>
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">{sector}</span>
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">{marketCap}</span>
          </div>
          {/* Regular session price + day change */}
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-4xl font-bold font-mono">${signals.current_price.toFixed(2)}</span>
            <span className={`text-lg font-semibold ${up ? 'text-green-400' : 'text-red-400'}`}>
              {up ? '▲' : '▼'} {Math.abs(signals.price_change).toFixed(2)} ({signals.price_change_pct > 0 ? '+' : ''}{signals.price_change_pct.toFixed(2)}%)
            </span>
          </div>

          {/* Extended-hours price — only shown when market is closed / pre/post */}
          {!!signals.ext_market_price && signals.ext_market_price > 0 && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                signals.ext_market_type === 'pre'
                  ? 'bg-blue-900/40 text-blue-300 border-blue-700'
                  : 'bg-purple-900/40 text-purple-300 border-purple-700'
              }`}>
                {signals.ext_market_type === 'pre' ? 'Pre-Market' : 'After Hours'}
              </span>
              <span className="text-xl font-bold font-mono text-white">
                ${signals.ext_market_price.toFixed(2)}
              </span>
              {!!signals.ext_market_change && signals.ext_market_change !== 0 && (
                <span className={`text-sm font-semibold ${signals.ext_market_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {signals.ext_market_change >= 0 ? '▲' : '▼'}{' '}
                  {Math.abs(signals.ext_market_change).toFixed(2)}{' '}
                  ({(signals.ext_market_change_pct ?? 0) >= 0 ? '+' : ''}{(signals.ext_market_change_pct ?? 0).toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bias badge */}
        <div className={`rounded-xl p-3 border text-center min-w-28 ${trendBg(signals.directional_bias)}`}>
          <div className="text-xs text-gray-400 mb-1">Overall Bias</div>
          <div className={`font-bold text-lg ${trendColor(signals.directional_bias)}`}>{signals.directional_bias}</div>
          <div className="text-xs text-gray-400">{signals.bias_confidence}% confidence</div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Trend" value={signals.trend} sub={signals.trend_strength} valueColor={trendColor(signals.trend)} />
        <MetricCard label="RSI (14)" value={signals.rsi.toString()} sub={signals.rsi_signal} valueColor={rsiColor} />
        <MetricCard label="IV Rank" value={`${signals.iv_rank.toFixed(0)}%`} sub={signals.iv_environment} valueColor={ivColor} />
        <MetricCard label="IV vs HV20" value={`${signals.iv_vs_hv > 0 ? '+' : ''}${signals.iv_vs_hv.toFixed(1)}%`} sub={signals.iv_vs_hv > 0 ? 'IV rich' : 'IV cheap'} valueColor={evColor} />
        <MetricCard label="Put/Call" value={signals.put_call_ratio.toFixed(2)} sub={signals.pcr_signal} valueColor={signals.pcr_signal === 'Bearish' ? 'text-red-400' : signals.pcr_signal === 'Bullish' ? 'text-green-400' : 'text-white'} />
        <MetricCard label="Vol Regime" value={signals.volatility_regime} sub={`Skew: ${signals.skew_signal}`} valueColor={signals.volatility_regime === 'Sell Premium' ? 'text-amber-400' : signals.volatility_regime === 'Buy Premium' ? 'text-green-400' : 'text-white'} />
      </div>

      {/* Vol regime banner */}
      {signals.volatility_regime === 'Sell Premium' && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3 text-sm text-amber-300">
          ⚡ <strong>High IV Environment</strong> — IV Rank {signals.iv_rank.toFixed(0)}%, IV is {signals.iv_vs_hv.toFixed(1)}% above realized vol.
          Credit strategies (Iron Condor, Bull Put Spread, Bear Call Spread) are favored.
        </div>
      )}
      {signals.volatility_regime === 'Buy Premium' && (
        <div className="bg-green-900/30 border border-green-700 rounded-xl p-3 text-sm text-green-300">
          💰 <strong>Low IV Environment</strong> — IV Rank {signals.iv_rank.toFixed(0)}%. Options are relatively cheap.
          Debit strategies (Long Call/Put, Spreads) offer good value.
        </div>
      )}
      {signals.volatility_regime === 'Neutral' && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-3 text-sm text-blue-300">
          📊 <strong>Moderate IV</strong> — IV Rank {signals.iv_rank.toFixed(0)}%. Spreads offer a balanced risk/reward.
        </div>
      )}

      {/* MA badges */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-gray-500 self-center">Moving Averages:</span>
        <MaBadge label={`MA20 $${signals.ma20.toFixed(0)}`} above={signals.above_ma20} />
        <MaBadge label={`MA50 $${signals.ma50.toFixed(0)}`} above={signals.above_ma50} />
        <MaBadge label={`MA200 $${signals.ma200.toFixed(0)}`} above={signals.above_ma200} />
        <span className={`text-xs px-2 py-1 rounded-full border font-medium
          ${signals.ma50_slope > 0 ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-red-900/40 text-red-400 border-red-800'}`}>
          MA50 slope: {signals.ma50_slope > 0 ? '↑' : '↓'} {signals.ma50_slope.toFixed(2)}%
        </span>
        <span className={`text-xs px-2 py-1 rounded-full border font-medium
          ${signals.macd_crossover === 'Bullish' ? 'bg-green-900/40 text-green-400 border-green-800'
            : signals.macd_crossover === 'Bearish' ? 'bg-red-900/40 text-red-400 border-red-800'
            : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
          MACD: {signals.macd_crossover === 'None' ? 'No crossover' : signals.macd_crossover + ' crossover'}
        </span>
      </div>
    </div>
  )
}
