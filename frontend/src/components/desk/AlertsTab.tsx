import { Trash2 } from 'lucide-react'
import type { DeskAlert } from '../../api/client'

function alertDescription(a: DeskAlert): string {
  switch (a.alert_type) {
    case 'RVOL':
      return `RVOL > ${a.threshold_value ?? '?'}`
    case 'PRICE_CROSS':
      return `Price crosses $${a.threshold_value ?? '?'}`
    case 'VWAP_RETEST':
      return 'VWAP retest'
    case 'SIGNAL_ENTER':
      return `Signal → ${a.target_signal || 'ENTER'}`
    default:
      return a.alert_type
  }
}

function expiryCopy(expires: string): string {
  if (expires === 'eod') return 'Expires EOD'
  if (expires === 'tomorrow') return 'Expires tomorrow'
  if (expires === 'week') return 'Expires in 1 week'
  return `Expires ${expires}`
}

interface Props {
  alerts: DeskAlert[]
  history: DeskAlert[]
  onDelete: (id: string) => void
}

export default function AlertsTab({ alerts, history, onDelete }: Props) {
  return (
    <div className="space-y-6 pb-6">
      {/* Active alerts */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Active Alerts</h3>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-6">No active alerts</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-slate-900/40 px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono font-bold text-sm text-white">{a.ticker}</span>
                    <span className="text-xs text-gray-400">{alertDescription(a)}</span>
                  </div>
                  <div className="text-[11px] text-gray-600">{expiryCopy(a.expires)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(a.id)}
                  className="shrink-0 text-gray-600 hover:text-rose-400 transition-colors p-1"
                  aria-label="Delete alert"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Alert history */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Alert History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-4">No fired alerts yet</p>
        ) : (
          <div className="space-y-2">
            {history.map(a => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-slate-900/20 px-3 py-2.5 opacity-70"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono font-bold text-sm text-gray-300">{a.ticker}</span>
                    <span className="text-xs text-gray-500">{alertDescription(a)}</span>
                    {a.fired_value != null && (
                      <span className="text-[11px] text-gray-600">@ {a.fired_value.toFixed(2)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-600">
                    {a.fired_at && <span>Fired {a.fired_at.slice(0, 10)}</span>}
                    {a.action_taken && <span>· {a.action_taken}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
