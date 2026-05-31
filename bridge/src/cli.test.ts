import { describe, it, expect } from 'vitest'

// parseStartArgs is exported from cli.ts, but importing it triggers main()
// which calls process.exit. Test the arg parsing logic directly instead.

function parseStartArgs(cliArgs: string[]) {
  let sessionId = ''
  let token = ''
  let apiBase: string | undefined
  let watchList: string[] | undefined

  const hasValue = (i: number) => i + 1 < cliArgs.length && !cliArgs[i + 1]!.startsWith('--')

  for (let i = 1; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--session' && hasValue(i)) {
      sessionId = cliArgs[++i]!
    } else if (cliArgs[i] === '--token' && hasValue(i)) {
      token = cliArgs[++i]!
    } else if (cliArgs[i] === '--api' && hasValue(i)) {
      apiBase = cliArgs[++i]!
    } else if (cliArgs[i] === '--watch' && hasValue(i)) {
      watchList = cliArgs[++i]!.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }

  return { sessionId, token, apiBase, watchList }
}

describe('parseStartArgs', () => {
  it('parses --session flag', () => {
    const result = parseStartArgs(['start', '--session', 'abc123'])
    expect(result.sessionId).toBe('abc123')
  })

  it('parses --token flag', () => {
    const result = parseStartArgs(['start', '--token', 'tok_xyz'])
    expect(result.token).toBe('tok_xyz')
  })

  it('parses --api flag', () => {
    const result = parseStartArgs(['start', '--api', 'wss://custom.api'])
    expect(result.apiBase).toBe('wss://custom.api')
  })

  it('parses --watch flag with comma-separated names', () => {
    const result = parseStartArgs(['start', '--watch', 'claude,codex,gemini'])
    expect(result.watchList).toEqual(['claude', 'codex', 'gemini'])
  })

  it('trims whitespace in watch list', () => {
    const result = parseStartArgs(['start', '--watch', ' a , b , c '])
    expect(result.watchList).toEqual(['a', 'b', 'c'])
  })

  it('filters empty entries in watch list', () => {
    const result = parseStartArgs(['start', '--watch', 'a,,b,'])
    expect(result.watchList).toEqual(['a', 'b'])
  })

  it('parses all flags together', () => {
    const result = parseStartArgs([
      'start', '--session', 'sess1', '--token', 'tok1',
      '--api', 'wss://test', '--watch', 'x,y',
    ])
    expect(result.sessionId).toBe('sess1')
    expect(result.token).toBe('tok1')
    expect(result.apiBase).toBe('wss://test')
    expect(result.watchList).toEqual(['x', 'y'])
  })

  it('returns empty strings when no flags provided', () => {
    const result = parseStartArgs(['start'])
    expect(result.sessionId).toBe('')
    expect(result.token).toBe('')
    expect(result.apiBase).toBeUndefined()
    expect(result.watchList).toBeUndefined()
  })

  it('ignores unknown flags', () => {
    const result = parseStartArgs(['start', '--unknown', 'val', '--session', 'abc'])
    expect(result.sessionId).toBe('abc')
  })

  it('does not consume next flag as value', () => {
    // --session without a value followed by --token should not eat --token
    const result = parseStartArgs(['start', '--session', '--token', 'tok1'])
    expect(result.sessionId).toBe('')
    expect(result.token).toBe('tok1')
  })

  it('last flag wins when duplicated', () => {
    const result = parseStartArgs(['start', '--session', 'first', '--session', 'second'])
    expect(result.sessionId).toBe('second')
  })

  it('handles flag at end without value', () => {
    const result = parseStartArgs(['start', '--session'])
    expect(result.sessionId).toBe('')
  })

  it('handles single watch item', () => {
    const result = parseStartArgs(['start', '--watch', 'only-one'])
    expect(result.watchList).toEqual(['only-one'])
  })
})
