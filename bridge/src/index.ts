import { RoomClient } from './room-client.js'
import * as tmux from './tmux.js'

const CHUNK_SIZE = 3500 // 3.5KB to leave room for JSON envelope
const HEARTBEAT_INTERVAL = 30_000
const POLL_INTERVAL = 2_000

interface BridgeConfig {
  token: string
  sessionId: string
  apiBase?: string
}

type UIMessage =
  | { type: 'command'; agent: string; session: string; text: string }
  | { type: 'control'; action: 'start' | 'stop' | 'interrupt' | 'resync'; agent: string }

/**
 * AgentCoder Bridge — connects local tmux sessions to a FAS Room.
 *
 * The bridge:
 * 1. Discovers tmux sessions on the machine
 * 2. Connects to a FAS Room as a peer
 * 3. Polls tmux for output changes and sends them to the Room
 * 4. Receives commands from the UI and sends them to tmux
 */
export class Bridge {
  private room: RoomClient
  private outputBuffer = '' // Rolling buffer for catch-up
  private maxBufferSize = 500_000 // 500KB
  private lastScreens = new Map<string, string>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private startTime = Date.now()

  constructor(private config: BridgeConfig) {
    this.room = new RoomClient(
      'agentcoder',
      config.sessionId,
      config.token,
      config.apiBase,
    )
  }

  start(): void {
    console.log(`[bridge] Starting bridge for session: ${this.config.sessionId}`)

    // Listen for UI commands
    this.room.onMessage<UIMessage>((msg) => {
      this.handleMessage(msg.data)
    })

    // Start polling tmux sessions
    this.pollTimer = setInterval(() => this.pollSessions(), POLL_INTERVAL)

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL)

    // Initial heartbeat
    setTimeout(() => this.sendHeartbeat(), 1000)

    // Replay buffer on new peer connections
    this.room.onPeers((peers) => {
      console.log(`[bridge] Peers: ${peers.map((p) => p.login).join(', ')}`)
    })

    console.log('[bridge] Bridge started. Monitoring tmux sessions...')
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.room.close()
    console.log('[bridge] Bridge stopped.')
  }

  private handleMessage(msg: UIMessage): void {
    if (!msg || !msg.type) return

    switch (msg.type) {
      case 'command': {
        console.log(`[bridge] Command for ${msg.agent}: ${msg.text.slice(0, 80)}...`)
        if (tmux.sessionExists(msg.agent)) {
          tmux.sendKeys(msg.agent, msg.text)
          tmux.sendSpecialKey(msg.agent, 'Enter')
        } else {
          console.warn(`[bridge] Session ${msg.agent} not found`)
        }
        break
      }

      case 'control': {
        const { agent, action } = msg
        switch (action) {
          case 'interrupt':
            if (tmux.sessionExists(agent)) {
              tmux.sendSpecialKey(agent, 'C-c')
              console.log(`[bridge] Sent Ctrl+C to ${agent}`)
            }
            break
          case 'resync': {
            // Re-send current screen
            const screen = tmux.captureScreen(agent)
            this.sendOutput(agent, screen)
            break
          }
          case 'stop':
            // Kill the tmux session
            if (tmux.sessionExists(agent)) {
              tmux.sendSpecialKey(agent, 'C-c')
              console.log(`[bridge] Stopping ${agent}`)
            }
            break
        }
        break
      }
    }
  }

  private pollSessions(): void {
    const sessions = tmux.listSessions()

    for (const session of sessions) {
      const screen = tmux.captureScreen(session)
      const lastScreen = this.lastScreens.get(session)

      if (screen !== lastScreen) {
        this.lastScreens.set(session, screen)

        // Send full screen snapshot (not a diff — tmux capture-pane returns
        // the visible pane, not a log, so naive slicing produces garbage).
        if (screen.trim()) {
          this.appendBuffer(screen)
          this.sendOutput(session, screen)
        }

        // Send status update
        const state = tmux.detectState(screen)
        this.room.send({
          type: 'status',
          agent: session,
          state,
        })
      }
    }
  }

  private sendOutput(agent: string, content: string): void {
    if (content.length <= CHUNK_SIZE) {
      this.room.send({
        type: 'output',
        agent,
        session: '',
        content,
        seq: 0,
      })
    } else {
      // Chunk into 3.5KB pieces
      const chunks: string[] = []
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        chunks.push(content.slice(i, i + CHUNK_SIZE))
      }
      for (let i = 0; i < chunks.length; i++) {
        this.room.send({
          type: 'output',
          agent,
          session: '',
          content: chunks[i],
          seq: i,
          total: chunks.length,
        })
      }
    }
  }

  private sendHeartbeat(): void {
    const sessions = tmux.listSessions()
    this.room.send({
      type: 'heartbeat',
      agents: sessions,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    })
  }

  private appendBuffer(content: string): void {
    this.outputBuffer += content
    // Circular: trim oldest when over limit
    if (this.outputBuffer.length > this.maxBufferSize) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize)
    }
  }
}
