import WebSocket from 'ws'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 15
const API_BASE = 'wss://api.freeappstore.online'

function roomPath(appId: string, roomId: string): string {
  return `/v1/apps/${encodeURIComponent(appId)}/rooms/${encodeURIComponent(roomId)}`
}

/** HTTPS endpoint that issues a room ticket. Accepts a ws(s) or http(s) API base. */
export function ticketUrl(apiBase: string, appId: string, roomId: string): string {
  const base = apiBase.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  return `${base}${roomPath(appId, roomId)}/ticket`
}

/** WebSocket URL for a room, authenticated by a ticket. Accepts a ws(s) or http(s) API base. */
export function roomUrl(apiBase: string, appId: string, roomId: string, ticket: string): string {
  const base = apiBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  return `${base}${roomPath(appId, roomId)}?ticket=${encodeURIComponent(ticket)}`
}

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
  private errorListeners: Array<(reason: string) => void> = []
  private _peers: RoomPeer[] = []
  private connectionState: ConnectionState = 'connecting'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private _authFailed = false

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

  get authFailed(): boolean {
    return this._authFailed
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

  onError(listener: (reason: string) => void): () => void {
    this.errorListeners.push(listener)
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener)
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
    void this.connectAsync()
  }

  private async connectAsync(): Promise<void> {
    if (this.closed) return
    this.setState('connecting')

    // Exchange the session token (Authorization header, kept off the URL) for
    // a short-lived room ticket; only the ticket goes in the WebSocket URL.
    let ticket: string
    try {
      const res = await fetch(ticketUrl(this.apiBase, this.appId, this.roomId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (this.closed) return
      if (!res.ok) {
        if (!this.handleRejection(res.status)) this.retry()
        return
      }
      ticket = ((await res.json()) as { ticket: string }).ticket
    } catch {
      this.retry()
      return
    }
    if (this.closed) return

    const socket = new WebSocket(roomUrl(this.apiBase, this.appId, this.roomId, ticket))
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempt = 0
      this.setState('open')
    })

    // ws fires 'unexpected-response' when the HTTP upgrade is rejected.
    // This fires INSTEAD of 'open', and is followed by 'close'.
    socket.on('unexpected-response', (_req, res) => {
      // Drain the response body to prevent memory leaks
      res.resume()
      // 5xx: not fatal — the close handler will trigger a reconnect.
      // If it keeps failing, the max reconnect limit will fire a fatal error.
      this.handleRejection(res.statusCode ?? 0)
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
          this.emitError(parsed.error)
        }
      } catch {
        // ignore malformed frames
      }
    })

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.retry()
    })

    socket.on('error', () => {
      // error is always followed by close — handle reconnect there
    })
  }

  /** Fatal HTTP statuses (from the ticket request or the WS upgrade) end the client. Returns true if fatal. */
  private handleRejection(status: number): boolean {
    if (status === 401 || status === 403) {
      this._authFailed = true
      this.emitError('Token expired or invalid. Run: agentcoder login')
    } else if (status === 404) {
      this.emitError('Room not found (404). Check the app ID and session ID.')
    } else if (status === 429) {
      this.emitError('Rate limited (429). Too many connections — wait a minute and try again.')
    } else {
      return false
    }
    this.closed = true
    this.setState('error')
    return true
  }

  private retry(): void {
    if (this.closed) return
    this.setState('closed')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.emitError(
        `Could not connect after ${MAX_RECONNECT_ATTEMPTS} attempts. ` +
        'Check your network connection and try again.',
      )
      this.closed = true
      this.setState('error')
      return
    }

    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt)
    const jitter = Math.random() * 1000
    this.reconnectAttempt++
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

  private emitError(reason: string): void {
    for (const l of this.errorListeners) l(reason)
  }
}
