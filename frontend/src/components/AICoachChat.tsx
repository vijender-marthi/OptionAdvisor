import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Send, Loader2, AlertTriangle, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { analyzeAICoach } from '../api/client'

// Minimal, safe Markdown (headings, bullets, **bold**) — no raw HTML.
function renderInline(text: string, k: string): ReactNode[] {
  return text.split('**').map((p, i) => i % 2 === 1 ? <strong key={`${k}-b${i}`}>{p}</strong> : <span key={`${k}-s${i}`}>{p}</span>)
}
function CoachMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let bullets: ReactNode[] = []
  const flush = () => { if (bullets.length) { out.push(<ul key={`ul-${out.length}`} className="my-1.5 ml-4 list-disc space-y-1">{bullets}</ul>); bullets = [] } }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); return }
    const b = line.match(/^\s*[-*]\s+(.*)$/)
    if (b) { bullets.push(<li key={`li-${idx}`} className="text-sm leading-relaxed text-text-secondary">{renderInline(b[1], `li-${idx}`)}</li>); return }
    flush()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { out.push(<div key={`h-${idx}`} className="mt-2 text-[13px] font-black uppercase tracking-wide text-text-primary">{renderInline(h[2], `h-${idx}`)}</div>); return }
    out.push(<p key={`p-${idx}`} className="my-1 text-sm leading-relaxed text-text-secondary">{renderInline(line, `p-${idx}`)}</p>)
  })
  flush()
  return <div>{out}</div>
}

type Msg = { role: 'user' | 'coach'; text: string; meta?: string }

const STARTERS = [
  'Review my current watchlist for the best swing setup.',
  'How should I size a $1K earnings play?',
  'Is holding through earnings worth the IV crush?',
]

/** The chat surface, shared by the AI Coach page and the floating panel. */
export default function AICoachChat({ getContext }: { getContext?: () => unknown }) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, loading])

  const send = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: q }])
    setLoading(true); setNotConfigured(false)
    try {
      const ctx = getContext ? getContext() : { note: 'General trading question — no page context attached.' }
      const data = await analyzeAICoach({ mode: 'recommendation', question: q, context: ctx })
      setMessages(m => [...m, { role: 'coach', text: data.markdown, meta: `${data.provider} · ${data.model}` }])
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { detail?: string } } })?.response
      if (resp?.status === 409) setNotConfigured(true)
      else setMessages(m => [...m, { role: 'coach', text: resp?.data?.detail || 'The AI Coach request failed. Please try again.' }])
    } finally { setLoading(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !notConfigured && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Sparkles size={15} className="text-violet-500" />Ask about a setup, sizing, risk, or your plan. Educational — not financial advice.</div>
            <div className="flex flex-col gap-1.5">
              {STARTERS.map(s => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-lg border border-border px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-muted">{s}</button>
              ))}
            </div>
          </div>
        )}
        {notConfigured && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle size={14} />AI Coach isn’t set up. Add your Claude, OpenAI, or Gemini API key in Settings.
            <button type="button" onClick={() => navigate('/settings')} className="inline-flex items-center gap-1 font-bold text-violet-700 underline dark:text-violet-300"><SettingsIcon size={12} /> Open Settings</button>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.role === 'user'
              ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white'
              : 'max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-surface-card px-3 py-2'}>
              {m.role === 'user' ? m.text : <><CoachMarkdown text={m.text} />{m.meta && <div className="mt-1 border-t border-border pt-1 text-[10px] text-text-tertiary">{m.meta} — not financial advice.</div>}</>}
            </div>
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-xs text-text-tertiary"><Loader2 size={13} className="animate-spin" />Coach is thinking…</div>}
      </div>
      <div className="flex items-end gap-2 border-t border-border p-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="Ask the coach…  (Enter to send, Shift+Enter for a new line)"
          rows={1}
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-violet-500 focus:outline-none"
        />
        <button type="button" onClick={() => void send()} disabled={loading || !input.trim()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}
