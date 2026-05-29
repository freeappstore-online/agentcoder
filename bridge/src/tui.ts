import readline from 'readline'

// ANSI helpers (no chalk dependency)
const ESC = '\x1b['
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const CYAN = `${ESC}36m`
const GREEN = `${ESC}32m`
const YELLOW = `${ESC}33m`
const RED = `${ESC}31m`
const BLUE = `${ESC}34m`
const WHITE = `${ESC}37m`
const GRAY = `${ESC}90m`
const INVERSE = `${ESC}7m`
const CLEAR = `${ESC}2J${ESC}H`
const HIDE_CURSOR = `${ESC}?25l`
const SHOW_CURSOR = `${ESC}?25h`

function c(color: string, text: string): string {
  return `${color}${text}${RESET}`
}

export interface TuiSession {
  name: string
  target?: string // explicit tmux target override (e.g. "aipa:1.0")
  state: 'ready' | 'busy' | 'waiting'
  lastActivity: number
  bytesSent: number
  watched: boolean
}

export interface TuiEvent {
  time: number
  direction: '→' | '←'
  source: string
  action: string
  detail: string
}

interface TuiState {
  connected: boolean
  roomId: string
  peers: string[]
  sessions: Map<string, TuiSession>
  events: TuiEvent[]
  startTime: number
  totalBytesSent: number
}

type TuiAction = 'quit'

const BANNER = [
  '  ╔═╗╔═╗╔═╗╔╗╔╔╦╗  ╔═╗╔═╗╔╦╗╔═╗╦═╗',
  '  ╠═╣║ ╦║╣ ║║║ ║   ║  ║ ║ ║║║╣ ╠╦╝',
  '  ╩ ╩╚═╝╚═╝╝╚╝ ╩   ╚═╝╚═╝═╩╝╚═╝╩╚═',
]

const MAX_EVENTS = 12

export class Tui {
  private state: TuiState
  private renderTimer: ReturnType<typeof setInterval> | null = null
  private actionResolve: ((action: TuiAction) => void) | null = null
  private picking = false
  private expanded: string | null = null  // session name expanded to show windows
  private pickerCursor = 0
  private pickerItems: Array<{ label: string; key: string; indent: boolean; isClaude: boolean }> = []
  private onWatchChanged: ((watched: Map<string, string | undefined>) => void) | null = null
  private getWindows: ((session: string) => Array<{ target: string; windowName: string; paneTitle: string; isClaude: boolean }>) | null = null

  constructor(roomId: string) {
    this.state = {
      connected: false,
      roomId,
      peers: [],
      sessions: new Map(),
      events: [],
      startTime: Date.now(),
      totalBytesSent: 0,
    }
  }

  /** Set initial watch list (from --watch flag) */
  setInitialWatch(names: string[]): void {
    for (const name of names) {
      const existing = this.state.sessions.get(name)
      if (existing) {
        existing.watched = true
      } else {
        this.state.sessions.set(name, {
          name,
          state: 'waiting',
          lastActivity: Date.now(),
          bytesSent: 0,
          watched: true,
        })
      }
    }
  }

  setConnected(connected: boolean): void {
    this.state.connected = connected
    this.render()
  }

  setPeers(peers: string[]): void {
    this.state.peers = peers
    this.render()
  }

  private started = false

  /** Register all discovered sessions (from tmux.listSessions) */
  discoverSessions(names: string[]): void {
    let added = false
    for (const name of names) {
      if (!this.state.sessions.has(name)) {
        this.state.sessions.set(name, {
          name,
          state: 'waiting',
          lastActivity: Date.now(),
          bytesSent: 0,
          watched: false,
        })
        added = true
      }
    }
    // Auto-open picker on first discovery if nothing is watched (only after start)
    if (added && this.started && !this.hasAnyWatched() && !this.picking) {
      this.openPicker()
    }
  }

