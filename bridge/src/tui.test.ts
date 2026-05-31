import { describe, it, expect } from 'vitest'
import { formatUptime, formatAge, formatBytes } from './tui.js'

describe('formatUptime', () => {
  it('formats sub-minute as seconds', () => {
    expect(formatUptime(5000)).toBe('5s')
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(59_999)).toBe('59s')
  })

  it('formats minutes with seconds', () => {
    expect(formatUptime(60_000)).toBe('1m 0s')
    expect(formatUptime(125_000)).toBe('2m 5s')
    expect(formatUptime(3_599_000)).toBe('59m 59s')
  })

  it('formats hours with minutes', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m')
    expect(formatUptime(3_725_000)).toBe('1h 2m')
    expect(formatUptime(7_380_000)).toBe('2h 3m')
  })
})

describe('formatAge', () => {
  it('returns now for sub-second', () => {
    expect(formatAge(0)).toBe('now')
    expect(formatAge(500)).toBe('now')
    expect(formatAge(999)).toBe('now')
  })

  it('formats seconds', () => {
    expect(formatAge(1000)).toBe('1s ago')
    expect(formatAge(30_000)).toBe('30s ago')
    expect(formatAge(59_000)).toBe('59s ago')
  })

  it('formats minutes', () => {
    expect(formatAge(60_000)).toBe('1m ago')
    expect(formatAge(120_000)).toBe('2m ago')
    expect(formatAge(300_000)).toBe('5m ago')
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(500)).toBe('500B')
    expect(formatBytes(1023)).toBe('1023B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0KB')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(153_600)).toBe('150.0KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1_048_576)).toBe('1.0MB')
    expect(formatBytes(5_242_880)).toBe('5.0MB')
  })
})
