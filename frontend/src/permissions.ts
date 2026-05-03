import type { Page, UserRole } from './types'

/** Roles assigned on the server (env lists + SQLite). Used for feature gating. */
export function normalizeUserRole(raw: string | undefined | null): UserRole {
  const r = (raw ?? 'user').trim().toLowerCase()
  if (r === 'admin' || r === 'finance' || r === 'user') return r
  return 'user'
}

const FINANCE_NO_ACCESS: ReadonlySet<Page> = new Set(['ai-stocks', 'q-radar'])

/**
 * Finance users get analysis, portfolio, journal, alerts, etc., but not stock-discovery radars.
 * Admin and standard users have full navigation.
 */
export function canAccessPage(role: UserRole | undefined, page: Page): boolean {
  const r = role ?? 'user'
  if (page === 'login') return true
  if (r === 'admin' || r === 'user') return true
  if (r === 'finance') return !FINANCE_NO_ACCESS.has(page)
  return true
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'admin': return 'Administrator'
    case 'finance': return 'Finance'
    default: return 'User'
  }
}

export function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'admin': return 'bg-amber-900/50 text-amber-300 border-amber-700'
    case 'finance': return 'bg-cyan-900/40 text-cyan-300 border-cyan-700'
    default: return 'bg-gray-800 text-gray-400 border-gray-600'
  }
}
