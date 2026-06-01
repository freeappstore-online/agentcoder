import { describe, it, expect } from 'vitest'

// Test session ID validation (extracted from ConnectBridge)
const SESSION_ID_RE = /^[a-zA-Z0-9-]{1,32}$/

describe('session ID validation', () => {
  it('accepts simple alphanumeric ID', () => {
    expect(SESSION_ID_RE.test('my-session')).toBe(true)
  })

  it('accepts single character', () => {
    expect(SESSION_ID_RE.test('a')).toBe(true)
  })

  it('accepts max length (32 chars)', () => {
    expect(SESSION_ID_RE.test('a'.repeat(32))).toBe(true)
  })

  it('rejects empty string', () => {
    expect(SESSION_ID_RE.test('')).toBe(false)
  })

  it('rejects string over 32 chars', () => {
    expect(SESSION_ID_RE.test('a'.repeat(33))).toBe(false)
  })

  it('rejects spaces', () => {
    expect(SESSION_ID_RE.test('my session')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(SESSION_ID_RE.test('foo@bar')).toBe(false)
    expect(SESSION_ID_RE.test('a/b')).toBe(false)
    expect(SESSION_ID_RE.test('x.y')).toBe(false)
  })
})
