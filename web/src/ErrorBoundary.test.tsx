import { describe, it, expect } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

describe('ErrorBoundary', () => {
  it('exports ErrorBoundary class', () => {
    expect(ErrorBoundary).toBeDefined()
    expect(typeof ErrorBoundary).toBe('function')
  })

  it('has getDerivedStateFromError static method', () => {
    expect(ErrorBoundary.getDerivedStateFromError).toBeDefined()
  })

  it('getDerivedStateFromError returns error state', () => {
    const error = new Error('test error')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state).toEqual({ hasError: true, error })
  })

  it('getDerivedStateFromError preserves error message', () => {
    const error = new Error('specific failure')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state.error?.message).toBe('specific failure')
  })
})
