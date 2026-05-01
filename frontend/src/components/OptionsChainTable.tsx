import { useState } from 'react'
import type { OptionRow } from '../types'

interface Props {
  calls: OptionRow[]
  puts: OptionRow[]
  currentPrice: number
  expiry?: string   // e.g. "2026-05-29" — shown in the header
}

function qualityBadge(quality?: string, reason?: string) {
  if (!quality || quality === 'OK') return null
  const isUnreliable = quality === 'UNRELIABLE'
  const isModel = quality === 'MODEL'
  return (
    <span
      title={reason || quality}
      className={`ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide cursor-help
        ${isUnreliable
          ? 'bg-red-900/60 text-red-300 border border-red-700'
          : isModel
          ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
          : 'bg-yellow-900/60 text-yellow-300 border border-yellow-700'}`}
    >
      {isUnreliable ? '⚠ Bad' : isModel ? 'Model' : '⚠ Stale'}
    </span>
  )
}

function formatExpiry(expiry?: string): string {
  if (!expiry) return ''
  try {
    const d = new Date(expiry + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return expiry
  }
}

function dte(expiry?: string): number | null {
  if (!expiry) return null
  const diff = new Date(expiry + 'T00:00:00').getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

function Table({ rows, currentPrice, type }: { rows: OptionRow[]; currentPrice: number; type: 'call' | 'put' }) {
  const staleCount = rows.filter(r => r.data_quality && !['OK', 'MODEL'].includes(r.data_quality)).length

  return (
    <div className="overflow-x-auto">
      {staleCount > 0 && (
        <div className="mb-2 px-2 py-1.5 bg-yellow-900/20 border border-yellow-700/40 rounded-lg text-xs text-yellow-300 flex items-center gap-1.5">
          <span>⚠</span>
          <span>{staleCount} row{staleCount > 1 ? 's' : ''} have stale or unreliable quotes — verify on your broker before trading.</span>
        </div>
      )}
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700 text-xs">
            <th className="text-right py-2 pr-4">Strike</th>
            <th className="text-right py-2 pr-4">Mid</th>
            <th className="text-right py-2 pr-4">Bid</th>
            <th className="text-right py-2 pr-4">Ask</th>
            <th className="text-right py-2 pr-4">Volume</th>
            <th className="text-right py-2 pr-4">OI</th>
            <th className="text-right py-2 pr-4">IV</th>
            <th className="text-right py-2">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isAtm = Math.abs(row.strike - currentPrice) === Math.min(...rows.map(r => Math.abs(r.strike - currentPrice)))
            const isItm = type === 'call' ? row.strike <= currentPrice : row.strike >= currentPrice
            const mid = row.bid > 0 && row.ask > 0 ? (row.bid + row.ask) / 2 : row.last_price
            const isStale = row.data_quality && !['OK', 'MODEL'].includes(row.data_quality)
            return (
              <tr key={i} className={`border-b border-gray-800/50 last:border-0 text-xs
                ${isAtm ? 'bg-violet-900/20' : isItm ? 'bg-gray-800/30' : ''}
                ${isStale ? 'opacity-60' : ''}`}>
                <td className={`text-right py-1.5 pr-4 font-bold ${isAtm ? 'text-violet-300' : isItm ? 'text-gray-300' : 'text-gray-500'}`}>
                  ${row.strike.toFixed(1)}
                  {isAtm && <span className="ml-1 text-xs text-violet-400">ATM</span>}
                </td>
                <td className="text-right py-1.5 pr-4 text-white">
                  ${mid.toFixed(2)}
                  {qualityBadge(row.data_quality, row.data_quality_reason)}
                </td>
                <td className="text-right py-1.5 pr-4 text-gray-300">{row.bid > 0 ? `$${row.bid.toFixed(2)}` : '—'}</td>
                <td className="text-right py-1.5 pr-4 text-gray-300">{row.ask > 0 ? `$${row.ask.toFixed(2)}` : '—'}</td>
                <td className="text-right py-1.5 pr-4 text-gray-400">{row.volume.toLocaleString()}</td>
                <td className="text-right py-1.5 pr-4 text-gray-400">{row.open_interest.toLocaleString()}</td>
                <td className="text-right py-1.5 pr-4 text-amber-400">{row.implied_volatility}</td>
                <td className="text-right py-1.5 text-blue-400">{row.delta != null ? row.delta.toFixed(3) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function OptionsChainTable({ calls, puts, currentPrice, expiry }: Props) {
  const [tab, setTab] = useState<'calls' | 'puts'>('calls')
  const daysLeft = dte(expiry)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Expiry date header */}
      {expiry && (
        <div className="flex items-center justify-between px-4 pt-3 pb-1 border-b border-gray-800/60">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Expiry</span>
            <span className="text-xs font-bold text-white">{formatExpiry(expiry)}</span>
          </div>
          {daysLeft !== null && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
              ${daysLeft <= 7  ? 'bg-red-900/40 text-red-300' :
                daysLeft <= 21 ? 'bg-amber-900/40 text-amber-300' :
                                 'bg-gray-700 text-gray-300'}`}>
              {daysLeft}d to expiry
            </span>
          )}
        </div>
      )}

      {/* Calls / Puts tabs */}
      <div className="flex border-b border-gray-800">
        {(['calls', 'puts'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold capitalize transition-colors
              ${tab === t ? 'text-white border-b-2 border-violet-500 bg-gray-800/50' : 'text-gray-400 hover:text-white'}`}>
            {t} ({t === 'calls' ? calls.length : puts.length})
          </button>
        ))}
      </div>
      <div className="p-4">
        <Table rows={tab === 'calls' ? calls : puts} currentPrice={currentPrice} type={tab === 'calls' ? 'call' : 'put'} />
      </div>
    </div>
  )
}
