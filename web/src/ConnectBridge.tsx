import { useState } from 'react'
import type { FreeAppStore, Room } from '@freeappstore/sdk'
import { Card } from '@freeappstore/sdk/ui'

export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-start justify-between gap-2 group">
      <p className="text-[var(--muted)] break-all">{text}</p>
      <button
        onClick={copy}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:bg-[var(--surface)] transition-all"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

interface ConnectBridgeProps {
  app: FreeAppStore
  onRoom: (room: Room) => void
}

export function ConnectBridge({ app, onRoom }: ConnectBridgeProps) {
  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem('ac:session') || crypto.randomUUID().slice(0, 8)
  })

  const connect = () => {
    localStorage.setItem('ac:session', sessionId)
    const room = app.rooms.join(sessionId)
    onRoom(room)
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="display-font text-2xl font-bold text-[var(--ink)]">AgentCoder</h1>
          <p className="mt-2 text-[var(--muted)]">
            AI agent interpreter — understand what your coding agent did
          </p>
        </div>

        <Card>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">Session ID</label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] text-sm font-mono"
                placeholder="my-session"
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                Use this ID when starting your bridge
              </p>
            </div>

            <button
              onClick={connect}
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Connect
            </button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--ink)]">Setup your bridge</h3>
            <div className="space-y-2 text-sm font-mono bg-[var(--bg)] rounded-lg p-3">
              <CopyLine text="npx github:freeappstore-online/agentcoder login" />
              <CopyLine text={`npx github:freeappstore-online/agentcoder start --session ${sessionId}`} />
            </div>
            <p className="text-xs text-[var(--muted)]">
              The bridge runs on your machine and relays tmux sessions through this app.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
