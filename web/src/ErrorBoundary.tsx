import { Component } from 'react'
import type { ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center p-4">
          <div className="text-center space-y-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Something went wrong</h2>
            <p className="text-sm text-[var(--muted)]">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
