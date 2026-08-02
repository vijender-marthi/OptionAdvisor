import { useEffect, useState, useCallback } from 'react'
import { Sparkles, CheckCircle2, AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import {
  getAICoachSettings, saveAICoachSettings, deleteAICoachSettings, type AICoachProvider,
} from '../api/client'

const PROVIDERS: { value: AICoachProvider; label: string; keyHint: string }[] = [
  { value: 'claude', label: 'Claude (Anthropic)', keyHint: 'console.anthropic.com → API keys (sk-ant-…)' },
  { value: 'openai', label: 'OpenAI', keyHint: 'platform.openai.com → API keys (sk-…)' },
  { value: 'gemini', label: 'Google Gemini', keyHint: 'aistudio.google.com → Get API key' },
]

export default function AICoachSettingsCard() {
  const [provider, setProvider] = useState<AICoachProvider>('claude')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState(false)
  const [savedProvider, setSavedProvider] = useState<string | null>(null)
  const [savedModel, setSavedModel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await getAICoachSettings()
      setConfigured(s.configured)
      setSavedProvider(s.provider)
      setSavedModel(s.model)
      setDefaults(s.defaultModels || {})
      if (s.provider) setProvider(s.provider)
    } catch { /* not signed in / offline — leave defaults */ }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    if (apiKey.trim().length < 8) {
      setStatus({ ok: false, msg: 'Enter a valid API key.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      await saveAICoachSettings({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined })
      setApiKey('')
      setStatus({ ok: true, msg: 'AI Coach connected.' })
      await load()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatus({ ok: false, msg: detail || 'Could not save. Check the key and try again.' })
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    try {
      await deleteAICoachSettings()
      setConfigured(false); setSavedProvider(null); setSavedModel(null); setApiKey(''); setModel('')
      setStatus({ ok: true, msg: 'AI Coach disconnected.' })
    } catch { setStatus({ ok: false, msg: 'Could not remove the key.' }) } finally { setBusy(false) }
  }

  const activeHint = PROVIDERS.find(p => p.value === provider)?.keyHint

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-2 divide-y divide-gray-800">
      <div className="py-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-600 text-white"><Sparkles size={13} /></span>
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-500">AI Coach</h2>
      </div>

      <div className="py-4 space-y-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          Bring your own API key to get AI coaching on positions, recommendations, and day/swing setups.
          Your key is stored securely on the server, never shown again, and only used for your coaching requests.
        </p>

        {configured && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 size={14} />
            <span>Connected — <b>{savedProvider}</b>{savedModel ? <> · {savedModel}</> : null}. Enter a new key below to replace it.</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Provider
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as AICoachProvider)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 focus:border-violet-500 focus:outline-none"
            >
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Model <span className="text-gray-600 normal-case">(optional)</span>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={defaults[provider] || 'default'}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-200 focus:border-violet-500 focus:outline-none"
            />
          </label>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500">
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={configured ? '•••••••• (enter a new key to replace)' : 'Paste your API key'}
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-200 focus:border-violet-500 focus:outline-none"
          />
          {activeHint && <span className="mt-1 block text-[10px] text-gray-600">Get a key: {activeHint}</span>}
        </label>

        {status && (
          <div className={`flex items-center gap-2 text-xs ${status.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
            {status.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {status.msg}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {configured ? 'Update key' : 'Connect'}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-400 hover:border-rose-600 hover:text-rose-400 disabled:opacity-60"
            >
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
