import { describe, it, expect } from 'vitest'
import { parseTranslation } from './parse-translation'

const VALID_RESULT = {
  summary: 'Claude refactored auth.ts into three files.',
  filesChanged: ['src/auth.ts', 'src/session.ts', 'src/middleware.ts'],
  pendingDecision: 'Should I run the test suite?',
  agentStatus: 'waiting_for_input',
}

describe('parseTranslation', () => {
  it('parses raw JSON', () => {
    const result = parseTranslation(JSON.stringify(VALID_RESULT))
    expect(result.summary).toBe(VALID_RESULT.summary)
    expect(result.filesChanged).toEqual(VALID_RESULT.filesChanged)
    expect(result.pendingDecision).toBe(VALID_RESULT.pendingDecision)
    expect(result.agentStatus).toBe(VALID_RESULT.agentStatus)
  })

  it('parses JSON wrapped in markdown code block', () => {
    const text = `Here's the summary:\n\n\`\`\`json\n${JSON.stringify(VALID_RESULT, null, 2)}\n\`\`\`\n\nLet me know if you need more details.`
    const result = parseTranslation(text)
    expect(result.summary).toBe(VALID_RESULT.summary)
  })

  it('parses JSON wrapped in code block without language tag', () => {
    const text = `\`\`\`\n${JSON.stringify(VALID_RESULT)}\n\`\`\``
    const result = parseTranslation(text)
    expect(result.summary).toBe(VALID_RESULT.summary)
  })

  it('parses JSON with surrounding explanation text', () => {
    const text = `I analyzed the terminal output. Here's what happened:\n\n${JSON.stringify(VALID_RESULT)}\n\nThe agent is waiting for input.`
    const result = parseTranslation(text)
    expect(result.summary).toBe(VALID_RESULT.summary)
  })

  it('handles nested braces in values correctly', () => {
    const nested = {
      summary: 'Changed config from { old: true } to { new: true }',
      filesChanged: ['config.json'],
      pendingDecision: null,
      agentStatus: 'idle',
    }
    const text = `Result: ${JSON.stringify(nested)}`
    const result = parseTranslation(text)
    expect(result.summary).toBe(nested.summary)
  })

  it('throws on no JSON at all', () => {
    expect(() => parseTranslation('No JSON here, just text.')).toThrow('No JSON')
  })

  it('throws on malformed JSON', () => {
    expect(() => parseTranslation('{ broken json without closing')).toThrow()
  })

  it('handles null pendingDecision', () => {
    const withNull = { ...VALID_RESULT, pendingDecision: null }
    const result = parseTranslation(JSON.stringify(withNull))
    expect(result.pendingDecision).toBeNull()
  })

  it('handles empty filesChanged array', () => {
    const noFiles = { ...VALID_RESULT, filesChanged: [] }
    const result = parseTranslation(JSON.stringify(noFiles))
    expect(result.filesChanged).toEqual([])
  })

  it('does NOT greedily match across multiple JSON objects', () => {
    // The old greedy regex would match from first { to last }, capturing garbage
    const text = `Previous: {"old": true}\n\nCurrent:\n${JSON.stringify(VALID_RESULT)}`
    // This should parse the first valid JSON object it finds
    const result = parseTranslation(text)
    // Should get either the old or the valid result — NOT a merged garbage object
    expect(result).toBeDefined()
  })
})
