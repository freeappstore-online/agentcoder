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

// Test per-agent buffer replacement (mirrors use-bridge.ts)
describe('per-agent buffers', () => {
  it('stores screen per agent', () => {
    const buffers: Record<string, string> = {}
    buffers['claude'] = 'screen A'
    buffers['codex'] = 'screen B'
    expect(buffers['claude']).toBe('screen A')
    expect(buffers['codex']).toBe('screen B')
  })

  it('replaces screen for same agent', () => {
    const buffers: Record<string, string> = {}
    buffers['claude'] = 'old screen'
    buffers['claude'] = 'new screen'
    expect(buffers['claude']).toBe('new screen')
  })

  it('preserves other agents when replacing', () => {
    const buffers: Record<string, string> = {}
    buffers['agent1'] = 'output 1'
    buffers['agent2'] = 'output 2'
    buffers['agent1'] = 'updated 1'
    expect(buffers['agent1']).toBe('updated 1')
    expect(buffers['agent2']).toBe('output 2')
  })

  it('truncates when over max size', () => {
    const MAX = 500_000
    let buf = 'x'.repeat(600_000)
    if (buf.length > MAX) buf = buf.slice(-MAX)
    expect(buf.length).toBe(MAX)
  })
})

// Test chunk reassembly (mirrors use-bridge.ts)
describe('chunk reassembly', () => {
  it('reassembles multi-chunk messages in order', () => {
    const chunks = new Map<string, { parts: string[]; total: number }>()
    const chunkKey = 'agent:1'

    // Simulate 3 chunks arriving
    chunks.set(chunkKey, { parts: [], total: 3 })
    const entry = chunks.get(chunkKey)!
    entry.parts[0] = 'aaa'
    entry.parts[1] = 'bbb'
    entry.parts[2] = 'ccc'

    const received = entry.parts.filter(Boolean).length
    expect(received).toBe(3)
    expect(entry.parts.join('')).toBe('aaabbbccc')
  })

  it('handles out-of-order chunks', () => {
    const parts: string[] = []
    parts[2] = 'ccc'
    parts[0] = 'aaa'
    parts[1] = 'bbb'
    expect(parts.filter(Boolean).length).toBe(3)
    expect(parts.join('')).toBe('aaabbbccc')
  })

  it('detects incomplete chunks', () => {
    const parts: string[] = []
    parts[0] = 'aaa'
    parts[2] = 'ccc'
    // parts[1] missing
    expect(parts.filter(Boolean).length).toBe(2)
  })
})
