import type { PortfolioPosition } from '../types'

/** Hub badge for saved portfolio rows (not day-trade API rows). */
export type PortfolioHubCategory = 'regular' | 'swing'

/**
 * Swing badge only when stored fields clearly mention swing — no API/engine field exists yet.
 */
export function inferPortfolioHubCategory(pos: PortfolioPosition): PortfolioHubCategory {
  const n = (pos.notes ?? '').toLowerCase()
  const s = (pos.strategy ?? '').toLowerCase()
  const b = (pos.bias ?? '').toLowerCase()
  if (/\bswing\b/.test(n) || s.includes('swing') || b.includes('swing')) return 'swing'
  return 'regular'
}
