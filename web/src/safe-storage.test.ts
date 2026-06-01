import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock localStorage as a simple Map-backed object
let store: Map<string, string>
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
}

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', mockStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Import after mocking so the module picks up the global
import { storageGet, storageSet, storageRemove } from './safe-storage'

describe('safe-storage', () => {
  it('get returns value when present', () => {
    store.set('key', 'val')
    expect(storageGet('key')).toBe('val')
  })

  it('get returns null when missing', () => {
    expect(storageGet('missing')).toBeNull()
  })

  it('set and get round-trip', () => {
    storageSet('k', 'v')
    expect(storageGet('k')).toBe('v')
  })

  it('remove deletes key', () => {
    storageSet('k', 'v')
    storageRemove('k')
    expect(storageGet('k')).toBeNull()
  })

  it('get returns null when localStorage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(storageGet('key')).toBeNull()
  })

  it('set does not throw when localStorage throws', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(() => storageSet('key', 'val')).not.toThrow()
  })

  it('remove does not throw when localStorage throws', () => {
    vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('blocked') } })
    expect(() => storageRemove('key')).not.toThrow()
  })
})
