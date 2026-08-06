import { Sparkles, Settings as SettingsIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import AICoachChat from '../components/AICoachChat'

export default function AICoachPage() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-heading"><Sparkles size={20} className="text-violet-500" />AI Coach</h1>
          <p className="text-sm text-secondary">Ask about setups, sizing, risk, and your plan. Uses your own API key — educational, not financial advice.</p>
        </div>
        <button type="button" onClick={() => navigate('/settings')} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-surface-muted">
          <SettingsIcon size={13} />API key
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface-canvas">
        <AICoachChat />
      </div>
    </div>
  )
}