  updateSession(name: string, state: 'ready' | 'busy' | 'waiting'): void {
    const existing = this.state.sessions.get(name)
    if (existing) {
      existing.state = state
      existing.lastActivity = Date.now()
    } else {
      this.state.sessions.set(name, {
        name,
        state,
        lastActivity: Date.now(),
        bytesSent: 0,
        watched: false,
      })
    }
  }

  recordOutput(agent: string, bytes: number): void {
    this.state.totalBytesSent += bytes
    const session = this.state.sessions.get(agent)
    if (session) {
      session.bytesSent += bytes
      session.lastActivity = Date.now()
    }
    this.addEvent('→', agent, 'output', formatBytes(bytes))
  }

  recordCommand(from: string, agent: string, text: string): void {
    this.addEvent('←', from, 'command', `"${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`)
  }

  recordControl(from: string, action: string): void {
    this.addEvent('←', from, action, '')
  }

  /** Returns map of session name → explicit target (or undefined for auto-detect) */
  getWatchedMap(): Map<string, string | undefined> {
    const map = new Map<string, string | undefined>()
    for (const s of this.state.sessions.values()) {
      if (s.watched) map.set(s.name, s.target)
    }
    return map
  }

  getWatched(): string[] {
    return [...this.state.sessions.values()].filter((s) => s.watched).map((s) => s.name)
  }

  hasAnyWatched(): boolean {
    return [...this.state.sessions.values()].some((s) => s.watched)
  }

