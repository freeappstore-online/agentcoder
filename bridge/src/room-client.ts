import WebSocket from 'ws'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const API_BASE = 'wss://api.freeappstore.online'

export interface RoomPeer {
  uid: string
  login: string
}

export interface RoomMessage<T = unknown> {
  from: RoomPeer
  data: T
  at: number
}

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error'

/**
 * Node.js Room client — connects to FAS Rooms via ws package.
 * Implements the same protocol as the browser SDK Room class.
 */
export class RoomClient {
  private socket: WebSocket | null = null
  private listeners: Array<(msg: RoomMessage) => void> = []
  private stateListeners: Array<(state: ConnectionState) => void> = []
  private peerListeners: Array<(peers: RoomPeer[]) => void> = []
  private _peers: RoomPeer[] = []
  private connectionState: ConnectionState = 'connecting'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly appId: string,
    private readonly roomId: string,
    private readonly token: string,
    private readonly apiBase = API_BASE,
  ) {
    this.connect()
  }

  get state(): ConnectionState {
    return this.connectionState
  }

  get peers(): RoomPeer[] {
    return this._peers
  }

  send<T>(data: T): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ kind: 'msg', data }))
  }

  onMessage<T = unknown>(listener: (msg: RoomMessage<T>) => void): () => void {
    this.listeners.push(listener as (msg: RoomMessage) => void)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  onConnectionState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.push(listener)
    listener(this.connectionState)
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener)
    }
  }

  onPeers(listener: (peers: RoomPeer[]) => void): () => void {
    this.peerListeners.push(listener)
    return () => {
      this.peerListeners = this.peerListeners.filter((l) => l !== listener)
    }
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
    this.setState('closed')
  }

  private connect(): void {
    if (this.closed) return
    this.setState('connecting')

    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/rooms/${encodeURIComponent(this.roomId)}?token=${encodeURIComponent(this.token)}`
    const socket = new WebSocket(url)
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempt = 0
      this.setState('open')
      console.log(`[bridge] Connected to room ${this.roomId}`)
    })

    socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as
          | { kind: 'msg'; from: RoomPeer; data: unknown; at: number }
          | { kind: 'peers'; peers: RoomPeer[] }
          | { kind: 'error'; error: string }

        if (parsed.kind === 'msg') {
          for (const l of this.listeners) {
            l({ from: parsed.from, data: parsed.data, at: parsed.at })
          }
        } else if (parsed.kind === 'peers') {
          this._peers = parsed.peers
          for (const l of this.peerListeners) l(this._peers)
        } else if (parsed.kind === 'error') {
          console.warn(`[bridge] Room error: ${parsed.error}`)
        }
      } catch {
        // ignore malformed frames
      }
    })

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      if (this.closed) return
      this.setState('closed')
      this.scheduleReconnect()
    })

    socket.on('error', (err) => {
      console.error(`[bridge] WebSocket error:`, err.message)
      this.setState('error')
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt)
    const jitter = Math.random() * 1000
    this.reconnectAttempt++
    console.log(`[bridge] Reconnecting in ${Math.round(backoff / 1000)}s...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closed) this.connect()
    }, backoff + jitter)
  }

  private setState(state: ConnectionState): void {
    if (this.connectionState === state) return
    this.connectionState = state
    for (const l of this.stateListeners) l(state)
  }
}
