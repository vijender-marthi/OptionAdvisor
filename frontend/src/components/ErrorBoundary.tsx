import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError, recoverFromStaleChunk } from '../chunkRecovery'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A failed lazy import (stale chunk after a deploy) throws here via React.lazy.
    // Reload once to pull the fresh build instead of stranding the user on an error.
    if (isChunkLoadError(error) && recoverFromStaleChunk()) return
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      // Stale-chunk reload is in flight — show a neutral message, not a scary error.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <div className="text-3xl">⏳</div>
            <p className="text-sm font-semibold text-gray-400">Updating to the latest version…</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700"
            >
              Reload now
            </button>
          </div>
        )
      }
      return this.props.fallback ?? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="text-sm font-semibold text-gray-400">Something went wrong</p>
          <p className="max-w-md text-xs text-gray-600">{this.state.error?.message}</p>
          <button
            type="button"
            onClick={() => { this.setState({ hasError: false, error: null }) }}
            className="mt-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
