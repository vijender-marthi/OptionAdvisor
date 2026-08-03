// Post-deploy stale-chunk recovery.
//
// The production build fingerprints every lazy chunk (e.g. TradeWorksheetPage-<hash>.js)
// and the deploy step rsync --delete's the old ones. A browser tab opened before a deploy
// still references the old hashes, so lazily loading a route fails with
// "Failed to fetch dynamically imported module". Without handling, that surfaces as the
// ErrorBoundary's "Something went wrong" and the tab stays stuck.
//
// We detect that specific failure and reload once to fetch the fresh index.html + chunks.

const CHUNK_RELOAD_KEY = 'oa:last-chunk-reload'
const RELOAD_DEBOUNCE_MS = 15_000

/** True when the error looks like a failed dynamic import / missing chunk. */
export function isChunkLoadError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Failed to fetch dynamically/i.test(message)
}

/**
 * Reload the page once to recover from a stale chunk. Returns true if a reload was
 * triggered. Debounced via sessionStorage so a genuinely broken deploy can't loop:
 * if a reload was attempted within the last RELOAD_DEBOUNCE_MS, we give up and let
 * the caller show the normal error instead.
 */
export function recoverFromStaleChunk(): boolean {
  if (typeof window === 'undefined') return false
  let last = 0
  try { last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0') } catch { /* sessionStorage unavailable */ }
  if (Date.now() - last < RELOAD_DEBOUNCE_MS) return false
  try { window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())) } catch { /* ignore */ }
  window.location.reload()
  return true
}
