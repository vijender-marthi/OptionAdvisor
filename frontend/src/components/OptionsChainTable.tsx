import { useState } from 'react'
import type { OptionRow } from '../types'

interface Props {
  calls: OptionRow[]
  puts: OptionRow[]
  currentPrice: number
}

function Table({ rows, currentPrice, type }: { rows: OptionRow[]; currentPrice: number; type: 'call' | 'put' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700 text-xs">
            <th className="text-right py-2 pr-4">Strike</th>
            <th className="text-right py-2 pr-4">Last</th>
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
            return (
              <tr key={i} className={`border-b border-gray-800/50 last:border-0 text-xs
                ${isAtm ? 'bg-violet-900/20' : isItm ? 'bg-gray-800/30' : ''}`}>
                <td className={`text-right py-1.5 pr-4 font-bold ${isAtm ? 'text-violet-300' : isItm ? 'text-gray-300' : 'text-gray-500'}`}>
                  ${row.strike.toFixed(1)}
                  {isAtm && <span className="ml-1 text-xs text-violet-400">ATM</span>}
                </td>
                <td className="text-right py-1.5 pr-4 text-white">${row.last_price.toFixed(2)}</td>
                <td className="text-right py-1.5 pr-4 text-gray-300">${row.bid.toFixed(2)}</td>
                <td className="text-right py-1.5 pr-4 text-gray-300">${row.ask.toFixed(2)}</td>
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

export default function OptionsChainTable({ calls, puts, currentPrice }: Props) {
  const [tab, setTab] = useState<'calls' | 'puts'>('calls')

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
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
