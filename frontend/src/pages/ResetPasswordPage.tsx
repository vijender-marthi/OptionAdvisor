import { useEffect, useState, FormEvent } from 'react'
import { BarChart2, Eye, EyeOff } from 'lucide-react'
import { authResetPassword } from '../api/client'
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

export default function ResetPasswordPage() {
  const { navigate } = useApp()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setToken(tokenFromLocation())
    const onLoc = () => setToken(tokenFromLocation())
    window.addEventListener('hashchange', onLoc)
    window.addEventListener('popstate', onLoc)
    return () => {
      window.removeEventListener('hashchange', onLoc)
      window.removeEventListener('popstate', onLoc)
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!token) {
      setError('Missing reset token. Open the link from your email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await authResetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('login'), 2500)
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setError(typeof detail === 'string' ? detail : 'Reset failed. Link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <ThemeToggle className="absolute right-6 top-6 z-10" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2 mb-2 justify-center">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
            <BarChart2 size={18} className="text-white" />
          </div>
          <span className="font-bold text-white text-lg">OptionAdvisor</span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-1">Choose a new password</h1>
          <p className="text-gray-500 text-sm">Use at least 8 characters.</p>
        </div>
        {done ? (
          <div className="bg-emerald-900/20 border border-emerald-800 rounded-xl p-4 text-sm text-emerald-200 text-center">
            Password updated. Redirecting to sign in…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {!token && (
              <div className="text-amber-400 text-sm text-center">
                No token in URL. Paste the full reset link from your email.
              </div>
            )}
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-white text-sm
                           placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && (
              <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-sm text-red-400">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm"
            >
              {loading ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => navigate('login')}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-300"
        >
          Back to sign in
        </button>
        <CopyrightFooter />
      </div>
    </div>
  )
}
