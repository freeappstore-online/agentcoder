import { describe, it, expect } from 'vitest'
import { detectState, extractResponse } from './tmux.js'

describe('detectState', () => {
  it('detects Claude ready state from ❯ prompt', () => {
    expect(detectState('some output\nmore output\n❯ ')).toBe('ready')
  })

  it('detects ready from "bypass permissions"', () => {
    expect(detectState('Done editing.\nbypass permissions for this session\n❯ ')).toBe('ready')
  })

  it('detects ready from "? for shortcuts"', () => {
    expect(detectState('Welcome to Claude Code\n? for shortcuts\n❯ ')).toBe('ready')
  })

  it('detects ready from ❯ with send hint', () => {
    expect(detectState('output\n❯ fix the bug ↵ send')).toBe('ready')
  })

  it('detects ready with ❯ buried in last 15 lines', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i}`)
    lines.push('❯ ')
    expect(detectState(lines.join('\n'))).toBe('ready')
  })

  it('does NOT detect ready if ❯ is beyond last 15 lines', () => {
    const lines = ['❯ ', ...Array.from({ length: 16 }, (_, i) => `line ${i}`)]
    expect(detectState(lines.join('\n'))).toBe('waiting')
  })

  it('detects busy when "ctrl+c to interrupt" is present', () => {
    expect(detectState('Claude is working...\n  ctrl+c to interrupt\nEditing file.ts')).toBe('busy')
  })

  it('detects busy from case-sensitive status labels', () => {
    expect(detectState('Thinking about the problem...')).toBe('busy')
    expect(detectState('Writing to file auth.ts')).toBe('busy')
    expect(detectState('Reading package.json')).toBe('busy')
    expect(detectState('Editing src/index.ts')).toBe('busy')
    expect(detectState('Searching for files...')).toBe('busy')
    expect(detectState('Working on the task...')).toBe('busy')
    expect(detectState('Running npm test...')).toBe('busy')
  })

  it('does NOT false-positive on lowercase status words', () => {
    // "reading" in prose shouldn't trigger busy
    expect(detectState('I was reading the docs and found\n❯ ')).toBe('ready')
  })

  it('returns waiting for unknown/ambiguous screens', () => {
    expect(detectState('$ npm test\nPASS all tests')).toBe('waiting')
  })

  it('returns waiting for empty screen', () => {
    expect(detectState('')).toBe('waiting')
  })

  it('does NOT false-positive on > in regular output', () => {
    expect(detectState('<div>Hello</div>\noutput > file.txt')).toBe('waiting')
  })

  it('detects ready with ❯ on last non-empty line followed by blanks', () => {
    expect(detectState('Done.\n\n❯ \n\n')).toBe('ready')
  })

  it('busy takes priority over ready', () => {
    expect(detectState('ctrl+c to interrupt\n❯ ')).toBe('busy')
  })
})

describe('extractResponse', () => {
  it('extracts response between input and next prompt', () => {
    const captured = [
      '❯ fix the bug',
      'I found the issue in auth.ts.',
      'The token was expired.',
      '────────────────',
      '❯ ',
    ].join('\n')
    const response = extractResponse(captured, 'fix the bug')
    expect(response).toContain('I found the issue')
    expect(response).toContain('token was expired')
    expect(response).not.toContain('❯')
    expect(response).not.toContain('────')
  })

  it('returns full capture when input not found', () => {
    const captured = 'some random output\nanother line'
    expect(extractResponse(captured, 'nonexistent input')).toBe(captured)
  })

  it('handles input appearing in middle of screen', () => {
    const captured = [
      'old output',
      '❯ add tests',
      'Added 5 test cases to auth.test.ts',
      'All tests passing.',
      '❯ ',
    ].join('\n')
    const response = extractResponse(captured, 'add tests')
    expect(response).toContain('Added 5 test cases')
    expect(response).not.toContain('old output')
  })

  it('skips status lines (token counts, bypass) when finding end', () => {
    const captured = [
      '❯ refactor auth',
      'Refactored into 3 modules.',
      '[Opus 4 · 1.2k tokens]',
      'bypass permissions for this session',
      '❯ ',
    ].join('\n')
    const response = extractResponse(captured, 'refactor auth')
    expect(response).toContain('Refactored')
    expect(response).toContain('tokens')
    expect(response).toContain('bypass')
  })

  it('handles multi-line response with blank lines', () => {
    const captured = [
      '❯ explain this code',
      '',
      'This function does X.',
      '',
      'It works by Y.',
      '',
      '────────────────',
      '❯ ',
    ].join('\n')
    const response = extractResponse(captured, 'explain this code')
    expect(response).toContain('This function does X')
    expect(response).toContain('It works by Y')
  })

  it('falls back to input anywhere when no ❯ prefix', () => {
    const captured = [
      'some context',
      'fix the bug',
      'Fixed the null check in auth.ts.',
      '❯ ',
    ].join('\n')
    const response = extractResponse(captured, 'fix the bug')
    expect(response).toContain('Fixed the null check')
  })
})
