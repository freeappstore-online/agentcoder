import { describe, it, expect } from 'vitest'
import { detectState, extractResponse } from './tmux.js'

describe('detectState', () => {
  it('detects Claude ready state from ❯ prompt', () => {
    const screen = `some output\nmore output\n❯ `
    expect(detectState(screen)).toBe('ready')
  })

  it('detects ready from "bypass permissions"', () => {
    const screen = `Done editing.\nbypass permissions for this session\n❯ `
    expect(detectState(screen)).toBe('ready')
  })

  it('detects ready from "? for shortcuts"', () => {
    const screen = `Welcome to Claude Code\n? for shortcuts\n❯ `
    expect(detectState(screen)).toBe('ready')
  })

  it('detects busy when "ctrl+c to interrupt" is present', () => {
    const screen = `Claude is working...\n  ctrl+c to interrupt\nEditing file.ts`
    expect(detectState(screen)).toBe('busy')
  })

  it('detects busy from case-sensitive status labels', () => {
    expect(detectState('Thinking about the problem...\nAnalyzing code')).toBe('busy')
    expect(detectState('Writing to file auth.ts\nLine 42')).toBe('busy')
    expect(detectState('Reading package.json\nFound 12 dependencies')).toBe('busy')
    expect(detectState('Editing src/index.ts\nReplacing line 5')).toBe('busy')
    expect(detectState('Searching for files...')).toBe('busy')
    expect(detectState('Working on the task...')).toBe('busy')
    expect(detectState('Running npm test...')).toBe('busy')
  })

  it('returns waiting for unknown/ambiguous screens', () => {
    const screen = `$ npm test\nPASS all tests`
    expect(detectState(screen)).toBe('waiting')
  })

  it('returns waiting for empty screen', () => {
    expect(detectState('')).toBe('waiting')
  })

  it('does NOT false-positive on > in regular output', () => {
    const screen = `<div>Hello</div>\noutput > file.txt`
    expect(detectState(screen)).toBe('waiting')
  })

  it('detects ready with ❯ on last non-empty line', () => {
    const screen = `Done.\n\n❯ \n\n`
    expect(detectState(screen)).toBe('ready')
  })

  it('busy takes priority over ready', () => {
    const screen = `ctrl+c to interrupt\n❯ `
    expect(detectState(screen)).toBe('busy')
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
})
