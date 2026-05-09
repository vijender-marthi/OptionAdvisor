import type { ReactNode } from 'react'
import { PositionCategoryPill, type HubCategoryKind } from './PositionHubCard'
import { getGuidanceToneClass } from '../utils/semanticTrading'

export function dayTradeToneBadgeClass(tone: string): string {
  return getGuidanceToneClass(tone)
}

export interface OpenPositionsFeedRow {
  key: string
  categoryKind: HubCategoryKind
  ticker: string
  strategy: string
  contracts: string
  expiry: string
  entryRef: string
  guidancePrimary: ReactNode
  guidanceSecondary?: string | null
  actions: ReactNode
}

/** Table shell aligned with Positions Center history / command-center row density. */
export default function OpenPositionsFeedTable({
  rows,
  emptyMessage,
}: {
  rows: OpenPositionsFeedRow[]
  emptyMessage: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800/45 bg-gray-950/22 shadow-[0_0_0_1px_rgba(255,255,255,0.015)]">
      <table className="oa-open-feed-table min-w-[960px] w-full text-sm text-left">
        <thead>
          <tr className="border-b border-gray-800/55 text-[11px] uppercase tracking-wide text-gray-500">
            <th className="py-2.5 px-3">Source</th>
            <th className="py-2.5 px-3">Ticker</th>
            <th className="py-2.5 px-3">Strategy</th>
            <th className="py-2.5 px-3">Contracts</th>
            <th className="py-2.5 px-3">Expiry</th>
            <th className="py-2.5 px-3">Entry</th>
            <th className="py-2.5 px-3 min-w-[10rem]">Live / guidance</th>
            <th className="py-2.5 px-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-10 px-3 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map(r => (
              <tr key={r.key} className="align-top border-b border-gray-800/40 hover:bg-gray-900/28">
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <PositionCategoryPill kind={r.categoryKind} />
                </td>
                <td className="py-2.5 px-3 font-semibold font-mono text-violet-300 whitespace-nowrap">{r.ticker}</td>
                <td className="py-2.5 px-3 text-gray-300">{r.strategy}</td>
                <td className="py-2.5 px-3 tabular-nums text-gray-400">{r.contracts}</td>
                <td className="py-2.5 px-3 text-xs tabular-nums text-gray-400">{r.expiry}</td>
                <td className="py-2.5 px-3 text-xs tabular-nums text-gray-300">{r.entryRef}</td>
                <td className="py-2.5 px-3 text-gray-300 min-w-[12rem]">
                  <div className="leading-snug">{r.guidancePrimary}</div>
                  {r.guidanceSecondary ? (
                    <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{r.guidanceSecondary}</div>
                  ) : null}
                </td>
                <td className="py-2.5 px-3 text-right">{r.actions}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
