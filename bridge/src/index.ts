import { RoomClient } from './room-client.js'
import * as tmux from './tmux.js'

const CHUNK_SIZE = 3500 // 3.5KB to leave room for JSON envelope
const HEARTBEAT_INTERVAL = 30_000
const POLL_INTERVAL = 2_000

interface BridgeConfig {
  token: string
  sessionId: string
  apiBase?: string
  watchList?: string[]
}

type UIMessage =
  | { type: 'command'; agent: string; session: string; text: string }
  | { type: 'control'; action: 'start' | 'stop' | 'interrupt' | 'resync'; agent: string }

export interface BridgeEvents {
  onConnected?: () => void
  onDisconnected?: () => void
  onPeers?: (peers: string[]) => void
  onSessions?: (names: string[]) => void
  onSessionState?: (agent: string, state: 'ready' | 'busy' | 'waiting') => void
  onOutput?: (agent: string, bytes: number) => void
  onCommand?: (from: string, agent: string, text: string) => void
  onControl?: (from: string, action: string) => void
}

/**
 * AgentCoder Bridge — connects local tmux sessions to a FAS Room.
 */
export class Bridge {
  private room: RoomClient
  private outputBuffer = ''
  private maxBufferSize = 500_000
  private lastScreens = new Map<string, string>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private startTime = Date.now()
  private msgSeq = 0
  private watchSet: Set<string> | null = null // null = watch nothing until set

  constructor(
    private config: BridgeConfig,
    private events: BridgeEvents = {},
  ) {
    if (config.watchList) {
      this.watchSet = new Set(config.watchList)
    }
    this.room = new RoomClient(
      'agentcoder',
      config.sessionId,
      config.token,
      config.apiBase,
    )
  }

  start(): void {
    this.room.onConnectionState((s) => {
      if (s === 'open') this.events.onConnected?.()
      else if (s === 'closed' || s === 'error') this.events.onDisconnected?.()
    })

    this.room.onMessage<UIMessage>((msg) => {
      this.handleMessage(msg)
    })

    this.pollTimer = setInterval(() => this.pollSessions(), POLL_INTERVAL)
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL)
    setTimeout(() => this.sendHeartbeat(), 1000)

    this.room.onPeers((peers) => {
      this.events.onPeers?.(peers.map((p) => p.login))
      // New peer joined — send heartbeat + current screen so they see state immediately
      this.sendHeartbeat()
      this.replayCurrentScreens()
    })
  }

  setWatchList(names: string[]): void {
    this.watchSet = new Set(names)
  }

  private replayCurrentScreens(): void {
    if (!this.watchSet) return
    for (const session of this.watchSet) {
      const screen = this.lastScreens.get(session)
      if (screen?.trim()) {
        this.sendOutput(session, screen)
        const state = tmux.detectState(screen)
        this.events.onSessionState?.(session, state)
        this.room.send({ type: 'status', agent: session, state })
      }
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.room.close()
  }

  private handleMessage(msg: { from: { login: string }; data: UIMessage }): void {
    const data = msg.data
    if (!data || !data.type) return

    switch (data.type) {
      case 'command': {
        this.events.onCommand?.(msg.from.login, data.agent, data.text)
        if (tmux.sessionExists(data.agent)) {
          const target = tmux.getTarget(data.agent)
          tmux.sendKeys(target, data.text)
          tmux.sendSpecialKey(target, 'Enter')
        }
        break
      }

      case 'control': {
        const { agent, action } = data
        this.events.onControl?.(msg.from.login, action)
        if (!tmux.sessionExists(agent)) break
        const target = tmux.getTarget(agent)
        switch (action) {
          case 'interrupt':
            tmux.sendSpecialKey(target, 'C-c')
            break
          case 'resync': {
            const screen = tmux.captureScreen(target)
            this.sendOutput(agent, screen)
            break
          }
          case 'stop':
            tmux.sendSpecialKey(target, 'C-c')
            break
        }
        break
      }
    }
  }

  private pollSessions(): void {
    const allSessions = tmux.listSessions()
    this.events.onSessions?.(allSessions)

    // Only poll watched sessions
    const sessions = this.watchSet
      ? allSessions.filter((s) => this.watchSet!.has(s))
      : []

    for (const session of sessions) {
      const target = tmux.getTarget(session)
      const screen = tmux.captureScreen(target)
      const lastScreen = this.lastScreens.get(session)

      if (screen !== lastScreen) {
        this.lastScreens.set(session, screen)

        if (screen.trim()) {
          this.appendBuffer(screen)
          this.sendOutput(session, screen)
        }

        const state = tmux.detectState(screen)
        this.events.onSessionState?.(session, state)
        this.room.send({
          type: 'status',
          agent: session,
          state,
        })
      }
    }
  }

  private sendOutput(agent: string, content: string): void {
    this.events.onOutput?.(agent, content.length)
    const msgId = String(++this.msgSeq)
    if (content.length <= CHUNK_SIZE) {
      this.room.send({
        type: 'output',
        agent,
        session: msgId,
        content,
        seq: 0,
      })
    } else {
      const chunks: string[] = []
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        chunks.push(content.slice(i, i + CHUNK_SIZE))
      }
      for (let i = 0; i < chunks.length; i++) {
        this.room.send({
          type: 'output',
          agent,
          session: msgId,
          content: chunks[i]!,
          seq: i,
          total: chunks.length,
        })
      }
    }
  }

  private sendHeartbeat(): void {
    const allSessions = tmux.listSessions()
    const watched = this.watchSet
      ? allSessions.filter((s) => this.watchSet!.has(s))
      : []
    this.room.send({
      type: 'heartbeat',
      agents: watched,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    })
  }

  private appendBuffer(content: string): void {
    this.outputBuffer += content
    if (this.outputBuffer.length > this.maxBufferSize) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize)
    }
  }
}
