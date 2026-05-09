import { useEffect, useState } from 'react'
import { BarChart2 } from 'lucide-react'
import { authActivate } from '../api/client'
import ThemeToggle from '../components/ThemeToggle'
import CopyrightFooter from '../components/CopyrightFooter'
import { useApp } from '../contexts/AppContext'

function tokenFromLocation(): string {
  const q = new URLSearchParams(window.location.search).get('token')
  if (q?.trim()) return q.trim()
  const raw = window.location.hash.replace(/^#/, '')
  const qs = raw.split('?')[1]
  return new URLSearchParams(qs || '').get('token')?.trim() ?? ''
}

function activationDetail(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const d = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
    if (typeof d === 'string') return d
  }
  return 'Activation failed.'
}

/**
 * One shared in-flight request per token. React Strict Mode double-mounts effects in dev; without this,
 * the first call activates (clears token) and the second returns "Invalid or expired", overwriting UI.
 */
const activationByToken = new Map<string, Promise<{ ok: boolean; message: string }>>()

function activateOnce(token: string): Promise<{ ok: boolean; message: string }> {
  let p = activationByToken.get(token)
  if (!p) {
    p = authActivate(token)
      .then(res => ({ ok: true, message: res.message }))
      .catch(err => ({ ok: false, message: activationDetail(err) }))
      .finally(() => {
        setTimeout(() => activationByToken.delete(token), 30_000)
      })
    activationByToken.set(token, p)
  }
  return p
}

export default function ActivatePage() {
  const { navigate } = useApp()
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const token = tokenFromLocation()
      if (!token) {
        setStatus('err')
        setMessage('Missing activation token.')
        return
      }
      const result = await activateOnce(token)
      if (cancelled) return
      setStatus(result.ok ? 'ok' : 'err')
      setMessage(
        result.ok
          ? result.message
          : `${result.message} If you already clicked this link once, your account may be active — try signing in.`,
      )
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="relative min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <ThemeToggle className="absolute right-6 top-6 z-10" />
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex items-center gap-2 mb-2 justify-center">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
            <BarChart2 size={18} className="text-white" />
          </div>
          <span className="font-bold text-white text-lg">OptionAdvisor</span>
        </div>
        <h1 className="text-xl font-bold text-white">Account activation</h1>
        {status === 'loading' && (
          <p className="text-gray-400 text-sm flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            Confirming your email…
          </p>
        )}
        {status === 'ok' && (
          <div className="bg-emerald-900/20 border border-emerald-800 rounded-xl p-4 text-sm text-emerald-200">
            {message}
          </div>
        )}
        {status === 'err' && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-400">{message}</div>
        )}
        <button
          type="button"
          onClick={() => navigate('login')}
          className="text-sm font-semibold text-violet-400 hover:text-violet-300"
        >
          Go to sign in
        </button>
        <CopyrightFooter />
      </div>
    </div>
  )
}
