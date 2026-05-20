import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Activity, Bell, Mail, ShieldCheck, Info, Send, CheckCircle2, AlertTriangle, Server, RefreshCw } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { getEmailStatus, sendTestEmail } from '../api/client'
import { roleBadgeClass, roleLabel } from '../permissions'

// ── Reusable toggle row ───────────────────────────────────────────────────────
interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  icon?: ReactNode
  badge?: string
  badgeColor?: string
}

function ToggleRow({ label, description, checked, onChange, icon, badge, badgeColor = 'bg-violet-600' }: ToggleRowProps) {
  return (
    <div className="flex items-start gap-4 py-4">
      {icon && (
        <div className="mt-0.5 w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0 text-gray-400">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-100 tracking-tight">{label}</span>
          {badge && (
            <span className={`${badgeColor} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
      {/* Toggle switch */}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 mt-0.5 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500
          ${checked ? 'bg-violet-600' : 'bg-gray-700'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
            ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────
function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-2 divide-y divide-gray-800">
      <div className="py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-500">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { alertEmailEnabled, setAlertEmailEnabled, user, accountSize, setAccountSize } = useApp()
  const [buyingPowerInput, setBuyingPowerInput] = useState(String(accountSize))
  const [testingEmail, setTestingEmail] = useState(false)
  const [testResult, setTestResult] = useState<{ sent: boolean; message: string } | null>(null)
  const [emailStatus, setEmailStatus] = useState<{
    configured: boolean
    provider: 'sendgrid' | 'smtp' | 'none'
    missing: string[]
    host: string
    port: number
    from: string
    fromName?: string
    envFile: string
    envFileExists: boolean
  } | null>(null)

  useEffect(() => {
    getEmailStatus()
      .then(setEmailStatus)
      .catch(() => setEmailStatus(null))
  }, [])

  useEffect(() => {
    setBuyingPowerInput(String(accountSize))
  }, [accountSize])

  const handleBuyingPowerSave = () => {
    const val = parseFloat(buyingPowerInput)
    if (!isNaN(val) && val > 0) setAccountSize(val)
  }

  const handleTestEmail = async () => {
    if (!user?.email || testingEmail) return
    setTestingEmail(true)
    setTestResult(null)
    try {
      setTestResult(await sendTestEmail(user.email, user.name))
      getEmailStatus().then(setEmailStatus).catch(() => undefined)
    } catch (e) {
      setTestResult({
        sent: false,
        message: e instanceof Error ? e.message : 'Email test failed',
      })
    } finally {
      setTestingEmail(false)
    }
  }

  return (
    <div className="settings-page min-h-screen p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm text-gray-300">
        Additional account and workspace controls will appear here — notifications and email below are live today.
      </div>
      {/* Header */}
      <div>
        <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure how OptionAdvisor notifies you and manages alerts.</p>
      </div>

      {/* Alert Notifications */}
      <SettingsCard title="Alert Notifications">
        <ToggleRow
          icon={<Mail size={17} />}
          label="Email Alerts"
          description={
            user?.email
              ? `Send a GO signal email to ${user.email} whenever a new trade opportunity is detected on your watchlist.`
              : 'Sign in to enable email alerts. Emails are sent to your account address when GO signals are detected.'
          }
          checked={alertEmailEnabled}
          onChange={setAlertEmailEnabled}
          badge={alertEmailEnabled ? 'ON' : 'OFF'}
          badgeColor={alertEmailEnabled ? 'bg-emerald-600' : 'bg-gray-600'}
        />
        <div className="py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-100 tracking-tight">Test email</div>
            <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
              Sends a test message via SendGrid (if configured) or SMTP to verify backend email settings.
            </p>
            {testResult && (
              <div className={`mt-2 flex items-center gap-1.5 text-xs ${testResult.sent ? 'text-emerald-400' : 'text-red-400'}`}>
                {testResult.sent ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
          <button
            onClick={handleTestEmail}
            disabled={!user?.email || testingEmail}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700
                       text-gray-300 hover:text-violet-300 hover:border-violet-600 text-xs font-semibold rounded-xl
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={13} className={testingEmail ? 'animate-pulse' : ''} />
            {testingEmail ? 'Sending...' : 'Send Test'}
          </button>
        </div>
        {emailStatus && (
          <div className={`py-3 text-xs border-t border-gray-800 ${emailStatus.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
            Email: {emailStatus.configured
              ? emailStatus.provider === 'sendgrid'
                ? `SendGrid — from ${emailStatus.from}${emailStatus.fromName ? ` (${emailStatus.fromName})` : ''}`
                : `SMTP — ${emailStatus.host}:${emailStatus.port} · from ${emailStatus.from}`
              : `Not configured — ${[...new Set(emailStatus.missing)].join(', ')}${emailStatus.envFileExists ? '' : ' · backend/.env not found'}`
            }
          </div>
        )}
      </SettingsCard>

      {/* How alerts work */}
      <SettingsCard title="How Alerts Work">
        <div className="py-4 space-y-3 text-sm text-gray-400 leading-relaxed">
          <div className="flex gap-3">
            <Bell size={15} className="text-violet-400 mt-0.5 shrink-0" />
            <p>Alerts are scanned every <span className="text-gray-200 font-medium">15 minutes</span> during market hours (6 AM–4 PM PST, weekdays). Each GO signal fires at most once per ticker/strategy/expiry combination per session.</p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={15} className="text-violet-400 mt-0.5 shrink-0" />
            <p>Alerts use a backend mirror of the same checklist rules as full analysis (IV, bias, liquidity, EV hard gate, PoP, structure, etc.). A GO alert fires only when that mirror passes with <span className="text-gray-200 font-medium">zero hard fails, zero soft fails</span>, <span className="text-gray-200 font-medium">edge ratio ≥ 5%</span> (no thin-edge Kelly warning), and fewer than five warnings — matching a green GO verdict in the UI.</p>
          </div>
          <div className="flex gap-3">
            <Info size={15} className="text-violet-400 mt-0.5 shrink-0" />
            <p>Full analysis may show a different recommendation if market conditions or the active expiry week differ from when the alert fired. Always review the full pre-trade checklist before trading.</p>
          </div>
        </div>
      </SettingsCard>

      {/* Account info (read-only) */}
      {user && (
        <SettingsCard title="Account">
          <div className="py-4 space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Name</span>
              <span className="text-gray-200 font-medium">{user.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-200 font-medium truncate ml-4">{user.email}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-500">Role</span>
              <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${roleBadgeClass(user.role)}`}>
                {roleLabel(user.role)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-100">Buying Power</div>
                <div className="text-xs text-gray-500">Used by Kelly sizing &amp; Positions Center</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-500">$</span>
                <input
                  type="number"
                  value={buyingPowerInput}
                  onChange={e => setBuyingPowerInput(e.target.value)}
                  onBlur={handleBuyingPowerSave}
                  onKeyDown={e => { if (e.key === 'Enter') handleBuyingPowerSave() }}
                  className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 font-mono text-right
                             focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  min={0}
                  step={1000}
                />
                <button
                  onClick={handleBuyingPowerSave}
                  className="px-2.5 py-1.5 bg-gray-800 hover:bg-violet-600/20 border border-gray-700 hover:border-violet-600
                             text-gray-400 hover:text-violet-400 text-xs font-semibold rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed pt-1">
              {user.role === 'finance' && 'Discovery radars (AI & Q) are hidden. Admins assign roles via server env or database.'}
              {user.role === 'admin' && 'Full access. Promote other accounts by setting user_state.role in the server database; finance-only accounts can use OPTION_ADVISOR_FINANCE_EMAILS.'}
              {user.role === 'user' && 'Standard access. Your organization can promote accounts to admin or finance on the server.'}
            </p>
          </div>
        </SettingsCard>
      )}
      </div>

      {user?.role === 'admin' && (
        <SettingsCard title="🔧 Monitor / Troubleshooting">
          <div className="space-y-4">
            {/* System health row */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <Activity size={16} className="text-emerald-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">API Status</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Backend API health check</div>
                </div>
              </div>
              <button type="button" onClick={async () => {
                try {
                  const r = await fetch('/api/health')
                  alert(r.ok ? 'API OK' : `API returned ${r.status}`)
                } catch { alert('API unreachable') }
              }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                Test
              </button>
            </div>

            {/* Version info */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <Server size={16} className="text-violet-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">App Version</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Current deployment tag</div>
                </div>
              </div>
              <code className="text-xs font-mono text-slate-600 dark:text-slate-400">
                v1.34.34
              </code>
            </div>

            {/* Database check */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <Server size={16} className="text-amber-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Database</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">SQLite connection</div>
                </div>
              </div>
              <button type="button" onClick={async () => {
                try {
                  const r = await fetch('/api/admin/db-check')
                  const d = await r.json()
                  alert(d.ok ? 'DB OK' : `DB error: ${d.error}`)
                } catch { alert('DB check failed') }
              }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                Check
              </button>
            </div>

            {/* Refresh all caches */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <RefreshCw size={16} className="text-sky-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Flush Cache</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Clear bar_cache and force refresh on next scan</div>
                </div>
              </div>
              <button type="button" onClick={async () => {
                try {
                  const r = await fetch('/api/admin/flush-cache', { method: 'POST' })
                  const d = await r.json()
                  alert(d.ok ? 'Cache flushed' : `Error: ${d.error}`)
                } catch { alert('Flush failed') }
              }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                Flush
              </button>
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  )
}
