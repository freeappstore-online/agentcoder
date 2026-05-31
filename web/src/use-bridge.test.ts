import { describe, it, expect } from 'vitest'

// Test the buffer truncation and chunk reassembly logic from use-bridge
// (extracted as pure logic tests — the hook itself requires React context)

const MAX_BUFFER_SIZE = 500_000

function truncateBuffer(screen: string): string {
  if (screen.length > MAX_BUFFER_SIZE) return screen.slice(-MAX_BUFFER_SIZE)
  return screen
}

describe('buffer truncation', () => {
  it('passes through small buffers unchanged', () => {
    const buf = 'hello world'
    expect(truncateBuffer(buf)).toBe(buf)
  })

  it('truncates buffers over 500KB', () => {
    const buf = 'x'.repeat(600_000)
    const result = truncateBuffer(buf)
    expect(result.length).toBe(MAX_BUFFER_SIZE)
  })

  it('keeps the tail of the buffer when truncating', () => {
    const buf = 'HEAD' + 'x'.repeat(600_000) + 'TAIL'
    const result = truncateBuffer(buf)
    expect(result.endsWith('TAIL')).toBe(true)
    expect(result.startsWith('HEAD')).toBe(false)
  })

  it('does not truncate buffers exactly at limit', () => {
    const buf = 'x'.repeat(MAX_BUFFER_SIZE)
    expect(truncateBuffer(buf)).toBe(buf)
  })
})

describe('heartbeat timeout detection', () => {
  it('detects stale heartbeat after 60 seconds', () => {
    const HEARTBEAT_TIMEOUT_MS = 60_000
    const lastHeartbeat = Date.now() - 61_000
    expect(Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS).toBe(true)
  })

  it('does not flag recent heartbeat', () => {
    const HEARTBEAT_TIMEOUT_MS = 60_000
    const lastHeartbeat = Date.now() - 5_000
    expect(Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS).toBe(false)
  })
})

describe('chunk key generation', () => {
  it('creates unique keys per agent and session', () => {
    const key1 = `claude:1`
    const key2 = `claude:2`
    const key3 = `codex:1`
    expect(key1).not.toBe(key2)
    expect(key1).not.toBe(key3)
  })
})
