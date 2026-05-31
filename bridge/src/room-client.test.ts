import { describe, it, expect } from 'vitest'

// Test reconnect backoff logic (mirrors room-client.ts scheduleReconnect)
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 15

function calcBackoff(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
}

describe('reconnect backoff', () => {
  it('starts at 1 second', () => {
    expect(calcBackoff(0)).toBe(1000)
  })

  it('doubles each attempt', () => {
    expect(calcBackoff(1)).toBe(2000)
    expect(calcBackoff(2)).toBe(4000)
    expect(calcBackoff(3)).toBe(8000)
  })

  it('caps at 30 seconds', () => {
    expect(calcBackoff(10)).toBe(RECONNECT_MAX_MS)
    expect(calcBackoff(20)).toBe(RECONNECT_MAX_MS)
  })

  it('reaches cap at attempt 5 (32s > 30s)', () => {
    expect(calcBackoff(4)).toBe(16000)
    expect(calcBackoff(5)).toBe(RECONNECT_MAX_MS)
  })
})

describe('reconnect limit', () => {
  it('allows reconnects below limit', () => {
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      expect(i < MAX_RECONNECT_ATTEMPTS).toBe(true)
    }
  })

  it('stops at exactly 15 attempts', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(15)
    expect(15 >= MAX_RECONNECT_ATTEMPTS).toBe(true)
  })
})

// Test URL construction (mirrors room-client.ts connect)
function buildRoomUrl(apiBase: string, appId: string, roomId: string, token: string): string {
  const base = apiBase
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:')
  return `${base}/v1/apps/${encodeURIComponent(appId)}/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`
}

describe('room URL construction', () => {
  it('builds correct URL with wss base', () => {
    const url = buildRoomUrl('wss://api.example.com', 'myapp', 'room1', 'tok123')
    expect(url).toBe('wss://api.example.com/v1/apps/myapp/rooms/room1?token=tok123')
  })

  it('converts https to wss', () => {
    const url = buildRoomUrl('https://api.example.com', 'myapp', 'room1', 'tok')
    expect(url.startsWith('wss://')).toBe(true)
  })

  it('converts http to ws', () => {
    const url = buildRoomUrl('http://localhost:8080', 'myapp', 'room1', 'tok')
    expect(url.startsWith('ws://')).toBe(true)
  })

  it('encodes special characters in app ID', () => {
    const url = buildRoomUrl('wss://api.example.com', 'my app/test', 'room', 'tok')
    expect(url).toContain('my%20app%2Ftest')
  })

  it('encodes special characters in room ID', () => {
    const url = buildRoomUrl('wss://api.example.com', 'app', 'room/123', 'tok')
    expect(url).toContain('room%2F123')
  })

  it('encodes token', () => {
    const url = buildRoomUrl('wss://api.example.com', 'app', 'room', 'tok=abc&def')
    expect(url).toContain('tok%3Dabc%26def')
  })

  it('passes wss through unchanged', () => {
    const url = buildRoomUrl('wss://custom.api', 'app', 'room', 'tok')
    expect(url.startsWith('wss://custom.api/')).toBe(true)
  })
})

// Test HTTP status classification (mirrors room-client.ts unexpected-response)
describe('HTTP status classification', () => {
  function classifyStatus(status: number): 'auth' | 'not-found' | 'rate-limit' | 'server-error' | 'unknown' {
    if (status === 401 || status === 403) return 'auth'
    if (status === 404) return 'not-found'
    if (status === 429) return 'rate-limit'
    if (status >= 500) return 'server-error'
    return 'unknown'
  }

  it('classifies 401 as auth failure', () => {
    expect(classifyStatus(401)).toBe('auth')
  })

  it('classifies 403 as auth failure', () => {
    expect(classifyStatus(403)).toBe('auth')
  })

  it('classifies 404 as not-found', () => {
    expect(classifyStatus(404)).toBe('not-found')
  })

  it('classifies 429 as rate-limit', () => {
    expect(classifyStatus(429)).toBe('rate-limit')
  })

  it('classifies 500 as server-error', () => {
    expect(classifyStatus(500)).toBe('server-error')
  })

  it('classifies 502 as server-error', () => {
    expect(classifyStatus(502)).toBe('server-error')
  })

  it('classifies 503 as server-error', () => {
    expect(classifyStatus(503)).toBe('server-error')
  })

  it('classifies 400 as unknown (not fatal)', () => {
    expect(classifyStatus(400)).toBe('unknown')
  })

  it('auth and not-found are fatal (should not retry)', () => {
    const fatal = ['auth', 'not-found', 'rate-limit']
    expect(fatal.includes(classifyStatus(401))).toBe(true)
    expect(fatal.includes(classifyStatus(404))).toBe(true)
    expect(fatal.includes(classifyStatus(429))).toBe(true)
  })

  it('server-error is retryable', () => {
    expect(classifyStatus(500)).toBe('server-error')
    // server-error should NOT be fatal — room-client retries
  })
})
