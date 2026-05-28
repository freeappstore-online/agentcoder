import { execFileSync } from 'child_process'

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  )
}

/** Run a tmux command and return stdout */
function tmux(...args: string[]): string {
  try {
    return execFileSync('tmux', args, { encoding: 'utf-8', timeout: 5000 })
  } catch {
    return ''
  }
}

/** Check if a tmux session exists */
export function sessionExists(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/** List all tmux sessions */
export function listSessions(): string[] {
  const output = tmux('list-sessions', '-F', '#{session_name}')
  return output.trim().split('\n').filter(Boolean)
}

/** Capture the current screen content of a tmux pane */
export function captureScreen(target: string, lines = 500): string {
  const raw = tmux('capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', target)
  return stripAnsi(raw)
}

/** Send text to a tmux pane */
export function sendKeys(target: string, text: string): void {
  tmux('send-keys', '-t', target, '-l', text)
}

/** Send a special key (Enter, C-c, etc.) */
export function sendSpecialKey(target: string, key: string): void {
  tmux('send-keys', '-t', target, key)
}

/** Claude Code prompt detection */
function isClaudeReady(screen: string): boolean {
  const lines = screen.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return false
  const last = lines[lines.length - 1]!.trim()
  // Claude Code shows ❯ when ready for input
  // Only match the specific Unicode heavy right-pointing angle, not generic '>'
  return last.includes('\u276F')
}

function isClaudeProcessing(screen: string): boolean {
  const lower = screen.toLowerCase()
  return (
    lower.includes('ctrl+c to interrupt') ||
    lower.includes('thinking') ||
    lower.includes('writing') ||
    lower.includes('reading') ||
    lower.includes('editing')
  )
}

export type AgentState = 'ready' | 'busy' | 'waiting'

/** Detect agent state from screen content */
export function detectState(screen: string): AgentState {
  if (isClaudeProcessing(screen)) return 'busy'
  if (isClaudeReady(screen)) return 'ready'
  return 'waiting'
}

interface SendCommandOptions {
  target: string
  command: string
  onUpdate?: (partial: string) => void
  pollInterval?: number
  forceCompleteAfter?: number
}

/**
 * Send a command to tmux and wait for the agent to finish responding.
 * Streams partial updates via onUpdate callback.
 */
export async function sendCommand(opts: SendCommandOptions): Promise<string> {
  const {
    target,
    command,
    onUpdate,
    pollInterval = 500,
    forceCompleteAfter = 5 * 60 * 1000,
  } = opts

  // Send the command
  sendKeys(target, command)
  sendSpecialKey(target, 'Enter')

  // Wait a moment for the agent to start processing
  await sleep(1000)

  const startTime = Date.now()
  let lastContent = ''
  let stableCount = 0
  const stableThreshold = 3 // 3 consecutive identical captures = done

  while (Date.now() - startTime < forceCompleteAfter) {
    const screen = captureScreen(target)
    const state = detectState(screen)

    if (screen !== lastContent) {
      stableCount = 0
      lastContent = screen
      onUpdate?.(screen)
    } else {
      stableCount++
    }

    // Done if: agent is ready and output is stable
    if (state === 'ready' && stableCount >= stableThreshold) {
      return screen
    }

    await sleep(pollInterval)
  }

  // Force complete after timeout
  return lastContent
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
