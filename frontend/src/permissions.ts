import type { Page, UserRole } from './types'

/** Roles assigned on the server (SQLite user_state.role; optional finance env list). */
export function normalizeUserRole(raw: string | undefined | null): UserRole {
  const r = (raw ?? 'user').trim().toLowerCase()
  if (r === 'admin' || r === 'finance' || r === 'user') return r
  return 'user'
}

const FINANCE_NO_ACCESS: ReadonlySet<Page> = new Set(['ai-stocks', 'q-radar', 'auto-trade'])
const ADMIN_ONLY: ReadonlySet<Page> = new Set([
  'auto-trade',
  'day-trade',
  'day-trade-watchlist',
])

/**
 * Finance users get analysis, portfolio, journal, alerts, etc., but not stock-discovery radars.
 * auto-trade and Day Trading (engine + watchlist) are admin-only.
 * Admin and standard users have full navigation (except admin-only pages).
 */
export function canAccessPage(role: UserRole | undefined, page: Page): boolean {
  const r = role ?? 'user'
  if (
    page === 'login'
    || page === 'forgot-password'
    || page === 'reset-password'
    || page === 'activate'
  ) {
    return true
  }
  if (ADMIN_ONLY.has(page)) return r === 'admin'
  if (r === 'admin') return true
  if (r === 'user') return true
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
