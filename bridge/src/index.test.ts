import { describe, it, expect } from 'vitest'

// Test the chunking logic extracted from Bridge.sendOutput
function chunkContent(content: string, chunkSize = 3500): Array<{ content: string; seq: number; total?: number }> {
  if (content.length <= chunkSize) {
    return [{ content, seq: 0 }]
  }
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize))
  }
  return chunks.map((c, i) => ({ content: c, seq: i, total: chunks.length }))
}

describe('chunkContent', () => {
  it('returns single chunk for small content', () => {
    const result = chunkContent('hello world')
    expect(result).toHaveLength(1)
    expect(result[0].seq).toBe(0)
    expect(result[0].total).toBeUndefined()
    expect(result[0].content).toBe('hello world')
  })

  it('splits large content into 3.5KB chunks', () => {
    const content = 'x'.repeat(10000)
    const result = chunkContent(content)
    expect(result).toHaveLength(3)
    expect(result[0].seq).toBe(0)
    expect(result[0].total).toBe(3)
    const reassembled = result.map((c) => c.content).join('')
    expect(reassembled).toBe(content)
  })

  it('handles content exactly at chunk boundary', () => {
    const content = 'x'.repeat(3500)
    const result = chunkContent(content)
    expect(result).toHaveLength(1)
    expect(result[0].total).toBeUndefined()
  })

  it('handles content just over chunk boundary', () => {
    const content = 'x'.repeat(3501)
    const result = chunkContent(content)
    expect(result).toHaveLength(2)
    expect(result[0].content).toHaveLength(3500)
    expect(result[1].content).toHaveLength(1)
  })

  it('preserves all content through chunking', () => {
    const content = Array.from({ length: 200 }, (_, i) =>
      `[2026-05-29 10:${String(i).padStart(2, '0')}] Claude edited src/file${i}.ts\n`
    ).join('')
    const result = chunkContent(content)
    const reassembled = result.map((c) => c.content).join('')
    expect(reassembled).toBe(content)
  })
})

// Test per-agent screen replacement logic (mirrors use-bridge.ts applyScreen)
function applyScreen(buffer: string, screen: string, agent: string, maxSize = 500_000): string {
  const marker = `\n--- ${agent} ---\n`
  const idx = buffer.indexOf(marker)
  let buf: string
  if (idx >= 0) {
    const afterMarker = idx + marker.length
    const nextMarker = buffer.indexOf('\n--- ', afterMarker)
    const before = buffer.slice(0, idx)
    const after = nextMarker >= 0 ? buffer.slice(nextMarker) : ''
    buf = before + marker + screen + after
  } else {
    buf = buffer + marker + screen
  }
  if (buf.length > maxSize) buf = buf.slice(-maxSize)
  return buf
}

describe('applyScreen (per-agent replacement)', () => {
  it('appends first screen for a new agent', () => {
    const result = applyScreen('', 'screen content', 'claude')
    expect(result).toContain('--- claude ---')
    expect(result).toContain('screen content')
  })

  it('replaces screen for same agent', () => {
    const buf1 = applyScreen('', 'old screen', 'claude')
    const buf2 = applyScreen(buf1, 'new screen', 'claude')
    expect(buf2).toContain('new screen')
    expect(buf2).not.toContain('old screen')
    // Only one marker
    expect(buf2.split('--- claude ---').length).toBe(2)
  })

  it('preserves other agents when replacing', () => {
    let buf = applyScreen('', 'agent1 output', 'agent1')
    buf = applyScreen(buf, 'agent2 output', 'agent2')
    buf = applyScreen(buf, 'agent1 updated', 'agent1')
    expect(buf).toContain('agent1 updated')
    expect(buf).toContain('agent2 output')
    expect(buf).not.toContain('agent1 output')
  })

  it('trims when over max size', () => {
    const bigScreen = 'x'.repeat(600_000)
    const result = applyScreen('', bigScreen, 'claude', 500_000)
    expect(result.length).toBe(500_000)
  })
})
