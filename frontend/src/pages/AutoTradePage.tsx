import { useState, useEffect, useCallback } from 'react'
import {
  Zap, RefreshCw, AlertTriangle, DollarSign,
  TrendingUp, TrendingDown, Settings, ExternalLink, X,
  ShieldAlert, BarChart3, Clock,
} from 'lucide-react'
import {
  getTradingStatus, getTradingPositions, getTradingOrders,
  cancelTradingOrder, closeTradingPosition,
  type AlpacaAccount, type AlpacaPosition, type AlpacaOrder,
} from '../api/client'
import { useApp } from '../contexts/AppContext'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, decimals = 2): string {
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (n < 0 ? '−$' : '$') + str
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%'
}

function fmtDt(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return iso }
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  filled:            'text-emerald-400',
  partially_filled:  'text-amber-400',
  new:               'text-blue-400',
  accepted:          'text-blue-400',
  pending_new:       'text-blue-300',
  canceled:          'text-gray-500',
  expired:           'text-gray-500',
  rejected:          'text-red-400',
}

// ─── Setup banner ────────────────────────────────────────────────────────────

function SetupBanner() {
  return (
    <div className="bg-amber-950/30 border border-amber-800/60 rounded-2xl px-4 py-5 md:p-5">
      <div className="flex items-start gap-3">
        <Settings size={20} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold text-amber-300 mb-1">Alpaca Paper Trading Not Configured</div>
          <p className="text-sm text-amber-200/70 mb-3">
            Add your Alpaca Paper Trading API keys to the backend <code className="bg-amber-900/40 px-1 rounded text-xs">.env</code> file to enable automated trade execution.
          </p>
          <div className="bg-gray-900/60 rounded-xl p-3 font-mono text-xs text-gray-300 space-y-1">
            <div><span className="text-violet-400">ALPACA_API_KEY</span>=your-paper-api-key-id</div>
            <div><span className="text-violet-400">ALPACA_SECRET_KEY</span>=your-paper-secret-key</div>
          </div>
          <p className="text-xs text-amber-200/50 mt-3">
            Get your free paper trading keys at{' '}
            <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer"
               className="text-amber-300 underline hover:text-amber-200 inline-flex items-center gap-1">
              alpaca.markets <ExternalLink size={10} />
            </a>
            {' '}→ Paper Trading → API Keys. Restart the backend after adding keys.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm modal ───────────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel, confirmClass, onConfirm, onCancel, loading }: {
  title: string; body: string; confirmLabel: string; confirmClass: string
  onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-white">{title}</div>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <p className="text-sm text-gray-400 mb-4">{body}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-800 text-gray-400 text-sm rounded-lg hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className={`flex-1 px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 ${confirmClass}`}>
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Positions table ─────────────────────────────────────────────────────────

function PositionsTable({ positions, onClose }: {
  positions: AlpacaPosition[]
  onClose: (symbol: string) => void
}) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 text-sm">
        No open positions on the paper account.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[44rem]">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left pb-2 pr-3">Symbol</th>
            <th className="text-right pb-2 pr-3">Qty</th>
            <th className="text-right pb-2 pr-3">Avg Entry</th>
            <th className="text-right pb-2 pr-3">Current</th>
            <th className="text-right pb-2 pr-3">Mkt Value</th>
            <th className="text-right pb-2 pr-3">Unreal. P&L</th>
            <th className="text-right pb-2 pr-3">P&L %</th>
            <th className="text-right pb-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => {
            const isOption = p.asset_class === 'us_option'
            const plColor = p.unrealized_pl > 0 ? 'text-emerald-400' : p.unrealized_pl < 0 ? 'text-red-400' : 'text-gray-400'
            return (
              <tr key={p.symbol} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/20">
                <td className="py-2 pr-3">
                  <div className="font-mono text-white text-[11px] break-all">{p.symbol}</div>
                  <div className="text-gray-600 text-[10px] mt-0.5">{isOption ? 'Option' : 'Equity'} · {p.side}</div>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{p.qty}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{fmt$(p.avg_entry)}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{fmt$(p.current_price)}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{fmt$(p.market_value)}</td>
                <td className={`py-2 pr-3 text-right font-mono font-bold ${plColor}`}>{fmt$(p.unrealized_pl)}</td>
                <td className={`py-2 pr-3 text-right font-mono ${plColor}`}>{fmtPct(p.unrealized_plpc)}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => onClose(p.symbol)}
                    className="px-2 py-1 bg-red-900/30 border border-red-800 text-red-400 rounded-lg text-[10px] font-semibold hover:bg-red-900/50 transition-colors"
                  >
                    Close
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Orders table ────────────────────────────────────────────────────────────

function OrdersTable({ orders, onCancel }: {
  orders: AlpacaOrder[]
  onCancel: (id: string) => void
}) {
  if (orders.length === 0) {
    return <div className="text-center py-8 text-gray-600 text-sm">No recent orders.</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[48rem]">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left pb-2 pr-3">Symbol / Strategy</th>
            <th className="text-left pb-2 pr-3">Status</th>
            <th className="text-right pb-2 pr-3">Qty</th>
            <th className="text-right pb-2 pr-3">Filled</th>
            <th className="text-right pb-2 pr-3">Avg Fill</th>
            <th className="text-right pb-2 pr-3">Submitted</th>
            <th className="text-right pb-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => {
            const statusColor = ORDER_STATUS_COLORS[o.status] ?? 'text-gray-400'
            const canCancel = ['new', 'accepted', 'pending_new', 'partially_filled'].includes(o.status)
            return (
              <tr key={o.id} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/20">
                <td className="py-2 pr-3">
                  <div className="font-mono text-white text-[11px]">{o.symbol}</div>
                  {o.strategy && <div className="text-gray-500 text-[10px] mt-0.5">{o.strategy}</div>}
                </td>
                <td className="py-2 pr-3">
                  <span className={`font-semibold ${statusColor}`}>{o.status}</span>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{o.qty}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-300">{o.filled_qty ?? '0'}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-400">
                  {o.filled_avg_price ? fmt$(parseFloat(o.filled_avg_price)) : '—'}
                </td>
                <td className="py-2 pr-3 text-right text-gray-500">{fmtDt(o.submitted_at)}</td>
                <td className="py-2 text-right">
                  {canCancel ? (
                    <button
                      onClick={() => onCancel(o.id)}
                      className="px-2 py-1 bg-gray-800 border border-gray-700 text-gray-400 rounded-lg text-[10px] font-semibold hover:border-red-700 hover:text-red-400 transition-colors"
                    >
                      Cancel
                    </button>
                  ) : <span className="text-gray-700">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = 'positions' | 'orders'

export default function AutoTradePage() {
  const { user, navigate } = useApp()
  const email = user?.email ?? ''

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [account, setAccount]       = useState<AlpacaAccount | null>(null)
  const [positions, setPositions]   = useState<AlpacaPosition[]>([])
  const [orders, setOrders]         = useState<AlpacaOrder[]>([])
  const [tab, setTab]               = useState<Tab>('positions')
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Confirm modal state
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string; body: string; confirmLabel: string; confirmClass: string; fn: () => Promise<void>
  }>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  const loadAll = useCallback(async (isRefresh = false) => {
    if (!email) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const status = await getTradingStatus(email)
      setConfigured(status.configured)
      if (!status.configured) {
        setAccount(null)
        setPositions([])
        setOrders([])
        return
      }
      if (status.alpaca_error) {
        setError(status.alpaca_error)
        setAccount(null)
        setPositions([])
        setOrders([])
        return
      }
      setAccount(status.account ?? null)
      const [pos, ord] = await Promise.all([
        getTradingPositions(email),
        getTradingOrders(email, 'all'),
      ])
      setPositions(pos)
      setOrders(ord)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load trading data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [email])

  useEffect(() => { loadAll() }, [loadAll])

  const handleClosePosition = (symbol: string) => {
    setConfirmAction({
      title: 'Close Position',
      body: `Close (liquidate) position ${symbol} at market price? This action cannot be undone.`,
      confirmLabel: 'Close Position',
      confirmClass: 'bg-red-600 hover:bg-red-500',
      fn: async () => {
        await closeTradingPosition(email, symbol)
        await loadAll(true)
      },
    })
  }

  const handleCancelOrder = (orderId: string) => {
    setConfirmAction({
      title: 'Cancel Order',
      body: `Cancel this open order? Any unfilled portion will be cancelled immediately.`,
      confirmLabel: 'Cancel Order',
      confirmClass: 'bg-red-600 hover:bg-red-500',
      fn: async () => {
        await cancelTradingOrder(email, orderId)
        await loadAll(true)
      },
    })
  }

  const executeConfirm = async () => {
    if (!confirmAction) return
    setConfirmLoading(true)
    try {
      await confirmAction.fn()
      setConfirmAction(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed')
      setConfirmAction(null)
    } finally {
      setConfirmLoading(false)
    }
  }

  // ── Derived stats ────────────────────────────────────────────────────────

  const totalUnrealizedPL = positions.reduce(
    (s, p) => s + (typeof p.unrealized_pl === 'number' ? p.unrealized_pl : 0),
    0,
  )
  const optionPositions    = positions.filter(p => p.asset_class === 'us_option')
  const openOrdersCount    = orders.filter(o => ['new','accepted','pending_new','partially_filled'].includes(o.status)).length
  const filledToday        = orders.filter(o => o.status === 'filled' && o.filled_at?.startsWith(new Date().toISOString().slice(0,10))).length

  return (
    <div className="auto-trade-page min-h-screen p-4 md:p-6">
      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          {...confirmAction}
          loading={confirmLoading}
          onConfirm={executeConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header — matches Portfolio: column on mobile, row + actions from sm */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
              <Zap className="text-amber-400 shrink-0" size={22} />
              <span>Auto Trading</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-900/40 text-amber-300 border-amber-700">
                PAPER MODE
              </span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Alpaca Paper Trading · Admin only · Live orders and positions from your paper account
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => loadAll(true)}
              disabled={refreshing || loading}
              aria-label={refreshing ? 'Refreshing trading data' : 'Refresh trading data'}
              title="Refresh account, positions, and orders"
              className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-300 hover:text-amber-300 hover:border-amber-700 rounded-xl
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => navigate('ticker')}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <TrendingUp size={14} /> Option Advisory
            </button>
          </div>
        </div>

        {/* Admin notice */}
        <div className="flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
          <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400 leading-relaxed">
            <span className="font-semibold text-amber-400/90">Admin-only.</span>{' '}
            Executions use Alpaca Paper Trading only — no real capital at risk. Configure API keys in the backend{' '}
            <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">.env</code>.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm text-red-300">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <RefreshCw size={28} className="animate-spin mb-3 text-gray-500" />
            <span className="text-sm text-gray-500">Connecting to Alpaca…</span>
          </div>
        ) : configured === false ? (
          <SetupBanner />
        ) : account ? (
          <>
            {/* Summary stats — same card shell as Portfolio summary */}
            {account && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                    <DollarSign size={12} className="opacity-70 shrink-0" /> Equity
                  </div>
                  <div className="text-xl font-bold font-mono text-white truncate">{fmt$(account.equity)}</div>
                  <div className="text-xs text-gray-600 mt-1 truncate">{account.currency} · {account.status}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                    <BarChart3 size={12} className="opacity-70 shrink-0" /> Options BP
                  </div>
                  <div className="text-xl font-bold font-mono text-violet-400 truncate">{fmt$(account.buying_power)}</div>
                  <div className="text-xs text-gray-600 mt-1">Available for options</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                    {totalUnrealizedPL >= 0 ? (
                      <TrendingUp size={12} className="opacity-70 shrink-0 text-emerald-500" />
                    ) : (
                      <TrendingDown size={12} className="opacity-70 shrink-0 text-red-500" />
                    )}
                    Unrealized P&amp;L
                  </div>
                  <div className={`text-xl font-bold font-mono truncate ${
                    totalUnrealizedPL > 0 ? 'text-emerald-400' : totalUnrealizedPL < 0 ? 'text-red-400' : 'text-gray-400'
                  }`}>{fmt$(totalUnrealizedPL)}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {optionPositions.length} option position{optionPositions.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                    <Clock size={12} className="opacity-70 shrink-0" /> Open orders
                  </div>
                  <div className={`text-xl font-bold font-mono truncate ${openOrdersCount > 0 ? 'text-blue-400' : 'text-gray-400'}`}>
                    {openOrdersCount}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{filledToday} filled today</div>
                </div>
              </div>
            )}

            {account && account.options_approved_level < 2 && (
              <div className="bg-amber-950/30 border border-amber-800/50 rounded-2xl px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200/90">
                  <span className="font-semibold text-amber-300">Options level {account.options_approved_level}</span>
                  {' — '}multi-leg spreads need level 2+. Enable in your Alpaca account settings.
                </div>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-start gap-3">
              <Zap size={16} className="text-violet-400 shrink-0 mt-0.5" />
              <p className="text-sm text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-300">Execute trades:</span>{' '}
                Use <strong className="text-violet-300">Option Advisory</strong>, expand a recommendation, then{' '}
                <strong className="text-violet-300">Execute Paper Trade</strong> (admins). Orders show under{' '}
                <span className="text-gray-300">Recent Orders</span>.
              </p>
            </div>

            {/* Tabs — Portfolio-style segmented control */}
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit flex-wrap">
              {([
                ['positions', 'Positions', positions.length] as const,
                ['orders', 'Orders', orders.length] as const,
              ]).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    tab === key
                      ? 'bg-violet-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {label}{' '}
                  <span className={`font-mono ${tab === key ? 'opacity-90' : 'text-gray-600'}`}>({count})</span>
                </button>
              ))}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="border-b border-gray-800 px-4 py-3 md:px-5">
                <h2 className="text-sm font-semibold text-gray-300">
                  {tab === 'positions' ? 'Paper positions' : 'Order history'}
                </h2>
                <p className="text-xs text-gray-600 mt-0.5">
                  {tab === 'positions'
                    ? 'Open contracts on your Alpaca paper account. Close sends a market liquidating order.'
                    : 'Recent submissions including fills, cancellations, and rejections.'}
                </p>
              </div>
              <div className="p-4 md:p-5">
                {tab === 'positions' ? (
                  <PositionsTable positions={positions} onClose={handleClosePosition} />
                ) : (
                  <OrdersTable orders={orders} onCancel={handleCancelOrder} />
                )}
              </div>
            </div>
          </>
        ) : null}

        <div className="text-center text-xs text-gray-600 py-2 border-t border-gray-800/50">
          <span className="inline-flex items-center gap-1 justify-center flex-wrap">
            <DollarSign size={11} className="shrink-0 opacity-70" />
            Paper trading only. Prices and fills are simulated. Not financial advice.
          </span>
        </div>
      </div>
    </div>
  )
}
