import { describe, it, expect } from 'vitest'
import { detectState } from './tmux.js'

describe('detectState', () => {
  it('detects Claude ready state from ❯ prompt', () => {
    const screen = `some output\nmore output\n❯ `
    expect(detectState(screen)).toBe('ready')
  })

  it('detects busy when "ctrl+c to interrupt" is present', () => {
    const screen = `Claude is working...\n  ctrl+c to interrupt\nEditing file.ts`
    expect(detectState(screen)).toBe('busy')
  })

  it('detects busy when "thinking" is present', () => {
    const screen = `Thinking about the problem...\nAnalyzing code`
    expect(detectState(screen)).toBe('busy')
  })

  it('detects busy when "writing" is present', () => {
    const screen = `Writing to file auth.ts\nLine 42`
    expect(detectState(screen)).toBe('busy')
  })

  it('detects busy when "reading" is present', () => {
    const screen = `Reading package.json\nFound 12 dependencies`
    expect(detectState(screen)).toBe('busy')
  })

  it('detects busy when "editing" is present', () => {
    const screen = `Editing src/index.ts\nReplacing line 5`
    expect(detectState(screen)).toBe('busy')
  })

  it('returns waiting for unknown/ambiguous screens', () => {
    const screen = `$ npm test\nPASS all tests`
    expect(detectState(screen)).toBe('waiting')
  })

  it('returns waiting for empty screen', () => {
    expect(detectState('')).toBe('waiting')
  })

  it('does NOT false-positive on > in regular output', () => {
    // This was a bug — generic > matched HTML, shell prompts, etc.
    const screen = `<div>Hello</div>\noutput > file.txt`
    expect(detectState(screen)).toBe('waiting')
  })

  it('detects ready with ❯ on last non-empty line', () => {
    const screen = `Done.\n\n❯ \n\n`
    expect(detectState(screen)).toBe('ready')
  })

  it('busy takes priority over ready', () => {
    // If both patterns match, busy should win (agent is still working)
    const screen = `ctrl+c to interrupt\n❯ `
    expect(detectState(screen)).toBe('busy')
  })
})
