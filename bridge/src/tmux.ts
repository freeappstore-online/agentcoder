import { execFileSync } from 'child_process'

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  )
}

/** Run a tmux command and return stdout (safe — no shell interpolation) */
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
    execFileSync('tmux', ['has-session', '-t', name], { timeout: 3000, stdio: 'pipe' })
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

/**
 * Capture the current screen content of a tmux pane.
 * Uses -J to join wrapped lines (prevents jumbled text).
 */
export function captureScreen(target: string, lines = 500): string {
  const raw = tmux('capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', target)
  return stripAnsi(raw)
}

/** Send literal text to a tmux pane (safe — no shell interpolation) */
export function sendKeys(target: string, text: string): void {
  tmux('send-keys', '-t', target, '-l', text)
}

/** Send a special key (Enter, C-c, Escape, etc.) */
export function sendSpecialKey(target: string, key: string): void {
  tmux('send-keys', '-t', target, key)
}

// ---------------------------------------------------------------------------
// Claude Code prompt detection (ported from ~/dev/ac/platform)
// ---------------------------------------------------------------------------

/** Check if Claude Code is ready for input */
function isClaudeReady(screen: string): boolean {
  // If showing the interrupt hint, definitely busy
  if (screen.includes('ctrl+c to interrupt')) return false

  // Check last 15 non-empty lines for prompt indicators
  const lines = screen.split('\n').slice(-15)
  const tail = lines.join('\n')

  // Claude Code prompt patterns:
  // - ❯ (heavy right-pointing angle) with optional text
  // - "bypass permissions" line
  // - "? for shortcuts"
  if (
    tail.includes('bypass permissions') ||
    tail.includes('? for shortcuts') ||
    /❯\s*$/.test(tail) ||
    /❯ .*↵ send/.test(tail)
  ) {
    return true
  }

  return false
}

/** Check if Claude Code is actively processing */
function isClaudeProcessing(screen: string): boolean {
  if (screen.includes('ctrl+c to interrupt')) return true
  // Case-sensitive — these are Claude Code's exact status labels
  return /Working|Thinking|Reading|Searching|Running|Editing|Writing/.test(screen)
}

export type AgentState = 'ready' | 'busy' | 'waiting'

/** Detect agent state from screen content */
export function detectState(screen: string): AgentState {
  if (isClaudeProcessing(screen)) return 'busy'
  if (isClaudeReady(screen)) return 'ready'
  return 'waiting'
}

// ---------------------------------------------------------------------------
// Response extraction (ported from ~/dev/ac/platform)
// ---------------------------------------------------------------------------

/**
 * Extract the agent's response from a screen capture,
 * stripping the user's input line and the trailing prompt.
 */
export function extractResponse(captured: string, userInput: string): string {
  const lines = captured.split('\n')
  const inputPrefix = userInput.slice(0, 25)

  // Find the line containing the user's input (search backwards)
  let startIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (line.startsWith('❯') && line.includes(inputPrefix)) {
      startIdx = i
      break
    }
  }
  // Fallback: search for input anywhere
  if (startIdx === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.includes(inputPrefix)) {
        startIdx = i
        break
      }
    }
  }
  // Not found — return full capture
  if (startIdx === -1) return captured

  // Find end: look backwards from end for the final prompt
  let endIdx = lines.length
  for (let i = lines.length - 1; i > startIdx; i--) {
    const line = lines[i]!.trim()
    const isPromptLine = line === '❯' || line.startsWith('❯ ')
    const isStatusLine =
      line.includes('⏵⏵') ||
      /\[Opus.*tokens\]/.test(line) ||
      line.includes('bypass permissions') ||
      line.includes('? for shortcuts')

    if (isPromptLine && !isStatusLine) {
      let potentialEnd = i
      // Skip separator line (─────) before prompt
      if (i > 0 && /^─+$/.test(lines[i - 1]!.trim())) {
        potentialEnd = i - 1
        // Also skip blank lines before separator
        let j = potentialEnd - 1
        while (j > startIdx && lines[j]!.trim() === '') j--
        if (j < potentialEnd - 1) potentialEnd = j + 1
      }
      endIdx = potentialEnd
      break
    }
  }

  const response = lines.slice(startIdx + 1, endIdx).join('\n')

  // If empty, return more context as fallback
  if (!response.trim()) {
    return lines.slice(-500).join('\n')
  }

  return response
}

// ---------------------------------------------------------------------------
// Send command and wait for completion
// ---------------------------------------------------------------------------

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

  sendKeys(target, command)
  sendSpecialKey(target, 'Enter')

  await sleep(1000)

  const startTime = Date.now()
  let lastContent = ''
  let lastChangeTime = Date.now()
  let sawProcessing = false
  const stableThreshold = 2000

  while (Date.now() - startTime < forceCompleteAfter) {
    // Capture with deep scrollback for long responses
    const screen = captureScreen(target, 5000)
    const state = detectState(screen)

    if (screen !== lastContent) {
      lastChangeTime = Date.now()
      lastContent = screen
      onUpdate?.(screen)
    }

    if (state === 'busy') {
      sawProcessing = true
    }

    // Done: agent is ready and output has been stable
    const timeSinceChange = Date.now() - lastChangeTime
    if (state === 'ready' && sawProcessing && timeSinceChange >= stableThreshold) {
      break
    }
    // Also done if prompt detected and enough time has passed
    if (state === 'ready' && Date.now() - startTime > 2000) {
      break
    }

    await sleep(pollInterval)
  }

  // Final capture with deep scrollback
  const finalScreen = captureScreen(target, 5000)
  return extractResponse(finalScreen, command)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
