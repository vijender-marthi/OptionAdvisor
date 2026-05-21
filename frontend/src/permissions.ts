import type { Page, UserRole } from './types'

/** Roles assigned on the server (SQLite user_state.role; optional finance env list). */
export function normalizeUserRole(raw: string | undefined | null): UserRole {
  const r = (raw ?? 'user').trim().toLowerCase()
  if (r === 'admin' || r === 'super_user' || r === 'day' || r === 'swing' || r === 'finance' || r === 'user') return r as UserRole
  return 'user'
}

/**
 * Access tiers by feature:
 *
 *   admin      → Day Trade + Swing Trade + Regular (Strategy Finder) + all admin tools
 *   super_user → Day Trade + Swing Trade + Regular + Advanced Tools (incl. auto-trade) — no admin-mgmt tools
 *   day        → Day Trade + Regular — no Swing Trade or admin tools
 *   swing      → Swing Trade + Regular — no Day Trade or admin tools
 *   user       → Regular (Strategy Finder) only — no Day or Swing Trade
 *   finance    → Regular only (same as user), minus stock-discovery radars
 */

/** Pages only admins can reach (super-admin tools). */
const ADMIN_ONLY: ReadonlySet<Page> = new Set([
  'auto-trade',
])

/** Pages available to admin and day-trade subscribers. */
const DAY_AND_ABOVE: ReadonlySet<Page> = new Set([
  'day-trade',
  'day-trade-watchlist',
  'day-trade-alerts',
  'active-trades',
])

/** Pages available to admin and swing-trade subscribers. */
const SWING_AND_ABOVE: ReadonlySet<Page> = new Set([
  'swing-trade',
  'swing-trade-watchlist',
])

/** Pages available to admin, day-trade, or swing-trade subscribers (either advanced role). */
const DAY_OR_SWING: ReadonlySet<Page> = new Set([
  'watchlist',
])

/** Pages finance users cannot see (stock-discovery radars). */
const FINANCE_NO_ACCESS: ReadonlySet<Page> = new Set([
  'ai-stocks',
  'q-radar',
  'auto-trade',
])

export function canAccessPage(role: UserRole | undefined, page: Page): boolean {
  const r = role ?? 'user'

  // Auth/public pages are always accessible
  if (
    page === 'login'
    || page === 'forgot-password'
    || page === 'reset-password'
    || page === 'activate'
  ) return true

  if (ADMIN_ONLY.has(page))      return r === 'admin' || r === 'super_user'
  if (DAY_AND_ABOVE.has(page))   return r === 'admin' || r === 'super_user' || r === 'day'
  if (SWING_AND_ABOVE.has(page)) return r === 'admin' || r === 'super_user' || r === 'swing'
  if (DAY_OR_SWING.has(page))    return r === 'admin' || r === 'super_user' || r === 'day' || r === 'swing'
  if (r === 'admin')             return true
  if (r === 'super_user')        return true
  if (r === 'day')               return true
  if (r === 'swing')             return true
  if (r === 'finance')           return !FINANCE_NO_ACCESS.has(page)
  // 'user' — Regular features only (everything not already gated above)
  return true
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'admin':      return 'Administrator'
    case 'super_user': return 'Super User'
    case 'day':        return 'Day Trader'
    case 'swing':      return 'Swing Trader'
    case 'finance':    return 'Finance'
    default:           return 'User'
  }
}

export function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'admin':      return 'bg-amber-900/50 text-amber-300 border-amber-700'
    case 'super_user': return 'bg-purple-900/50 text-purple-300 border-purple-700'
    case 'day':        return 'bg-orange-900/50 text-orange-300 border-orange-700'
    case 'swing':      return 'bg-blue-900/50 text-blue-300 border-blue-700'
    case 'finance':    return 'bg-cyan-900/40 text-cyan-300 border-cyan-700'
    default:           return 'bg-gray-800 text-gray-400 border-gray-600'
  }
}
