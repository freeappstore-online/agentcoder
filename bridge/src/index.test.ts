import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    expect(result).toHaveLength(3) // 3500 + 3500 + 3000
    expect(result[0].seq).toBe(0)
    expect(result[0].total).toBe(3)
    expect(result[1].seq).toBe(1)
    expect(result[2].seq).toBe(2)
    // Reassemble
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
    // Use realistic terminal output with mixed chars
    const content = Array.from({ length: 200 }, (_, i) =>
      `[2026-05-29 10:${String(i).padStart(2, '0')}] Claude edited src/file${i}.ts — added error handling for edge case #${i}\n`
    ).join('')
    const result = chunkContent(content)
    const reassembled = result.map((c) => c.content).join('')
    expect(reassembled).toBe(content)
  })
})

// Test rolling buffer logic extracted from Bridge.appendBuffer
function appendBuffer(existing: string, content: string, maxSize = 500_000): string {
  const buf = existing + content
  if (buf.length > maxSize) return buf.slice(-maxSize)
  return buf
}

describe('appendBuffer (rolling buffer)', () => {
  it('appends content normally under limit', () => {
    expect(appendBuffer('hello', ' world')).toBe('hello world')
  })

  it('trims oldest content when over limit', () => {
    const existing = 'a'.repeat(400_000)
    const newContent = 'b'.repeat(200_000)
    const result = appendBuffer(existing, newContent)
    expect(result.length).toBe(500_000)
    expect(result.endsWith('b'.repeat(200_000))).toBe(true)
    expect(result.startsWith('a')).toBe(true)
  })

  it('keeps most recent content when way over limit', () => {
    const existing = 'a'.repeat(500_000)
    const newContent = 'b'.repeat(500_000)
    const result = appendBuffer(existing, newContent)
    expect(result.length).toBe(500_000)
    expect(result).toBe('b'.repeat(500_000))
  })
})
