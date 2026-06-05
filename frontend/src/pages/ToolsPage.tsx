import { useState } from 'react'
import { AlertTriangle, Wrench } from 'lucide-react'

function OcoExplainer() {
  const [totalShares, setTotalShares] = useState('')
  const [pctA, setPctA]               = useState('')
  const [pctB, setPctB]               = useState('')
  const [sharesA, setSharesA]         = useState('')
  const [sharesB, setSharesB]         = useState('')
  const [currentPrice, setCurrentPrice] = useState('')

  const ts = parseFloat(totalShares) || 0
  const pa = parseFloat(pctA) || 0
  const pb = parseFloat(pctB) || 0
  const sa = parseFloat(sharesA) || ts
  const sb = parseFloat(sharesB) || ts
  const px = parseFloat(currentPrice) || 0

  const tighter  = Math.min(pa, pb)
  const wider    = Math.max(pa, pb)
  const overlap  = sa + sb > ts && ts > 0
  const stopA    = px > 0 ? px * (1 - pa / 100) : null
  const stopB    = px > 0 ? px * (1 - pb / 100) : null
  const suggestA = Math.round(ts * 0.6)
  const suggestB = ts - suggestA

  const labelCls = 'block text-xs font-semibold text-secondary mb-1'
  const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500'

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 space-y-4">
      <div>
        <h2 className="font-bold text-heading text-base">OCO Trailing Stop Conflict Checker</h2>
        <p className="text-xs text-secondary mt-1">
          When two trailing stop orders cover the same shares, only the tighter one executes — the other is cancelled automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="col-span-2 sm:col-span-1">
          <span className={labelCls}>Total Shares</span>
          <input type="number" min={1} value={totalShares}
            onChange={e => setTotalShares(e.target.value)}
            className={inputCls} placeholder="e.g. 100" />
        </label>
        <label>
          <span className={labelCls}>Current Price ($)</span>
          <input type="number" step="0.01" value={currentPrice}
            onChange={e => setCurrentPrice(e.target.value)}
            className={inputCls} placeholder="e.g. 185.00" />
        </label>
        <div className="col-span-2 sm:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label>
            <span className={labelCls}>Order A — Trail %</span>
            <input type="number" step="0.5" value={pctA}
              onChange={e => setPctA(e.target.value)}
              className={inputCls} placeholder="e.g. 8" />
          </label>
          <label>
            <span className={labelCls}>Order A — Shares</span>
            <input type="number" min={1} value={sharesA}
              onChange={e => setSharesA(e.target.value)}
              className={inputCls} placeholder={ts ? String(ts) : '—'} />
          </label>
          <label>
            <span className={labelCls}>Order B — Trail %</span>
            <input type="number" step="0.5" value={pctB}
              onChange={e => setPctB(e.target.value)}
              className={inputCls} placeholder="e.g. 10" />
          </label>
          <label>
            <span className={labelCls}>Order B — Shares</span>
            <input type="number" min={1} value={sharesB}
              onChange={e => setSharesB(e.target.value)}
              className={inputCls} placeholder={ts ? String(ts) : '—'} />
          </label>
        </div>
      </div>

      {ts > 0 && pa > 0 && pb > 0 && (
        <div className="space-y-3 pt-1">
          {/* Overlap warning */}
          {overlap && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2.5 text-sm text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-2">
                <AlertTriangle size={14} />
                WARNING: Both orders cover overlapping shares
              </p>
              <p>
                The <strong>{tighter}%</strong> trail triggers first at{' '}
                <strong>{stopA && stopB ? `$${(tighter === pa ? stopA : stopB).toFixed(2)}` : '—'}</strong>.
              </p>
              <p>The <strong>{wider}%</strong> order will be <strong>cancelled</strong>.</p>
              <p className="text-amber-400">To run both independently: split shares between the two orders.</p>
            </div>
          )}

          {/* Stop price display */}
          {px > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="rounded-lg border border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-muted mb-0.5">Order A — {pa}% trail</div>
                <div className="font-bold text-amber-400">{stopA ? `$${stopA.toFixed(2)}` : '—'}</div>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-muted mb-0.5">Order B — {pb}% trail</div>
                <div className="font-bold text-amber-400">{stopB ? `$${stopB.toFixed(2)}` : '—'}</div>
              </div>
            </div>
          )}

          {/* Split recommendation */}
          {ts > 0 && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-900/20 px-3 py-2.5 text-sm text-sky-300 space-y-1">
              <p className="font-semibold">Suggested split for independent execution:</p>
              <p>
                <span className="font-mono font-bold">{suggestA}</span> shares on {pa}% trail
                {' · '}
                <span className="font-mono font-bold">{suggestB}</span> shares on {pb}% trail
              </p>
              <p className="text-sky-400 text-xs">Both orders execute independently — neither cancels the other.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ToolsPage() {
  return (
    <div className="oa-cc-page max-w-3xl mx-auto p-4 md:p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-slate-600/20 border border-slate-600 flex items-center justify-center shrink-0">
            <Wrench size={18} className="text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">Tools</h1>
        </div>
        <p className="text-sm text-tertiary">Risk calculators and order management tools.</p>
      </header>

      <OcoExplainer />
    </div>
  )
}
