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
const BG_RESET = `${ESC}49m`
const CLEAR = `${ESC}2J${ESC}H`
const HIDE_CURSOR = `${ESC}?25l`
const SHOW_CURSOR = `${ESC}?25h`

function c(color: string, text: string): string {
  return `${color}${text}${RESET}`
}

export interface TuiSession {
  name: string
  state: 'ready' | 'busy' | 'waiting'
  lastActivity: number
  bytesSent: number
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

type TuiAction = 'quit' | 'logs' | 'restart'

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

  setConnected(connected: boolean): void {
    this.state.connected = connected
    this.render()
  }

  setPeers(peers: string[]): void {
    this.state.peers = peers
    this.render()
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

  private addEvent(direction: '→' | '←', source: string, action: string, detail: string): void {
    this.state.events.push({ time: Date.now(), direction, source, action, detail })
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS)
    }
  }

  start(): Promise<TuiAction> {
    process.stdout.write(HIDE_CURSOR)
    this.render()
    this.renderTimer = setInterval(() => this.render(), 1000)

    return new Promise((resolve) => {
      this.actionResolve = resolve

      if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin)
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on('keypress', this.onKeypress)
      }
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

  private onKeypress = (_str: string, key: readline.Key): void => {
    if (key.ctrl && key.name === 'c') {
      this.actionResolve?.('quit')
      return
    }
    const ch = (key.name || '').toLowerCase()
    if (ch === 'q') this.actionResolve?.('quit')
  }

  private render(): void {
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
      `  ${c(DIM, 'Room')}    ${c(WHITE + BOLD, roomId)}    ${statusDot} ${statusText}    ${c(DIM, 'Up')} ${c(WHITE, uptime)}`
    )

    const peerText = peers.length > 0 ? peers.join(', ') : c(DIM, 'none')
    const sentText = totalBytesSent > 0 ? formatBytes(totalBytesSent) : c(DIM, '0')
    lines.push(
      `  ${c(DIM, 'Peers')}   ${peerText}    ${c(DIM, 'Sent')} ${sentText}`
    )
    lines.push('')

    // Sessions
    const sessionList = [...sessions.values()].sort((a, b) => b.lastActivity - a.lastActivity)
    const hr = c(DIM, '─'.repeat(Math.min(w - 4, 56)))
    lines.push(`  ${c(CYAN + BOLD, 'Sessions')} ${c(DIM, `(${sessionList.length})`)}  ${hr.slice(20)}`)

    if (sessionList.length === 0) {
      lines.push(`  ${c(DIM, 'No tmux sessions detected')}`)
    } else {
      for (const s of sessionList.slice(0, 10)) {
        const dot = s.state === 'busy' ? c(BLUE, '●')
          : s.state === 'ready' ? c(GREEN, '●')
          : c(YELLOW, '○')
        const stateText = s.state === 'busy' ? c(BLUE, 'busy')
          : s.state === 'ready' ? c(GREEN, 'ready')
          : c(YELLOW, 'waiting')
        const age = formatAge(Date.now() - s.lastActivity)
        const name = s.name.length > 20 ? s.name.slice(0, 19) + '…' : s.name.padEnd(20)
        lines.push(`  ${dot} ${c(WHITE, name)} ${stateText.padEnd(18)} ${c(DIM, age)}`)
      }
      if (sessionList.length > 10) {
        lines.push(`  ${c(DIM, `  +${sessionList.length - 10} more`)}`)
      }
    }
    lines.push('')

    // Activity feed
    lines.push(`  ${c(CYAN + BOLD, 'Activity')}  ${hr.slice(20)}`)

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
    lines.push(`  ${c(DIM, 'q')} ${c(GRAY, 'quit')}    ${c(DIM, 'Ctrl+C')} ${c(GRAY, 'stop')}`)
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
