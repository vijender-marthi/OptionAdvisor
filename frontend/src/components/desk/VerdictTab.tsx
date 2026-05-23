import { BookOpen, Bell, Loader2 } from 'lucide-react'
import DayTradeEnginePanel from '../DayTradeEnginePanel'
import SwingTradeEnginePanel from '../SwingTradeEnginePanel'
import type { DayTradeScanResult, SwingTradeScanResult } from '../../api/client'
import type { DeskTradeLog } from '../../api/client'

type Analysis = (DayTradeScanResult & SwingTradeScanResult & { trade_type: string }) | null

interface Props {
  analysis: Analysis
  loading: boolean
  openTrade: DeskTradeLog | null
  onLogTrade: () => void
  onSetAlert: () => void
  onRefresh: () => void
  refreshing: boolean
}

export default function VerdictTab({
  analysis,
  loading,
  openTrade,
  onLogTrade,
  onSetAlert,
  onRefresh,
  refreshing,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-gray-500 text-sm">
        <Loader2 size={18} className="animate-spin" />
        Analyzing…
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-600">
        <span className="text-3xl">📊</span>
        <p className="text-sm">Add a ticker to see the verdict</p>
      </div>
    )
  }

  const isSwing = analysis.trade_type === 'swing'

  return (
    <div className="space-y-4">
      {isSwing ? (
        <SwingTradeEnginePanel
          result={analysis as SwingTradeScanResult}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      ) : (
        <DayTradeEnginePanel
          result={analysis as DayTradeScanResult}
          onRefresh={onRefresh}
          refreshing={refreshing}
          showRefresh={false}
        />
      )}

      {/* Action buttons */}
      <div className="flex gap-3 px-1 pb-4">
        <button
          type="button"
          onClick={onLogTrade}
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 font-semibold text-sm transition-colors ${
            openTrade
              ? 'border border-amber-600 text-amber-300 bg-amber-900/20 hover:bg-amber-900/30'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          <BookOpen size={15} />
          {openTrade ? 'Update Open Trade' : 'Log This Trade'}
        </button>
        <button
          type="button"
          onClick={onSetAlert}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 font-semibold text-sm border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] text-gray-300 transition-colors"
        >
          <Bell size={15} />
          Set Alert
        </button>
      </div>
    </div>
  )
}
