import { useState, FormEvent } from 'react'
import { BarChart2, TrendingUp, Star, Briefcase, Eye, EyeOff } from 'lucide-react'
import { GoogleLogin } from '@react-oauth/google'
import { useApp } from '../contexts/AppContext'
import ThemeToggle from '../components/ThemeToggle'
import CopyrightFooter from '../components/CopyrightFooter'
import BetaProductTag from '../components/BetaProductTag'

const googleWebClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

export default function LoginPage() {
  const {
    navigate,
    loginWithPassword,
    registerWithPassword,
    loginWithGoogleCredential,
  } = useApp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !password.trim()) {
      setError('Email and password are required.')
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'signup') {
        const res = await registerWithPassword(name, cleanEmail, password)
        setInfo(res.message)
        if (!res.needs_activation) navigate('ticker')
      } else {
        await loginWithPassword(cleanEmail, password)
        navigate('ticker')
      }
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map(d => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: string }).msg) : '')).join(', ')
            : 'Something went wrong. Please try again.'
      setError(msg || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    { icon: <TrendingUp size={16} />, label: 'Systematic Options Analysis', desc: 'Multi-signal engine with delta-based strike selection' },
    { icon: <Star size={16} />, label: 'Watchlist', desc: 'Track your favourite tickers in one place' },
    { icon: <Briefcase size={16} />, label: 'Portfolio Tracker', desc: 'Log trades, monitor P&L, and manage positions' },
  ]

  return (
    <div className="login-page relative min-h-screen bg-gray-950 flex">
      <ThemeToggle className="absolute right-6 top-6 z-10" />

      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-900 via-violet-950/30 to-gray-900 border-r border-gray-800 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <BarChart2 size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-white">OptionAdvisor</span>
              <BetaProductTag className="scale-110 origin-left" />
            </div>
            <div className="text-xs text-gray-500">Systematic Engine v2</div>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight mb-3">
              Trade smarter<br />with systematic<br />options analysis.
            </h1>
            <p className="text-gray-400 text-base leading-relaxed">
              Delta-based strike selection, IV-rank filtering, expected value scoring —
              every recommendation backed by data.
            </p>
          </div>
          <div className="space-y-4">
            {features.map(f => (
              <div key={f.label} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-violet-900/60 border border-violet-700/50 flex items-center justify-center text-violet-400 shrink-0 mt-0.5">
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-200">{f.label}</div>
                  <div className="text-xs text-gray-500">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-600">
          ⚠️ For educational purposes only. Not financial advice.
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex lg:hidden flex-wrap items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
              <BarChart2 size={15} className="text-white" />
            </div>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-bold text-white">OptionAdvisor</span>
              <BetaProductTag />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white mb-1">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h2>
            <p className="text-gray-500 text-sm">
              {mode === 'signin'
                ? 'Use your email and password, or Google.'
                : 'We will send a confirmation link when email is configured on the server.'}
            </p>
          </div>

          <div className="login-auth-tabs flex rounded-xl bg-gray-900/80 p-1 border border-gray-800">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); setInfo('') }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signin' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(''); setInfo('') }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signup' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Register
            </button>
          </div>

          <div className="flex flex-col items-stretch gap-2">
            {googleWebClientId ? (
              <GoogleLogin
                onSuccess={async cred => {
                  if (!cred.credential) return
                  setError('')
                  setInfo('')
                  setLoading(true)
                  try {
                    await loginWithGoogleCredential(cred.credential)
                    navigate('ticker')
                  } catch (err: unknown) {
                    const detail =
                      err && typeof err === 'object' && 'response' in err
                        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                        : undefined
                    setError(typeof detail === 'string' ? detail : 'Google sign-in failed.')
                  } finally {
                    setLoading(false)
                  }
                }}
                onError={() => setError('Google sign-in was cancelled or failed.')}
                theme="filled_black"
                size="large"
                width="100%"
                text="continue_with"
                shape="rectangular"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 px-4 py-3 text-left">
                <div className="text-xs font-semibold text-gray-300 mb-1.5">Continue with Google</div>
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Set{' '}
                  <span className="font-mono text-violet-400/90">VITE_GOOGLE_CLIENT_ID</span>{' '}
                  in <span className="font-mono text-gray-400">frontend/.env.local</span> to your Google
                  OAuth <strong className="text-gray-400 font-normal">Web client ID</strong> (same value as{' '}
                  <span className="font-mono text-gray-500">OPTION_ADVISOR_GOOGLE_CLIENT_ID</span> on the
                  backend). Authorized JavaScript origins must include this app&apos;s URL (e.g.{' '}
                  <span className="font-mono text-gray-500">http://localhost:4200</span>
                  ). Restart <span className="font-mono text-gray-500">npm run dev</span> after saving.
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 w-full text-xs text-gray-600">
              <span className="h-px flex-1 bg-gray-800" />
              or email
              <span className="h-px flex-1 bg-gray-800" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                  Full name <span className="font-normal text-gray-600">(optional)</span>
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  autoComplete="name"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white
                             placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1
                             focus:ring-violet-500 text-sm transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="alex@example.com"
                autoComplete="email"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white
                           placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1
                           focus:ring-violet-500 text-sm transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-white
                             placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1
                             focus:ring-violet-500 text-sm transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'signin' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => navigate('forgot-password')}
                  className="text-xs font-semibold text-violet-400 hover:text-violet-300"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            {info && (
              <div className="bg-violet-900/20 border border-violet-800 rounded-xl p-3 text-sm text-violet-200">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed
                         text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : mode === 'signin' ? (
                'Sign in'
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <p className="text-center text-xs text-gray-600">
            By signing in you agree this tool is for educational use only and not financial advice.
          </p>

          <CopyrightFooter />
        </div>
      </div>
    </div>
  )
}
