import { useState, useCallback, type ReactNode } from 'react'
import { Sparkles, Loader2, AlertTriangle, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { analyzeAICoach, type AICoachMode } from '../api/client'

// Minimal, safe Markdown renderer for the subset the coach emits
// (headings, bullets, **bold**, paragraphs). No raw HTML injection.
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? <strong key={`${keyBase}-b${i}`}>{part}</strong> : <span key={`${keyBase}-s${i}`}>{part}</span>,
  )
}

function CoachMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let bullets: ReactNode[] = []
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`ul-${out.length}`} className="my-1.5 ml-4 list-disc space-y-1">{bullets}</ul>)
      bullets = []
    }
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); return }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      bullets.push(<li key={`li-${idx}`} className="text-sm leading-relaxed text-text-secondary">{renderInline(bullet[1], `li-${idx}`)}</li>)
      return
    }
    flush()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(<div key={`h-${idx}`} className="mt-2 text-[13px] font-black uppercase tracking-wide text-text-primary">{renderInline(h[2], `h-${idx}`)}</div>)
      return
    }
    out.push(<p key={`p-${idx}`} className="my-1 text-sm leading-relaxed text-text-secondary">{renderInline(line, `p-${idx}`)}</p>)
  })
  flush()
  return <div>{out}</div>
}

export default function AICoachWidget({
  mode,
  title,
  context,
  heading = 'AI Coach',
  subtitle,
  compact = false,
}: {
  mode: AICoachMode
  title?: string
  /** Current data to analyze, or a function returning it at click time. */
  context: unknown | (() => unknown)
  heading?: string
  subtitle?: string
  compact?: boolean
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ markdown: string; provider: string; model: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ctx = typeof context === 'function' ? (context as () => unknown)() : context
      const data = await analyzeAICoach({ mode, title, context: ctx })
      setResult(data)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string }; status?: number } })?.response
      if (detail?.status === 409) {
        setError('NOT_CONFIGURED')
      } else {
        setError(detail?.data?.detail || 'The AI Coach request failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [context, mode, title])

  return (
    <section className={`rounded-xl border border-violet-300/70 bg-violet-50/60 dark:border-violet-500/30 dark:bg-violet-500/[0.06] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white">
            <Sparkles size={15} />
          </span>
          <div>
            <div className="text-sm font-black text-text-primary">{heading}</div>
            {subtitle && <div className="text-[11px] text-text-tertiary">{subtitle}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {loading ? 'Analyzing…' : result ? 'Re-analyze' : 'Ask AI Coach'}
        </button>
      </div>

      {error === 'NOT_CONFIGURED' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={14} />
          <span>AI Coach isn’t set up yet. Add your Claude, OpenAI, or Gemini API key in Settings.</span>
          <button type="button" onClick={() => navigate('/settings')} className="inline-flex items-center gap-1 font-bold text-violet-700 underline dark:text-violet-300">
            <SettingsIcon size={12} /> Open Settings
          </button>
        </div>
      )}
      {error && error !== 'NOT_CONFIGURED' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
          <CoachMarkdown text={result.markdown} />
          <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-text-tertiary dark:border-white/[0.06]">
            Generated by {result.provider} · {result.model} — educational analysis, not financial advice.
          </div>
        </div>
      )}
    </section>
  )
}
