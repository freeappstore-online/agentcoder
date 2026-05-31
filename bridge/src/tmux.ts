import { execFileSync } from 'child_process'

const TMUX_CMD_TIMEOUT_MS = 5000
const SESSION_CHECK_TIMEOUT_MS = 3000

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  )
}

/** Check if tmux is installed and reachable */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { encoding: 'utf-8', timeout: SESSION_CHECK_TIMEOUT_MS, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Run a tmux command and return stdout (safe — no shell interpolation) */
function tmux(...args: string[]): string {
  try {
    return execFileSync('tmux', args, { encoding: 'utf-8', timeout: TMUX_CMD_TIMEOUT_MS })
  } catch {
    return ''
  }
}

/**
 * Get the best tmux target for a session.
 * Finds the pane running Claude Code (by title/window name),
 * falls back to the session's active pane.
 */
export function getTarget(sessionName: string): string {
  // List panes for this session only (no -a flag)
  const paneLines = tmux(
    'list-panes', '-t', sessionName, '-s',
    '-F', '#{session_name}:#{window_index}.#{pane_index} #{window_name} #{pane_title}',
  )
  if (!paneLines.trim()) return sessionName

  const lines = paneLines.trim().split('\n')
  for (const line of lines) {
    const lower = line.toLowerCase()
    // Match Claude Code by pane title or window name
    if (lower.includes('claude') || lower.includes('✳')) {
      const target = line.split(' ')[0]
      if (target) return target
    }
  }

  // No Claude pane found — use session's active pane (tmux default)
  return sessionName
}

export interface TmuxWindow {
  target: string       // e.g. "aipa:1.0"
  sessionName: string  // e.g. "aipa"
  windowIndex: number
  windowName: string   // e.g. "shell"
  paneTitle: string    // e.g. "✳ Claude Code"
  isClaude: boolean
}

/** List all windows/panes for a session */
export function listWindows(sessionName: string): TmuxWindow[] {
  const paneLines = tmux(
    'list-panes', '-t', sessionName, '-s',
    '-F', '#{session_name}:#{window_index}.#{pane_index}\t#{window_index}\t#{window_name}\t#{pane_title}',
  )
  if (!paneLines.trim()) return []

  const seen = new Set<number>()
  const windows: TmuxWindow[] = []

  for (const line of paneLines.trim().split('\n')) {
    const [target, idxStr, windowName, paneTitle] = line.split('\t')
    if (!target) continue
    const windowIndex = parseInt(idxStr ?? '0', 10)
    // Only show first pane per window
    if (seen.has(windowIndex)) continue
    seen.add(windowIndex)

    const lower = `${windowName} ${paneTitle}`.toLowerCase()
    windows.push({
      target,
      sessionName,
      windowIndex,
      windowName: windowName ?? '',
      paneTitle: paneTitle ?? '',
      isClaude: lower.includes('claude') || lower.includes('✳'),
    })
  }
  return windows
}

/** Check if a tmux session exists */
export function sessionExists(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { timeout: SESSION_CHECK_TIMEOUT_MS, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** List all tmux sessions */
export function listSessions(): string[] {
  const sessionList = tmux('list-sessions', '-F', '#{session_name}')
  return sessionList.trim().split('\n').filter(Boolean)
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
  // Check only the last 5 lines — Claude's status bar is always near the bottom.
  // Prevents false positives on response text like "Reading through the code..."
  const tail = screen.split('\n').slice(-5).join('\n')
  return /^\s*(?:⏺\s*)?(?:Working|Thinking|Reading|Searching|Running|Editing|Writing)\b/m.test(tail)
}

type AgentState = 'ready' | 'busy' | 'waiting'

/** Detect agent state from screen content */
export function detectState(screen: string): AgentState {
  // "ctrl+c to interrupt" is the strongest busy signal — always wins
  if (screen.includes('ctrl+c to interrupt')) return 'busy'
  // Prompt indicators mean ready, even if status words appear in response text
  if (isClaudeReady(screen)) return 'ready'
  if (isClaudeProcessing(screen)) return 'busy'
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
  if (!userInput.trim()) return captured
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

