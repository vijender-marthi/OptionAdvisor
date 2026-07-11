import { useRef, useState } from 'react'
import { Send, CheckCircle, MinusCircle, XCircle, RefreshCw } from 'lucide-react'
import { api, generatedApiPath } from '../api/client'
import type { ApiOperationId, ApiSchemas } from '../api/generated/openapi-types'

const DAY_TRADE_CHAT_OPERATION_IDS = {
  tradeCheck: 'day_trade_check_api_day_trade_check_post',
} as const satisfies Record<string, ApiOperationId>

interface Check {
  pass: boolean | null
  label: string
  msg: string
}

interface EvalResult {
  overall: 'TRADE' | 'CAUTION' | 'NO TRADE' | 'ERROR'
  overall_msg: string
  checks: Check[]
  ticker: string
  option_type: string
  strike: number
  dte: number
  contracts: number
  last_price: number
  verdict: string
  confidence: number
  parse_error?: string
  parse_notes?: string[]
}

interface Message {
  id: number
  role: 'user' | 'result'
  text: string
  result?: EvalResult
}

interface Props {
  dt: Record<string, string>
  currentTicker?: string
}

const EXAMPLES = [
  'Should I buy AMD 368 call, 5 DTE, 1 contract?',
  'NVDA 200 put 7 DTE 2 contracts — good idea?',
  'Planning to buy TSLA 250 call 10 DTE',
]

export default function DayTradeChat({ dt, currentTicker }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const idRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const nextId = () => ++idRef.current

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || loading) return

    const userMsg: Message = { id: nextId(), role: 'user', text: q }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const body: ApiSchemas['TradeCheckRequest'] = { message: q, ticker: currentTicker }
      const { data } = await api.post<EvalResult>(generatedApiPath(DAY_TRADE_CHAT_OPERATION_IDS.tradeCheck), body)
      setMessages(m => [...m, { id: nextId(), role: 'result', text: q, result: data }])
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Could not reach the server. Make sure the backend is running.'
      setMessages(m => [...m, {
        id: nextId(), role: 'result', text: q,
        result: { overall: 'ERROR', overall_msg: msg, checks: [], ticker: '', option_type: '', strike: 0, dte: 0, contracts: 1, last_price: 0, verdict: '', confidence: 0 },
      }])
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, gap: 12 }}>

      {/* Header hint */}
      <div style={{ fontSize: 12, color: dt.muted, lineHeight: 1.5 }}>
        Describe the trade you're considering. The engine evaluates it against the live scan rules — no AI, pure logic.
        {currentTicker && (
          <span style={{ marginLeft: 6, color: dt.accent, fontWeight: 600 }}>
            Current ticker: {currentTicker}
          </span>
        )}
      </div>

      {/* Examples */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: dt.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Try an example</div>
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => send(ex)} style={{
              textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: `1px solid ${dt.border}`,
              background: dt.bgDeep, color: dt.muted, fontSize: 12, cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = dt.accent; (e.target as HTMLButtonElement).style.color = dt.text }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = dt.border; (e.target as HTMLButtonElement).style.color = dt.muted }}
            >{ex}</button>
          ))}
        </div>
      )}

      {/* Message thread */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '80%', background: dt.accent + '22', border: `1px solid ${dt.accent}44`,
                  borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: 13, color: dt.text,
                }}>{msg.text}</div>
              </div>
            )}
            {msg.role === 'result' && msg.result && (
              <ResultCard result={msg.result} dt={dt} />
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: dt.muted, fontSize: 12 }}>
            <RefreshCw size={14} className="animate-spin" /> Evaluating trade…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={e => { e.preventDefault(); send(input) }} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={currentTicker ? `e.g. ${currentTicker} 368 call 5 DTE 1 contract` : 'e.g. AMD 368 call 5 DTE 1 contract'}
          disabled={loading}
          style={{
            flex: 1, padding: '9px 14px', borderRadius: 10, fontSize: 13,
            border: `1px solid ${dt.border}`, background: dt.bg, color: dt.text,
            outline: 'none',
          }}
        />
        <button type="submit" disabled={!input.trim() || loading} style={{
          padding: '9px 16px', borderRadius: 10, border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
          background: input.trim() && !loading ? dt.accent : dt.border,
          color: '#fff', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
          transition: 'background 0.15s',
        }}>
          <Send size={14} /> Check
        </button>
      </form>
    </div>
  )
}

function ResultCard({ result, dt }: { result: EvalResult; dt: Record<string, string> }) {
  const overallColor = result.overall === 'TRADE' ? dt.green
    : result.overall === 'CAUTION' ? dt.amber
    : result.overall === 'ERROR' ? dt.muted
    : dt.red

  return (
    <div style={{ border: `1px solid ${dt.border}`, borderRadius: 12, overflow: 'hidden', background: dt.bg }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', background: `${overallColor}18`, borderBottom: `1px solid ${dt.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontWeight: 800, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: overallColor, background: `${overallColor}22`, border: `1px solid ${overallColor}44`,
            padding: '2px 10px', borderRadius: 6,
          }}>{result.overall}</span>

          {result.ticker && (
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: dt.text }}>
              {result.ticker}
            </span>
          )}
          {result.strike > 0 && (
            <span style={{ fontSize: 12, color: dt.muted }}>
              ${result.strike} {result.option_type.toUpperCase()} · {result.dte} DTE · {result.contracts} contract{result.contracts !== 1 ? 's' : ''}
            </span>
          )}
          {result.last_price > 0 && (
            <span style={{ fontSize: 12, color: dt.muted, marginLeft: 'auto' }}>
              Price: <span style={{ fontFamily: 'monospace', color: dt.text }}>${result.last_price.toFixed(2)}</span>
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: dt.text, lineHeight: 1.5 }}>
          {result.overall_msg}
        </div>
        {result.verdict && (
          <div style={{ marginTop: 4, display: 'flex', gap: 8, fontSize: 11 }}>
            <span style={{ color: dt.muted }}>Engine: <b style={{ color: dt.text }}>{result.verdict}</b></span>
            <span style={{ color: dt.muted }}>Confidence: <b style={{ color: dt.text }}>{result.confidence}%</b></span>
          </div>
        )}
      </div>

      {/* Checks */}
      {result.checks.length > 0 && (
        <div style={{ padding: '10px 0' }}>
          {result.checks.map((c, i) => {
            const icon = c.pass === true
              ? <CheckCircle size={13} style={{ color: dt.green, flexShrink: 0 }} />
              : c.pass === false
              ? <XCircle size={13} style={{ color: dt.red, flexShrink: 0 }} />
              : <MinusCircle size={13} style={{ color: dt.amber, flexShrink: 0 }} />

            const rowBg = i % 2 === 0 ? `${dt.bgDeep}` : 'transparent'

            return (
              <div key={i} style={{
                display: 'flex', gap: 10, padding: '7px 16px', alignItems: 'flex-start',
                background: rowBg,
              }}>
                <div style={{ marginTop: 1 }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dt.text, marginRight: 6 }}>{c.label}</span>
                  <span style={{ fontSize: 12, color: dt.muted, lineHeight: 1.5 }}>{c.msg}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
