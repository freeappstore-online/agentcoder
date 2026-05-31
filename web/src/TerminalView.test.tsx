import { describe, it, expect } from 'vitest'
import { highlightLine } from './TerminalView'

describe('highlightLine', () => {
  it('returns plain string for ordinary lines', () => {
    expect(highlightLine('hello world')).toBe('hello world')
  })

  it('returns plain string for empty line', () => {
    expect(highlightLine('')).toBe('')
  })

  it('highlights tool call lines as JSX', () => {
    const result = highlightLine('⏺ Read(src/index.ts)')
    expect(result).not.toBe('⏺ Read(src/index.ts)')
    expect(typeof result).toBe('object')
  })

  it('highlights Bash tool calls', () => {
    const result = highlightLine('⏺ Bash(npm test)')
    expect(typeof result).toBe('object')
  })

  it('highlights tool result lines', () => {
    const result = highlightLine('  ⎿ 42 lines read')
    expect(typeof result).toBe('object')
  })

  it('highlights thinking blocks', () => {
    const result = highlightLine('∴ Thinking about the problem...')
    expect(typeof result).toBe('object')
  })

  it('highlights diff added lines', () => {
    const result = highlightLine('+export function foo() {}')
    expect(typeof result).toBe('object')
  })

  it('highlights diff removed lines', () => {
    const result = highlightLine('-export function bar() {}')
    expect(typeof result).toBe('object')
  })

  it('highlights status lines', () => {
    const result = highlightLine('❯ fix the bug')
    expect(typeof result).toBe('object')
  })

  it('highlights done/success lines', () => {
    const result = highlightLine('⏺ Done.')
    expect(typeof result).toBe('object')
  })

  it('does not highlight tmux window list lines starting with +', () => {
    // "+ 1: shell" should not be highlighted as a diff line
    const result = highlightLine('+1: shell')
    expect(result).toBe('+1: shell')
  })

  it('does not highlight tmux separators starting with -', () => {
    // "--" should not be highlighted as diff removed
    const result = highlightLine('--')
    expect(result).toBe('--')
  })
})
