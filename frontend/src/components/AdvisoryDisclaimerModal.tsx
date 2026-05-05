import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { ADVISORY_DISCLAIMER_PARAGRAPHS, ADVISORY_TERMS_VERSION } from '../constants/advisoryDisclaimer'

export default function AdvisoryDisclaimerModal() {
  const {
    user,
    userDataLoaded,
    needsAdvisoryAcknowledgement,
    acknowledgeAdvisoryDisclaimer,
  } = useApp()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (needsAdvisoryAcknowledgement) {
      setAgreed(false)
      setErr(null)
      setBusy(false)
    }
  }, [needsAdvisoryAcknowledgement])

  if (!user || !userDataLoaded || !needsAdvisoryAcknowledgement) return null

  const submit = async () => {
    if (!agreed || busy) return
    setBusy(true)
    setErr(null)
    try {
      await acknowledgeAdvisoryDisclaimer()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ??
        (e as { message?: string })?.message ??
        'Could not save your acknowledgment. Check your connection and try again.'
      setErr(typeof msg === 'string' ? msg : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/85 px-4 py-8 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisory-disclaimer-title"
        className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-amber-800/60 bg-gray-900 shadow-2xl"
      >
        <div className="shrink-0 border-b border-amber-900/40 bg-amber-950/35 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-amber-400">
              <AlertTriangle size={22} aria-hidden />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">
                Required · Options advisory notice (terms v{ADVISORY_TERMS_VERSION})
              </div>
              <h2 id="advisory-disclaimer-title" className="mt-1 text-lg font-bold text-white">
                Important: not financial advice
              </h2>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-gray-300">
          {ADVISORY_DISCLAIMER_PARAGRAPHS.map((p, i) => (
            <p key={i} className={i > 0 ? 'mt-3' : ''}>
              {p}
            </p>
          ))}
          <p className="mt-4 text-xs text-gray-500">
            Your acceptance is recorded with your account (version {ADVISORY_TERMS_VERSION} and timestamp) so we know you saw this notice.
          </p>
        </div>

        <div className="shrink-0 space-y-3 border-t border-gray-800 bg-gray-950/80 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-gray-600 bg-gray-800 text-violet-600 focus:ring-violet-500"
            />
            <span>I have read and understand the above. I agree that OptionAdvisor provides suggestions and analytics only and does not guarantee any outcome or replace my own judgment.</span>
          </label>
          {err && (
            <p className="text-sm text-red-400" role="alert">
              {err}
            </p>
          )}
          <button
            type="button"
            disabled={!agreed || busy}
            onClick={() => void submit()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            {busy ? 'Saving…' : 'Accept and continue'}
          </button>
          <p className="text-center text-xs text-gray-600">You cannot use the app until you accept. Log out from the login screen if you do not agree.</p>
        </div>
      </div>
    </div>
  )
}
