import type { ReactNode } from 'react'
import { Bell, Mail, ShieldCheck, Info } from 'lucide-react'
import { useApp } from '../contexts/AppContext'

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
  const { alertEmailEnabled, setAlertEmailEnabled, user } = useApp()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100 tracking-tight">Settings</h1>
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
      </SettingsCard>

      {/* How alerts work */}
      <SettingsCard title="How Alerts Work">
        <div className="py-4 space-y-3 text-sm text-gray-400 leading-relaxed">
          <div className="flex gap-3">
            <Bell size={15} className="text-violet-400 mt-0.5 shrink-0" />
            <p>Alerts are scanned every <span className="text-gray-200 font-medium">5 minutes</span> during market hours (6 AM–4 PM PST, weekdays). Each GO signal fires at most once per ticker/strategy/expiry combination per session.</p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={15} className="text-violet-400 mt-0.5 shrink-0" />
            <p>Alerts use the same <span className="text-gray-200 font-medium">buildChecklist + deriveVerdict</span> logic as full analysis — the same checklist items, thresholds, and scoring. A GO signal means all hard gates pass and the score is ≥ 70.</p>
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
              <span className="text-gray-200 font-medium">{user.email}</span>
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  )
}
