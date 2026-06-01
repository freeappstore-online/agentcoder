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
import { storageGet, storageRemove } from './safe-storage'
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
      storageRemove('ac:session')
    }
  }, [room])

  // Auto-reconnect to last session
  useEffect(() => {
    if (!user || isCliAuth) return
    const lastSession = storageGet('ac:session')
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
          <div className="flex flex-col gap-2">
            <SignInButton app={fas} />
            <button
              onClick={() => fas.auth.signIn('google')}
              className="rounded-xl border border-[var(--border)] bg-white px-6 py-2.5 text-sm font-bold text-[#444] hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </button>
          </div>
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
        <SessionView sessionId={storageGet('ac:session') ?? ''} room={room} onDisconnect={disconnect} onSettings={() => setPage('profile')} />
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