  private addEvent(direction: '→' | '←', source: string, action: string, detail: string): void {
    this.state.events.push({ time: Date.now(), direction, source, action, detail })
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS)
    }
  }

  start(
    onWatchChanged: (watched: Map<string, string | undefined>) => void,
    getWindows?: (session: string) => Array<{ target: string; windowName: string; paneTitle: string; isClaude: boolean }>,
  ): Promise<TuiAction> {
    this.onWatchChanged = onWatchChanged
    this.getWindows = getWindows ?? null
    process.stdout.write(HIDE_CURSOR)

    // Set up raw mode BEFORE opening picker
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin)
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on('keypress', this.onKeypress)
    }

    this.started = true

    // Open picker if nothing is watched and sessions exist
    if (!this.hasAnyWatched() && this.state.sessions.size > 0) {
      this.openPicker()
    }

    this.render()
    this.renderTimer = setInterval(() => this.render(), 1000)

    return new Promise((resolve) => {
      this.actionResolve = resolve
    })
  }

  stop(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer)
      this.renderTimer = null
    }
    if (process.stdin.isTTY) {
      process.stdin.off('keypress', this.onKeypress)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdout.write(SHOW_CURSOR)
    process.stdout.write(CLEAR)
  }

  private openPicker(): void {
    this.picking = true
    this.pickerCursor = 0
    this.expanded = null
    this.rebuildPickerItems()
    this.render()
  }

  private rebuildPickerItems(): void {
    this.pickerItems = []
    const sessions = [...this.state.sessions.keys()].sort()
    for (const name of sessions) {
      this.pickerItems.push({ label: name, key: name, indent: false, isClaude: false })
      if (this.expanded === name && this.getWindows) {
        const windows = this.getWindows(name)
        for (const w of windows) {
          const label = `${w.windowName}${w.paneTitle && w.paneTitle !== w.windowName ? ` (${w.paneTitle})` : ''}`
          this.pickerItems.push({ label, key: `${name}=${w.target}`, indent: true, isClaude: w.isClaude })
        }
      }
    }
    // Clamp cursor
    if (this.pickerCursor >= this.pickerItems.length) {
      this.pickerCursor = Math.max(0, this.pickerItems.length - 1)
    }
  }

  private closePicker(): void {
    this.picking = false
    this.expanded = null
    this.onWatchChanged?.(this.getWatchedMap())
    this.render()
  }

  private onKeypress = (_str: string, key: readline.Key): void => {
    if (key.ctrl && key.name === 'c') {
      this.actionResolve?.('quit')
      return
    }

    if (this.picking) {
      this.handlePickerKey(key)
      return
    }

    const ch = (key.name || '').toLowerCase()
    if (ch === 'q') this.actionResolve?.('quit')
    if (ch === 'w') this.openPicker()
  }

  private handlePickerKey(key: readline.Key): void {
    const ch = (key.name || '').toLowerCase()
    const total = this.pickerItems.length
    if (total === 0) return

    if (ch === 'up' || ch === 'k') {
      this.pickerCursor = (this.pickerCursor - 1 + total) % total
    } else if (ch === 'down' || ch === 'j') {
      this.pickerCursor = (this.pickerCursor + 1) % total
    } else if (ch === 'right') {
      // Expand session to show windows
      const item = this.pickerItems[this.pickerCursor]
      if (item && !item.indent) {
        this.expanded = this.expanded === item.key ? null : item.key
        this.rebuildPickerItems()
      }
    } else if (ch === 'left') {
      // Collapse
      if (this.expanded) {
        this.expanded = null
        this.rebuildPickerItems()
      }
    } else if (ch === 'space') {
      const item = this.pickerItems[this.pickerCursor]
      if (!item) return
      if (item.indent) {
        // Window item — set explicit target on the session
        const [sessionName, target] = item.key.split('=')
        const session = this.state.sessions.get(sessionName!)
        if (session) {
          session.watched = true
          session.target = target
        }
      } else {
        // Session item — toggle watch (auto-detect pane)
        const session = this.state.sessions.get(item.key)
        if (session) {
          session.watched = !session.watched
          if (!session.watched) session.target = undefined
        }
      }
    } else if (ch === 'return') {
      this.closePicker()
      return
    } else if (ch === 'a') {
      const allWatched = [...this.state.sessions.values()].every((s) => s.watched)
      for (const s of this.state.sessions.values()) {
        s.watched = !allWatched
        if (!s.watched) s.target = undefined
      }
    } else if (ch === 'escape') {
      this.closePicker()
      return
    }
    this.render()
  }

  private render(): void {
    if (this.picking) {
      this.renderPicker()
    } else {
      this.renderDashboard()
    }
  }

  private renderPicker(): void {
    const lines: string[] = []

    lines.push('')
    for (const line of BANNER) {
      lines.push(c(CYAN, line))
    }
    lines.push('')
    lines.push(`  ${c(WHITE + BOLD, 'Select sessions to monitor')}`)
    lines.push('')

    for (let i = 0; i < this.pickerItems.length; i++) {
      const item = this.pickerItems[i]!
      const isCursor = i === this.pickerCursor

      if (item.indent) {
        // Window sub-item
        const prefix = '    '
        const marker = item.isClaude ? c(GREEN, '✳') : c(DIM, '·')
        const label = isCursor
          ? c(INVERSE + WHITE, ` ${item.label} `)
          : c(GRAY, ` ${item.label}`)
        lines.push(`${prefix}${marker} ${label}`)
      } else {
        // Session item
        const session = this.state.sessions.get(item.key)!
        const check = session.watched ? c(GREEN, '◉') : c(DIM, '○')
        const arrow = this.expanded === item.key ? c(DIM, '▼') : c(DIM, '▸')
        const label = isCursor
          ? c(INVERSE + WHITE, ` ${item.label} `)
          : c(WHITE, ` ${item.label}`)
        const targetHint = session.target ? c(DIM, ` → ${session.target}`) : ''
        lines.push(`  ${check} ${arrow}${label}${targetHint}`)
      }
    }

    lines.push('')
    lines.push(
      `  ${c(DIM, '↑↓')} ${c(GRAY, 'navigate')}    ` +
      `${c(DIM, '→')} ${c(GRAY, 'expand')}    ` +
      `${c(DIM, 'space')} ${c(GRAY, 'toggle')}    ` +
      `${c(DIM, 'a')} ${c(GRAY, 'all')}    ` +
      `${c(DIM, 'enter')} ${c(GRAY, 'confirm')}`,
    )
    lines.push('')

    process.stdout.write(CLEAR + lines.join('\n'))
  }

  private renderDashboard(): void {
    const { connected, roomId, peers, sessions, events, startTime, totalBytesSent } = this.state
    const lines: string[] = []
    const w = process.stdout.columns || 60

    // Banner
    lines.push('')
    for (const line of BANNER) {
      lines.push(c(CYAN, line))
    }
    lines.push('')

    // Status line
    const statusDot = connected ? c(GREEN, '●') : c(RED, '●')
    const statusText = connected ? c(GREEN, 'Connected') : c(RED, 'Disconnected')
    const uptime = formatUptime(Date.now() - startTime)
    lines.push(
      `  ${c(DIM, 'Room')}    ${c(WHITE + BOLD, roomId)}    ${statusDot} ${statusText}    ${c(DIM, 'Up')} ${c(WHITE, uptime)}`,
    )

    const peerText = peers.length > 0 ? peers.join(', ') : c(DIM, 'none')
    const sentText = totalBytesSent > 0 ? formatBytes(totalBytesSent) : c(DIM, '0')
    lines.push(
      `  ${c(DIM, 'Peers')}   ${peerText}    ${c(DIM, 'Sent')} ${sentText}`,
    )
    lines.push('')

    // Sessions — show watched first, then unwatched dimmed
    const watched = [...sessions.values()].filter((s) => s.watched).sort((a, b) => a.name.localeCompare(b.name))
    const unwatched = [...sessions.values()].filter((s) => !s.watched)
    const hr = c(DIM, '─'.repeat(Math.min(w - 30, 40)))

    lines.push(`  ${c(CYAN + BOLD, 'Watching')} ${c(DIM, `(${watched.length}/${sessions.size})`)}  ${hr}`)

    if (watched.length === 0) {
      lines.push(`  ${c(DIM, 'No sessions selected — press')} ${c(WHITE, 'w')} ${c(DIM, 'to pick')}`)
    } else {
      for (const s of watched) {
        const dot = s.state === 'busy' ? c(BLUE, '●')
          : s.state === 'ready' ? c(GREEN, '●')
          : c(YELLOW, '○')
        const stateText = s.state === 'busy' ? c(BLUE, 'busy')
          : s.state === 'ready' ? c(GREEN, 'ready')
          : c(YELLOW, 'waiting')
        const age = formatAge(Date.now() - s.lastActivity)
        const name = s.name.length > 20 ? s.name.slice(0, 19) + '…' : s.name.padEnd(20)
        const sent = s.bytesSent > 0 ? c(DIM, formatBytes(s.bytesSent)) : ''
        lines.push(`  ${dot} ${c(WHITE, name)} ${stateText.padEnd(18)} ${c(DIM, age)}  ${sent}`)
      }
    }
    if (unwatched.length > 0) {
      lines.push(`  ${c(DIM, `  +${unwatched.length} not monitored`)}`)
    }
    lines.push('')

    // Activity feed
    lines.push(`  ${c(CYAN + BOLD, 'Activity')}  ${hr}`)

    if (events.length === 0) {
      lines.push(`  ${c(DIM, 'Waiting for activity...')}`)
    } else {
      for (const e of events.slice(-8)) {
        const time = new Date(e.time).toLocaleTimeString('en-US', { hour12: false })
        const dir = e.direction === '→' ? c(GREEN, '→') : c(YELLOW, '←')
        const src = e.source.length > 16 ? e.source.slice(0, 15) + '…' : e.source.padEnd(16)
        const act = e.action.padEnd(10)
        lines.push(`  ${c(DIM, time)}  ${dir} ${c(WHITE, src)} ${c(DIM, act)} ${e.detail}`)
      }
    }
    lines.push('')

    // Footer
    lines.push(`  ${c(DIM, 'w')} ${c(GRAY, 'watch')}    ${c(DIM, 'q')} ${c(GRAY, 'quit')}    ${c(DIM, 'Ctrl+C')} ${c(GRAY, 'stop')}`)
    lines.push('')

    process.stdout.write(CLEAR + lines.join('\n'))
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatAge(ms: number): string {
  if (ms < 1000) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
