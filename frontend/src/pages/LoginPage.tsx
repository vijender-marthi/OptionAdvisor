import { useState, FormEvent } from 'react'
import { BarChart2, TrendingUp, Star, Briefcase, Eye, EyeOff } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import ThemeToggle from '../components/ThemeToggle'
import CopyrightFooter from '../components/CopyrightFooter'

export default function LoginPage() {
  const { login, navigate } = useApp()
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    await new Promise(r => setTimeout(r, 600)) // brief UX delay
    const ok = login(name, email, password)
    setLoading(false)
    if (ok) navigate('ticker')
    else setError('Invalid credentials. Please try again.')
  }

  const features = [
    { icon: <TrendingUp size={16} />, label: 'Systematic Options Analysis',  desc: 'Multi-signal engine with delta-based strike selection' },
    { icon: <Star size={16} />,       label: 'Watchlist',                    desc: 'Track your favourite tickers in one place' },
    { icon: <Briefcase size={16} />,  label: 'Portfolio Tracker',            desc: 'Log trades, monitor P&L, and manage positions' },
  ]

  return (
    <div className="relative min-h-screen bg-gray-950 flex">
      <ThemeToggle className="absolute right-6 top-6 z-10" />

      {/* Left branding panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-900 via-violet-950/30 to-gray-900 border-r border-gray-800 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <BarChart2 size={20} className="text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-white">OptionAdvisor</div>
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

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <BarChart2 size={15} className="text-white" />
            </div>
            <span className="font-bold text-white">OptionAdvisor</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Sign in</h2>
            <p className="text-gray-500 text-sm">Enter any credentials to get started.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Full name <span className="font-normal text-gray-600">(optional)</span></label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alex Johnson"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white
                           placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1
                           focus:ring-violet-500 text-sm transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="alex@example.com"
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

            {error && (
              <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                {error}
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
                  Signing in…
                </>
              ) : 'Sign in'}
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
