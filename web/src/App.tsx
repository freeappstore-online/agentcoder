import { useState, useEffect, useCallback } from 'react'
import { initApp } from '@freeappstore/sdk'
import { SignInButton, ProfileMenu, BuildInfo, Spinner, Card, Footer } from '@freeappstore/sdk/ui'
import { useAuth } from '@freeappstore/sdk/hooks'
import { useBridge } from './use-bridge'
import { useEventLog } from './use-event-log'
import { TranslationPanel } from './TranslationPanel'
import type { Room } from '@freeappstore/sdk'
import { ConnectBridge } from './ConnectBridge'
import { ProfilePage } from './ProfilePage'
import type { AgentState } from './types'

const fas = initApp({ appId: 'agentcoder' })

interface StatusBarProps {
  sessionId: string
  connected: boolean
  bridgeOnline: boolean
  agents: string[]
  agentStates: Record<string, AgentState>
  onDisconnect: () => void
  onSettings: () => void
}

function StatusBar({ sessionId, connected, bridgeOnline, agents, agentStates, onDisconnect, onSettings }: StatusBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm sticky top-0 z-50">
      <span className="font-mono text-xs text-[var(--muted)]">{sessionId}</span>
      <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-emerald-500' : 'text-[var(--muted)]'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-[var(--muted)]'}`} />
        {connected ? 'Connected' : 'Offline'}
      </span>
      <span className={`inline-flex items-center gap-1.5 ${bridgeOnline ? 'text-emerald-500' : 'text-amber-500'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${bridgeOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {bridgeOnline ? 'Bridge' : 'No bridge'}
      </span>
      {agents.length === 1 && agents[0] && (
        <span className="text-[var(--muted)]">
          <span className="text-[var(--ink)] font-medium">{agents[0]}</span>
          {agentStates[agents[0]] && (
            <span className={`ml-1 ${agentStates[agents[0]] === 'busy' ? 'text-blue-500' : agentStates[agents[0]] === 'waiting' ? 'text-amber-500' : 'text-emerald-500'}`}>
              ({agentStates[agents[0]]})
            </span>
          )}
        </span>
      )}
      {agents.length > 1 && (
        <span className="text-[var(--muted)]">{agents.length} agents</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onSettings}
          className="rounded px-2 py-0.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
        >
          Settings
        </button>
        <button
          onClick={onDisconnect}
          className="rounded px-2 py-0.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
        >
          Disconnect
        </button>
        <ProfileMenu app={fas} />
      </div>
    </div>
  )
}

function SessionView({ sessionId, room, onDisconnect, onSettings }: { sessionId: string; room: Room; onDisconnect: () => void; onSettings: () => void }) {
  const log = useEventLog()
  const bridge = useBridge(room, log)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  // Auto-select first agent, or keep selection if still valid
  useEffect(() => {
    if (bridge.agents.length === 0) return
    if (selectedAgent && bridge.agents.includes(selectedAgent)) return
    setSelectedAgent(bridge.agents[0])
  }, [bridge.agents, selectedAgent])

  const activeBuffer = selectedAgent ? (bridge.agentBuffers[selectedAgent] ?? '') : ''

  return (
    <>
      <StatusBar
        sessionId={sessionId}
        connected={bridge.connected}
        bridgeOnline={bridge.bridgeOnline}
        agents={bridge.agents}
        agentStates={bridge.agentStates}
        onDisconnect={onDisconnect}
        onSettings={onSettings}
      />
      <TranslationPanel
        app={fas}
        log={log}
        bridgeOnline={bridge.bridgeOnline}
        bridgeWasOnline={bridge.bridgeWasOnline}
        selectedAgent={selectedAgent}
        agents={bridge.agents}
        agentStates={bridge.agentStates}
        outputBuffer={activeBuffer}
        onSelectAgent={setSelectedAgent}
        send={bridge.send}
      />
    </>
  )
}

function CliAuthFlow() {
  const searchParams = new URLSearchParams(window.location.search)
  const port = searchParams.get('port') || '19283'

  useEffect(() => {
    const token = fas.auth.token
    if (!token) return

    // Redirect to localhost — top-level navigation works from HTTPS to localhost
    // (unlike fetch, which is blocked by Private Network Access)
    window.location.href = `http://127.0.0.1:${port}/callback?token=${encodeURIComponent(token)}`
  }, [port])

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <Card>
        <div className="text-center space-y-3 py-4">
          <Spinner size={20} />
          <p className="text-sm text-[var(--muted)]">Sending token to CLI...</p>
        </div>
      </Card>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth(fas)
  const [room, setRoom] = useState<Room | null>(null)
  const [page, setPage] = useState<'main' | 'profile'>('main')

  const isCliAuth = new URLSearchParams(window.location.search).has('cli_auth')

  const disconnect = useCallback(() => {
    if (room) {
      room.close()
      setRoom(null)
      localStorage.removeItem('ac:session')
    }
  }, [room])

  // Auto-reconnect to last session
  useEffect(() => {
    if (!user || isCliAuth) return
    const lastSession = localStorage.getItem('ac:session')
    if (lastSession) {
      const joinedRoom = fas.rooms.join(lastSession)
      setRoom(joinedRoom)
      return () => joinedRoom.close()
    }
  }, [user, isCliAuth])

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h1 className="display-font text-2xl font-bold text-[var(--ink)]">AgentCoder</h1>
          <p className="text-[var(--muted)]">
            {isCliAuth ? 'Sign in to authorize the CLI' : 'Sign in to control your AI coding agents'}
          </p>
          <SignInButton app={fas} />
        </div>
      </div>
    )
  }

  // CLI auth flow — user is signed in, send token to CLI
  if (isCliAuth) {
    return <CliAuthFlow />
  }

  if (page === 'profile') {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <ProfilePage app={fas} user={user} onBack={() => setPage('main')} />
        <Footer />
        <BuildInfo />
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {room ? (
        <SessionView sessionId={localStorage.getItem('ac:session') ?? ''} room={room} onDisconnect={disconnect} onSettings={() => setPage('profile')} />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 sticky top-0 z-50">
            <span className="text-sm font-semibold text-[var(--ink)]">AgentCoder</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage('profile')}
                className="rounded px-2 py-0.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
              >
                Settings
              </button>
              <ProfileMenu app={fas} />
            </div>
          </div>
          <main className="flex flex-1 flex-col">
            <ConnectBridge app={fas} onRoom={setRoom} />
          </main>
        </>
      )}
      <Footer />
      <BuildInfo />
    </div>
  )
}
