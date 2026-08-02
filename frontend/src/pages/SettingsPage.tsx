import type { ReactNode } from 'react'
import { useEffect, useState, useCallback } from 'react'
import { Activity, Bell, Clock, Database, Mail, Palette, RefreshCw, ShieldCheck, Info, Send, CheckCircle2, AlertTriangle, Wrench, Settings } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { api, generatedApiPath, getEmailStatus, sendTestEmail, clearAllCaches, getUserAccent, setUserAccent } from '../api/client'
import type { ApiOperationId } from '../api/generated/openapi-types'
import { roleBadgeClass, roleLabel } from '../permissions'
import {
  loadSwingToolSettings, saveFibLookback, saveShowEma9, saveConfluenceTightness,
  type ConfluenceTightness,
} from '../utils/fibConfluence'
import AICoachSettingsCard from '../components/AICoachSettingsCard'

const SETTINGS_OPERATION_IDS = {
  health: 'health_check_api_health_get',
  dbCheck: 'admin_db_check_api_admin_db_check_get',
} as const satisfies Record<string, ApiOperationId>

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
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheResult, setCacheResult] = useState<{ ok: boolean; total: number } | null>(null)
  const [accent, setAccent] = useState(() => { try { return localStorage.getItem('oa_accent') || 'blue' } catch { return 'blue' } })
  const [deployedVersion, setDeployedVersion] = useState('—')
  const [timezone, setTimezone] = useState(() => { try { return localStorage.getItem('oa_timezone') || 'America/New_York' } catch { return 'America/New_York' } })
  const [swingTools, setSwingTools] = useState(() => loadSwingToolSettings())
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

  // Load accent from backend on mount
  useEffect(() => {
    getUserAccent().then(a => {
      if (a) { setAccent(a); try { localStorage.setItem('oa_accent', a) } catch {} }
    }).catch(() => {})
  }, [])

  const handleSetAccent = useCallback((a: string) => {
    setAccent(a)
    try { localStorage.setItem('oa_accent', a) } catch {}
    setUserAccent(a).catch(() => {})
  }, [])

  useEffect(() => {
    getEmailStatus()
      .then(setEmailStatus)
      .catch(() => setEmailStatus(null))
    api.get(generatedApiPath(SETTINGS_OPERATION_IDS.health)).then(({ data: d }) => {
      if (d.version) setDeployedVersion(d.version)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setBuyingPowerInput(String(accountSize))
  }, [accountSize])

  useEffect(() => {
    try { localStorage.setItem('oa_accent', accent) } catch {}
    const html = document.documentElement
    html.classList.remove('accent-blue', 'accent-purple', 'accent-aqua', 'accent-emerald', 'accent-amber', 'accent-sky', 'accent-rose', 'accent-orange')
    html.classList.add(`accent-${accent}`)
  }, [accent])

  useEffect(() => {
    try {
      localStorage.setItem('oa_timezone', timezone)
      window.dispatchEvent(new CustomEvent('oa-timezone-changed', { detail: timezone }))
    } catch {}
  }, [timezone])

  const handleBuyingPowerSave = () => {
    const val = parseFloat(buyingPowerInput)
    if (!isNaN(val) && val > 0) setAccountSize(val)
  }

  const handleClearCache = async () => {
    if (clearingCache) return
    setClearingCache(true)
    setCacheResult(null)
    try {
      const res = await clearAllCaches()
      setCacheResult({ ok: res.ok, total: res.total_entries_cleared })
    } catch {
      setCacheResult({ ok: false, total: 0 })
    } finally {
      setClearingCache(false)
    }
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
        <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading flex items-center gap-2">
          <Settings size={22} className="text-semantic-accent shrink-0" />
          Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">Configure how OptionAdvisor notifies you and manages alerts.</p>
      </div>

      {/* AI Coach — user-supplied API key */}
      <AICoachSettingsCard />

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

      {/* Accent Color */}
      <SettingsCard title="Accent Color">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'blue', label: 'Blue', color: 'bg-sky-500' },
            { id: 'purple', label: 'Purple', color: 'bg-purple-500' },
            { id: 'aqua', label: 'Aqua', color: 'bg-teal-500' },
            { id: 'emerald', label: 'Emerald', color: 'bg-emerald-500' },
            { id: 'sky', label: 'Sky', color: 'bg-sky-500' },
            { id: 'amber', label: 'Amber', color: 'bg-amber-500' },
            { id: 'rose', label: 'Rose', color: 'bg-rose-500' },
            { id: 'orange', label: 'Orange', color: 'bg-orange-500' },
          ].map(a => (
            <button key={a.id} onClick={() => handleSetAccent(a.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                accent === a.id
                  ? 'border-slate-500 dark:border-white/30 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                  : 'border-transparent text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className={`w-3 h-3 rounded-full ${a.color}`} />
              {a.label}
            </button>
          ))}
        </div>
      </SettingsCard>

      {/* Timezone */}
      <SettingsCard title="Timezone">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'America/New_York', label: 'Eastern (ET)' },
            { id: 'America/Chicago', label: 'Central (CT)' },
            { id: 'America/Denver', label: 'Mountain (MT)' },
            { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
          ].map(tz => (
            <button key={tz.id} onClick={() => setTimezone(tz.id)}
              className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                timezone === tz.id
                  ? 'border-slate-500 dark:border-white/30 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                  : 'border-transparent text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50'
              }`}
            >
              <Clock size={12} className="inline mr-1.5 -mt-0.5" />{tz.label}
            </button>
          ))}
        </div>
      </SettingsCard>

      {/* Swing Tools — Fibonacci / 9 EMA / Confluence (swing page only) */}
      <SettingsCard title="Swing Tools (Fib / 9 EMA / Confluence)">
        {/* Fibonacci lookback */}
        <div className="py-4">
          <div className="text-sm font-semibold text-gray-100 tracking-tight mb-0.5">Fibonacci Lookback Period</div>
          <p className="text-xs text-gray-500 leading-relaxed mb-2">Trading days used to find the swing high/low for fib levels. 20 is the default and captures most swing patterns.</p>
          <div className="flex flex-wrap gap-2">
            {[
              { v: 10, label: '10d — very recent' },
              { v: 20, label: '20d — default' },
              { v: 60, label: '60d — longer-term' },
              { v: 90, label: '90d — positional' },
            ].map(o => (
              <button key={o.v} onClick={() => { saveFibLookback(o.v); setSwingTools(s => ({ ...s, fibLookback: o.v })) }}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  swingTools.fibLookback === o.v
                    ? 'border-slate-500 dark:border-white/30 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                    : 'border-transparent text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >{o.label}</button>
            ))}
          </div>
        </div>

        {/* 9 EMA display toggle */}
        <ToggleRow
          icon={<Activity size={16} />}
          label="9 EMA Display"
          description="Show the 9 EMA early-momentum stat on the swing stock card. Hide if you only trade off MA20/MA50."
          checked={swingTools.showEma9}
          onChange={v => { saveShowEma9(v); setSwingTools(s => ({ ...s, showEma9: v })) }}
        />

        {/* Confluence threshold */}
        <div className="py-4">
          <div className="text-sm font-semibold text-gray-100 tracking-tight mb-0.5">Confluence Threshold</div>
          <p className="text-xs text-gray-500 leading-relaxed mb-2">How close levels must sit to count as aligned. Medium ($1 or 0.5% of price) works for most users.</p>
          <div className="flex flex-wrap gap-2">
            {[
              { v: 'tight' as ConfluenceTightness, label: 'Tight ($0.50 / 0.3%)' },
              { v: 'medium' as ConfluenceTightness, label: 'Medium ($1 / 0.5%)' },
              { v: 'loose' as ConfluenceTightness, label: 'Loose ($2 / 1%)' },
            ].map(o => (
              <button key={o.v} onClick={() => { saveConfluenceTightness(o.v); setSwingTools(s => ({ ...s, confluenceTightness: o.v })) }}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  swingTools.confluenceTightness === o.v
                    ? 'border-slate-500 dark:border-white/30 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                    : 'border-transparent text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >{o.label}</button>
            ))}
          </div>
        </div>
      </SettingsCard>

      {/* Monitor / Troubleshooting — Admin only */}
      {user?.role === 'admin' && (
        <div>
          {/* Section header with admin badge */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <Wrench size={13} className="text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-amber-500">Monitor / Troubleshooting</span>
            <span className="bg-amber-900/50 text-amber-300 border border-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              ADMIN
            </span>
          </div>

          <div className="bg-gray-900 border border-amber-900/40 rounded-2xl px-5 py-2 divide-y divide-gray-800">

            {/* Info row */}
            <div className="py-3 flex items-center gap-2">
              <Activity size={13} className="text-gray-500 shrink-0" />
              <span className="text-xs text-gray-500">
                Yahoo Finance data is cached in-memory. Off-hours TTL: quotes 15 min · bars 5–60 min · engine scans vary.
                Use Force Clear when prices show wrong direction or stale change%.
              </span>
            </div>

            {/* API health check row */}
            <div className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 text-emerald-500">
                  <Activity size={15} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-100">API Status</div>
                  <div className="text-xs text-gray-500">Backend health check</div>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await api.get(generatedApiPath(SETTINGS_OPERATION_IDS.health))
                    alert(r.status >= 200 && r.status < 300 ? '✅ API OK' : `⚠️ API returned ${r.status}`)
                  } catch { alert('❌ API unreachable') }
                }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-600
                           text-gray-300 hover:text-emerald-300 text-xs font-semibold rounded-xl transition-colors shrink-0"
              >
                Test
              </button>
            </div>

            {/* Database check row */}
            <div className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 text-violet-400">
                  <Database size={15} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-100">Database</div>
                  <div className="text-xs text-gray-500">SQLite connection check</div>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { data: d } = await api.get(generatedApiPath(SETTINGS_OPERATION_IDS.dbCheck), { headers: { 'X-Access-Email': '' } })
                    alert(d.ok ? '✅ DB OK' : `❌ DB error: ${d.error}`)
                  } catch { alert('❌ DB check failed') }
                }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-600
                           text-gray-300 hover:text-violet-300 text-xs font-semibold rounded-xl transition-colors shrink-0"
              >
                Check
              </button>
            </div>

            {/* Deployed version */}
            <div className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 text-sky-400">
                  <Info size={15} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-100">Deployed Version</div>
                  <div className="text-xs text-gray-500">Current git tag on server</div>
                </div>
              </div>
              <code className="text-xs font-mono text-sky-400 bg-gray-800 px-2 py-1 rounded-lg">{deployedVersion}</code>
            </div>

            {/* Force Clear Cache row */}
            <div className="py-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="mt-0.5 w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0 text-amber-500">
                  <RefreshCw size={17} />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-gray-100 tracking-tight">Force Clear Cache</span>
                  <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
                    Wipes all 6 in-memory caches: price bars (OHLCV), live quotes, engine analysis,
                    analyze-user results, day trade scans, swing trade scans. Next load re-fetches
                    everything live from Yahoo Finance.
                  </p>
                  {cacheResult && (
                    <div className={`mt-2 flex items-center gap-1.5 text-xs ${cacheResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cacheResult.ok
                        ? <><CheckCircle2 size={13} /><span>Cleared {cacheResult.total} cached entries — next load fetches fresh data.</span></>
                        : <><AlertTriangle size={13} /><span>Cache clear failed — check backend logs.</span></>
                      }
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={handleClearCache}
                disabled={clearingCache}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-amber-900/30 border border-gray-700
                           hover:border-amber-600 text-gray-300 hover:text-amber-300 text-xs font-semibold rounded-xl
                           transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <RefreshCw size={13} className={clearingCache ? 'animate-spin' : ''} />
                {clearingCache ? 'Clearing...' : 'Clear Cache'}
              </button>
            </div>

          </div>
        </div>
      )}

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

    </div>
  )
}
