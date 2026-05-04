import { useState, FormEvent } from 'react'
import { BarChart2 } from 'lucide-react'
import { authForgotPassword } from '../api/client'
import ThemeToggle from '../components/ThemeToggle'
import CopyrightFooter from '../components/CopyrightFooter'
import { useApp } from '../contexts/AppContext'

export default function ForgotPasswordPage() {
  const { navigate } = useApp()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    const clean = email.trim().toLowerCase()
    if (!clean) {
      setError('Enter your email.')
      return
    }
    setLoading(true)
    try {
      const res = await authForgotPassword(clean)
      setMessage(res.message)
      if (res.dev_reset_token) {
        window.location.hash = `reset-password?token=${encodeURIComponent(res.dev_reset_token)}`
        navigate('reset-password')
        return
      }
    } catch {
      setError('Could not send reset email. Try again later.')
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
          <h1 className="text-xl font-bold text-white mb-1">Reset password</h1>
          <p className="text-gray-500 text-sm">
            Enter your email and we will send a link if an account exists with a password.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm
                       placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-sm text-red-400">{error}</div>
          )}
          {message && (
            <div className="bg-violet-900/20 border border-violet-800 rounded-xl p-3 text-sm text-violet-200">
              {message}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
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
