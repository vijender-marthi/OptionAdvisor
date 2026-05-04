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
          <div className="font-semibold text-amber-300 mb-1">Alpaca Paper Trading Not Configured</div>
          <p className="text-sm text-amber-200/70 mb-3">
            Add your Alpaca Paper Trading API keys to the backend <code className="bg-amber-900/40 px-1 rounded text-xs">.env</code> file to enable automated trade execution.
          </p>
          <div className="bg-gray-900/60 rounded-xl p-3 text-xs text-gray-300 space-y-1">
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
          <div className="font-semibold text-white">{title}</div>
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
      <div className="text-center py-16 space-y-2">
        <div className="text-4xl">⚡</div>
        <div className="text-lg font-semibold text-gray-300">No open paper positions</div>
        <div className="text-sm text-gray-500">Execute a recommendation from Option Advisory to see it here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1.4fr_0.6fr_0.9fr_0.9fr_1fr_1fr_0.7fr] gap-3 px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
        <div>Symbol</div>
        <div className="text-right">Qty</div>
        <div className="text-right">Avg Entry</div>
        <div className="text-right">Current</div>
        <div className="text-right">Market Value</div>
        <div className="text-right">P&amp;L</div>
        <div className="text-right">Action</div>
      </div>
      {positions.map(p => {
        const isOption = p.asset_class === 'us_option'
        const plColor = p.unrealized_pl > 0 ? 'text-emerald-400' : p.unrealized_pl < 0 ? 'text-red-400' : 'text-gray-400'
        return (
          <div
            key={p.symbol}
            className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl overflow-hidden transition-colors"
          >
            <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-[1.4fr_0.6fr_0.9fr_0.9fr_1fr_1fr_0.7fr] sm:items-center">
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <div className="font-semibold text-white text-sm tracking-tight break-all">{p.symbol}</div>
                <div className="text-gray-600 text-[10px] mt-0.5">{isOption ? 'Option' : 'Equity'} · {p.side}</div>
              </div>
              <div className="text-xs sm:text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Qty</div>
                <div className="font-semibold text-gray-300">{p.qty}</div>
              </div>
              <div className="text-xs text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Avg Entry</div>
                <div className="font-semibold text-gray-300">{fmt$(p.avg_entry)}</div>
              </div>
              <div className="text-xs sm:text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Current</div>
                <div className="font-semibold text-gray-300">{fmt$(p.current_price)}</div>
              </div>
              <div className="text-xs text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Market Value</div>
                <div className="font-semibold text-gray-300">{fmt$(p.market_value)}</div>
              </div>
              <div className="text-xs sm:text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Unrealized</div>
                <div className={`font-semibold ${plColor}`}>{fmt$(p.unrealized_pl)}</div>
                <div className={`text-[10px] ${plColor}`}>{fmtPct(p.unrealized_plpc)}</div>
              </div>
              <div className="flex justify-end col-span-2 sm:col-span-1">
                <button
                  onClick={() => onClose(p.symbol)}
                  className="inline-flex h-9 items-center justify-center px-3 bg-gray-800 hover:bg-red-900/30 border border-gray-700
                             text-gray-400 hover:text-red-400 hover:border-red-800 rounded-xl text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Orders table ────────────────────────────────────────────────────────────

function OrdersTable({ orders, onCancel }: {
  orders: AlpacaOrder[]
  onCancel: (id: string) => void
}) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-16 space-y-2">
        <div className="text-4xl">📄</div>
        <div className="text-lg font-semibold text-gray-300">No recent orders</div>
        <div className="text-sm text-gray-500">Submitted paper trades will appear here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1.5fr_0.9fr_0.6fr_0.7fr_0.9fr_1fr_0.7fr] gap-3 px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
        <div>Symbol</div>
        <div>Status</div>
        <div className="text-right">Qty</div>
        <div className="text-right">Filled</div>
        <div className="text-right">Avg Fill</div>
        <div className="text-right">Submitted</div>
        <div className="text-right">Action</div>
      </div>
      {orders.map(o => {
        const statusColor = ORDER_STATUS_COLORS[o.status] ?? 'text-gray-400'
        const canCancel = ['new', 'accepted', 'pending_new', 'partially_filled'].includes(o.status)
        return (
          <div
            key={o.id}
            className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl overflow-hidden transition-colors"
          >
            <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-[1.5fr_0.9fr_0.6fr_0.7fr_0.9fr_1fr_0.7fr] sm:items-center">
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <div className="font-semibold text-white text-sm tracking-tight break-all">{o.symbol}</div>
                {o.strategy && <div className="text-gray-500 text-[10px] mt-0.5 truncate">{o.strategy}</div>}
              </div>
              <div className="text-xs">
                <div className="sm:hidden text-gray-600 mb-0.5">Status</div>
                <span className={`font-semibold ${statusColor}`}>{o.status}</span>
              </div>
              <div className="text-xs text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Qty</div>
                <div className="font-semibold text-gray-300">{o.qty}</div>
              </div>
              <div className="text-xs sm:text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Filled</div>
                <div className="font-semibold text-gray-300">{o.filled_qty ?? '0'}</div>
              </div>
              <div className="text-xs text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Avg Fill</div>
                <div className="font-semibold text-gray-400">{o.filled_avg_price ? fmt$(parseFloat(o.filled_avg_price)) : '—'}</div>
              </div>
              <div className="text-xs sm:text-right">
                <div className="sm:hidden text-gray-600 mb-0.5">Submitted</div>
                <div className="text-gray-500">{fmtDt(o.submitted_at)}</div>
              </div>
              <div className="flex justify-end col-span-2 sm:col-span-1">
                {canCancel ? (
                  <button
                    onClick={() => onCancel(o.id)}
                    className="inline-flex h-9 items-center justify-center px-3 bg-gray-800 border border-gray-700 text-gray-400
                               hover:border-red-800 hover:text-red-400 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                ) : <span className="text-gray-700 text-xs">—</span>}
              </div>
            </div>
          </div>
        )
      })}
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
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <Zap className="text-amber-400 shrink-0" size={22} />
              <span>Auto Trading</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-900/40 text-amber-300 border-amber-700">
                PAPER MODE
              </span>
            </h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-sm text-gray-500">Alpaca Paper Trading</span>
              {configured && account && (
                <>
                  <span className="text-xs text-gray-600">· {positions.length} position{positions.length !== 1 ? 's' : ''}</span>
                  <span className="text-xs text-gray-600">· {openOrdersCount} open order{openOrdersCount !== 1 ? 's' : ''}</span>
                </>
              )}
              {refreshing && (
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  <RefreshCw size={10} className="animate-spin" /> Refreshing…
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadAll(true)}
              disabled={refreshing || loading}
              aria-label={refreshing ? 'Refreshing trading data' : 'Refresh trading data'}
              title="Refresh account, positions, and orders"
              className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-400 hover:text-gray-200 hover:border-gray-600 rounded-xl
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => navigate('ticker')}
              aria-label="Open Option Advisory"
              title="Open Option Advisory"
              className="inline-flex h-10 w-10 items-center justify-center bg-violet-600 hover:bg-violet-500
                         text-white rounded-xl transition-colors shrink-0"
            >
              <TrendingUp size={18} />
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
                  <div className="text-xl font-semibold text-white truncate">{fmt$(account.equity)}</div>
                  <div className="text-xs text-gray-600 mt-1 truncate">{account.currency} · {account.status}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                    <BarChart3 size={12} className="opacity-70 shrink-0" /> Options BP
                  </div>
                  <div className="text-xl font-semibold text-violet-400 truncate">{fmt$(account.buying_power)}</div>
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
                  <div className={`text-xl font-semibold truncate ${
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
                  <div className={`text-xl font-semibold truncate ${openOrdersCount > 0 ? 'text-blue-400' : 'text-gray-400'}`}>
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

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
                <div className="flex items-center gap-2">
                  {([
                    ['positions', 'Positions', positions.length] as const,
                    ['orders', 'Orders', orders.length] as const,
                  ]).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                        tab === key
                          ? 'bg-violet-900/50 text-violet-300 border-violet-700'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                      }`}
                    >
                      {label}
                      <span className={`ml-1 ${tab === key ? 'text-violet-200' : 'text-gray-600'}`}>{count}</span>
                    </button>
                  ))}
                  <div className="h-px flex-1 bg-gray-800/70" />
                </div>
                <span className="text-[10px] text-gray-600">
                  {tab === 'positions'
                    ? 'Market close sends a paper liquidating order'
                    : 'Recent fills, cancellations, and rejections'}
                </span>
              </div>
              {tab === 'positions' ? (
                <PositionsTable positions={positions} onClose={handleClosePosition} />
              ) : (
                <OrdersTable orders={orders} onCancel={handleCancelOrder} />
              )}
            </section>
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
