import { AlertTriangle, TrendingUp, TrendingDown, MinusCircle } from 'lucide-react'

// Mirrors backend day_trade_or_vwap.compute_or_vwap_framework output. Passed through
// the workspace response as `orVwapFramework` (see day_trade_workspace_models.py).
export type OrVwapTest = { value: number; label: string; detail: string; void?: string | null }
export type OrVwapFramework = {
  valid: boolean
  disabled: boolean
  invalidReason: string | null
  timing: { state: string; label: string; allowsNewEntry: boolean }
  components: {
    price: number | null; todayVwap: number | null; prevVwap: number | null
    orHigh: number | null; orLow: number | null; orMid: number | null; orRange: number | null
    vwapSlopePct: number | null; gapPct: number | null
  }
  tests: {
    priceVsVwap?: OrVwapTest
    vwapVsPrevVwap?: OrVwapTest
    priceVsOpeningRange?: OrVwapTest
  }
  modifiers: { vwapSlopePct: number; slopeDowngradedTest2: boolean; orMidLean: number; orMid: number | null }
  rawScore: number
  score: number
  direction: 'BULL' | 'BEAR' | 'NONE'
  conviction: string
  sizing: 'full' | 'half' | 'none'
  suspect: boolean
  read: string
  warnings: string[]
}

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '—')

function ScoreChip({ value }: { value: number }) {
  const tone = value > 0
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : value < 0
      ? 'bg-red-500/15 text-red-600 dark:text-red-300'
      : 'bg-slate-400/15 text-tertiary'
  return (
    <span className={`inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-md px-1 font-mono text-[11px] font-black ${tone}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  )
}

const TEST_ROWS: Array<{ key: keyof OrVwapFramework['tests']; n: number; question: string }> = [
  { key: 'priceVsVwap', n: 1, question: 'Price vs today’s VWAP' },
  { key: 'vwapVsPrevVwap', n: 2, question: 'Today’s VWAP vs prev VWAP' },
  { key: 'priceVsOpeningRange', n: 3, question: 'Price vs Opening Range' },
]

const SIZING_COPY: Record<OrVwapFramework['sizing'], string> = {
  full: 'Full size',
  half: 'Half size',
  none: 'No trade',
}

export default function DayTradeOrVwapFramework({ fw }: { fw: OrVwapFramework | null | undefined }) {
  if (!fw) {
    return <div className="text-xs text-tertiary">OR/VWAP framework is unavailable for this session.</div>
  }

  const bull = fw.direction === 'BULL'
  const bear = fw.direction === 'BEAR'
  const dirTone = bull
    ? 'text-emerald-700 dark:text-emerald-300'
    : bear
      ? 'text-red-600 dark:text-red-300'
      : 'text-tertiary'
  const DirIcon = bull ? TrendingUp : bear ? TrendingDown : MinusCircle
  const c = fw.components

  return (
    <div className="space-y-3">
      {/* Verdict header */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <DirIcon size={18} className={dirTone} />
          <div>
            <div className={`font-mono text-lg font-black leading-none ${dirTone}`}>
              {fw.score > 0 ? `+${fw.score}` : fw.score}
              <span className="ml-1 text-[10px] font-bold text-tertiary">/ ±3</span>
            </div>
            <div className={`text-[11px] font-bold ${dirTone}`}>
              {fw.valid ? `${fw.direction === 'NONE' ? 'No edge' : fw.direction} · ${SIZING_COPY[fw.sizing]}` : 'Score invalid'}
            </div>
          </div>
        </div>
        {fw.suspect && fw.valid && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Suspect
          </span>
        )}
      </div>

      {/* Read / invalid reason */}
      <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${fw.disabled ? 'bg-red-500/10 text-red-700 dark:text-red-300' : fw.valid ? 'bg-surface-muted text-secondary' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'}`}>
        {fw.read}
      </div>

      {/* Three tests */}
      <div className="space-y-1">
        {TEST_ROWS.map(row => {
          const t = fw.tests[row.key]
          return (
            <div key={row.n} className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5">
              <span className="mt-0.5 font-mono text-[10px] font-black text-tertiary">{row.n}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-heading">{row.question}</div>
                <div className="truncate text-[10px] text-tertiary">{t ? t.label : '—'}</div>
                {t?.detail && <div className="truncate font-mono text-[10px] text-tertiary">{t.detail}</div>}
              </div>
              <ScoreChip value={t?.value ?? 0} />
            </div>
          )
        })}
      </div>

      {/* Modifiers */}
      <div className="space-y-1 rounded-md border border-border/60 px-2 py-1.5 text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-tertiary">VWAP slope (30m)</span>
          <span className={`font-mono font-bold ${c.vwapSlopePct != null && c.vwapSlopePct > 0 ? 'text-emerald-600 dark:text-emerald-300' : c.vwapSlopePct != null && c.vwapSlopePct < 0 ? 'text-red-600 dark:text-red-300' : 'text-secondary'}`}>
            {c.vwapSlopePct != null ? `${c.vwapSlopePct > 0 ? '+' : ''}${c.vwapSlopePct.toFixed(3)}%` : '—'}
          </span>
        </div>
        {fw.modifiers.slopeDowngradedTest2 && (
          <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">Slope contradicts value migration → Test 2 downgraded to 0.</div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-tertiary">OR Mid tiebreaker</span>
          <span className="font-mono font-bold text-secondary">
            {money(c.orMid)} · {fw.modifiers.orMidLean > 0 ? 'above' : fw.modifiers.orMidLean < 0 ? 'below' : 'at'}
          </span>
        </div>
      </div>

      {/* Timing */}
      <div className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[10px] ${fw.timing.allowsNewEntry ? 'bg-surface-muted text-secondary' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'}`}>
        {!fw.timing.allowsNewEntry && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
        <span>{fw.timing.label}</span>
      </div>

      {/* Warnings */}
      {fw.warnings.length > 0 && (
        <div className="space-y-1">
          {fw.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Component values */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px]">
        {([
          ['Price', money(c.price)],
          ['Today VWAP', money(c.todayVwap)],
          ['Prev VWAP', money(c.prevVwap)],
          ['OR High', money(c.orHigh)],
          ['OR Low', money(c.orLow)],
          ['OR Range', c.orRange != null ? c.orRange.toFixed(2) : '—'],
          ['Gap %', c.gapPct != null ? `${c.gapPct > 0 ? '+' : ''}${c.gapPct.toFixed(2)}%` : '—'],
          ['Raw / Adj score', `${fw.rawScore > 0 ? '+' : ''}${fw.rawScore} → ${fw.score > 0 ? '+' : ''}${fw.score}`],
        ] as Array<[string, string]>).map(([label, val]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-tertiary">{label}</span>
            <span className="font-mono font-semibold text-secondary">{val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
