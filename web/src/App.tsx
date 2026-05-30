import { useState, useEffect, useRef, useCallback } from 'react'
import { initApp } from '@freeappstore/sdk'
import { SignInButton, ProfileMenu, BuildInfo, Spinner, KeyPrompt, Card, Footer } from '@freeappstore/sdk/ui'
import { VoiceTextArea } from '@freeappstore/sdk/ui'
import { useAuth, useVoiceInput } from '@freeappstore/sdk/hooks'
import { useBridge } from './use-bridge'
import { useTranslator } from './use-translator'
import type { Room } from '@freeappstore/sdk'
import { TerminalView } from './terminal-view'
import { ProfilePage } from './profile-page'
import type { AgentState, UIMessage } from './types'

const fas = initApp({ appId: 'agentcoder' })

function CopyLine({ text }: { text: string }) {
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

function ConnectBridge({ onRoom }: { onRoom: (room: Room) => void }) {
  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem('ac:session') || crypto.randomUUID().slice(0, 8)
  })

  const connect = () => {
    localStorage.setItem('ac:session', sessionId)
    const room = fas.rooms.join(sessionId)
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

interface StatusBarProps {
  connected: boolean
  bridgeOnline: boolean
  agents: string[]
  agentStates: Record<string, AgentState>
  onDisconnect: () => void
  onSettings: () => void
}

function StatusBar({ connected, bridgeOnline, agents, agentStates, onDisconnect, onSettings }: StatusBarProps) {
  const activeAgent = agents[0]
  const agentState = activeAgent ? agentStates[activeAgent] : undefined

  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm sticky top-0 z-50">
      <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-emerald-500' : 'text-[var(--muted)]'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-[var(--muted)]'}`} />
        {connected ? 'Connected' : 'Offline'}
      </span>
      <span className={`inline-flex items-center gap-1.5 ${bridgeOnline ? 'text-emerald-500' : 'text-amber-500'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${bridgeOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {bridgeOnline ? 'Bridge' : 'No bridge'}
      </span>
      {activeAgent && (
        <span className="text-[var(--muted)]">
          <span className="text-[var(--ink)] font-medium">{activeAgent}</span>
          {agentState && (
            <span className={`ml-1 ${agentState === 'busy' ? 'text-blue-500' : agentState === 'waiting' ? 'text-amber-500' : 'text-emerald-500'}`}>
              ({agentState})
            </span>
          )}
        </span>
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

interface TranslationPanelProps {
  bridgeOnline: boolean
  agents: string[]
  outputBuffer: string
  send: (msg: UIMessage) => void
}

function TranslationPanel({ bridgeOnline, agents, outputBuffer, send }: TranslationPanelProps) {
  const { translating, lastTranslation, error, translate, compose } = useTranslator(fas)
  const voice = useVoiceInput()
  const [input, setInput] = useState('')
  const [composedPreview, setComposedPreview] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(true)
  const [prefs, setPrefs] = useState({ autoTranslate: true, translateDebounce: 3 })
  const lastTranslatedLen = useRef(0)
  const outputRef = useRef<HTMLDivElement>(null)

  // Load prefs from KV
  useEffect(() => {
    fas.kv.get<typeof prefs>('prefs').then((p) => { if (p) setPrefs(p) }).catch(() => {})
  }, [])

  // Check if user has an API key for translation (re-check on window focus for after key setup)
  useEffect(() => {
    const check = () => fas.keys.has('anthropic').then((has) => setNeedsKey(!has)).catch(() => setNeedsKey(true))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  // Auto-translate when new output accumulates (debounced)
  useEffect(() => {
    if (outputBuffer.length <= lastTranslatedLen.current) return
    if (needsKey || !prefs.autoTranslate) return
    const timer = setTimeout(() => {
      const newContent = outputBuffer.slice(lastTranslatedLen.current)
      if (newContent.trim().length > 50) {
        translate(outputBuffer)
        lastTranslatedLen.current = outputBuffer.length
      }
    }, prefs.translateDebounce * 1000)
    return () => clearTimeout(timer)
  }, [outputBuffer, translate, needsKey])

  const handleCatchUp = () => {
    translate(outputBuffer)
    lastTranslatedLen.current = outputBuffer.length
  }

  const handleCompose = async () => {
    if (!input.trim()) return
    const context = lastTranslation?.summary ?? 'No context available'
    const composed = await compose(input, context)
    setComposedPreview(composed)
  }

  const handleSend = useCallback(() => {
    const text = composedPreview ?? input
    if (!text.trim() || !agents[0]) return
    send({ type: 'command', agent: agents[0], session: '', text })
    setInput('')
    setComposedPreview(null)
  }, [composedPreview, input, agents, send])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (composedPreview) handleSend()
      else handleCompose()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Translation panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={outputRef}>
        {!bridgeOnline && (
          <Card>
            <div className="text-center py-4">
              <p className="text-sm font-medium text-[var(--ink)]">Bridge not connected</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Start the bridge on your machine to begin monitoring your AI agent sessions.
              </p>
            </div>
          </Card>
        )}

        {bridgeOnline && outputBuffer.length === 0 && !needsKey && (
          <Card>
            <p className="text-sm text-[var(--muted)] text-center py-4">
              Bridge connected. Waiting for agent output...
            </p>
          </Card>
        )}

        {needsKey && bridgeOnline && (
          <KeyPrompt
            app={fas}
            provider="anthropic"
            providerName="Anthropic"
            message="AgentCoder uses AI to translate terminal output into plain English. Add your Anthropic API key to enable the translation layer."
          />
        )}

        {outputBuffer.length > 0 && !lastTranslation && !translating && !needsKey && (
          <div className="flex justify-center">
            <button
              onClick={handleCatchUp}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Catch up — summarize what happened
            </button>
          </div>
        )}

        {translating && (
          <Card>
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner size={16} />
              <span className="text-sm text-[var(--muted)]">Analyzing agent output...</span>
            </div>
          </Card>
        )}

        {error && !needsKey && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {lastTranslation && (
          <div className="space-y-3">
            <Card>
              <div>
                <h3 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)] mb-2">Summary</h3>
                <p className="text-sm text-[var(--ink)] leading-relaxed">{lastTranslation.summary}</p>
              </div>
            </Card>

            {lastTranslation.filesChanged.length > 0 && (
              <Card>
                <div>
                  <h3 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)] mb-2">
                    Files changed ({lastTranslation.filesChanged.length})
                  </h3>
                  <div className="space-y-1">
                    {lastTranslation.filesChanged.map((f) => (
                      <div key={f} className="text-sm font-mono text-[var(--ink)]">{f}</div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {lastTranslation.pendingDecision && (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4">
                <h3 className="text-sm font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">
                  Waiting for your input
                </h3>
                <p className="text-sm text-amber-700 dark:text-amber-300">{lastTranslation.pendingDecision}</p>
              </div>
            )}

            <div className="text-xs text-[var(--muted)]">
              Agent status: {lastTranslation.agentStatus} | Buffer: {(outputBuffer.length / 1024).toFixed(1)}KB
            </div>
          </div>
        )}

        {bridgeOnline && outputBuffer.length > 0 && !lastTranslation && (
          <div className="text-xs text-[var(--muted)] text-center">
            Receiving output... {(outputBuffer.length / 1024).toFixed(1)}KB buffered
          </div>
        )}
      </div>

      {/* Raw terminal output */}
      <TerminalView output={outputBuffer} />

      {/* Compose bar */}
      <div className="border-t border-[var(--border)] p-3">
        {composedPreview && (
          <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-blue-800 dark:text-blue-200">Will send to terminal:</span>
              <button
                onClick={() => setComposedPreview(null)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Edit
              </button>
            </div>
            <pre className="text-xs font-mono text-blue-700 dark:text-blue-300 whitespace-pre-wrap">{composedPreview}</pre>
            <button
              onClick={handleSend}
              className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Send to agent
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1" onKeyDown={handleKeyDown}>
            <VoiceTextArea
              value={input}
              onChange={setInput}
              voice={voice}
              placeholder={bridgeOnline ? "Tell your agent what to do (type or speak)..." : "Connect bridge first..."}
              disabled={!bridgeOnline}
            />
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={handleCompose}
              disabled={!input.trim() || !bridgeOnline}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface)] disabled:opacity-30"
              title="Compose (Cmd+Enter)"
            >
              Compose
            </button>
            <button
              onClick={() => {
                if (agents[0]) send({ type: 'control', action: 'interrupt', agent: agents[0] })
              }}
              disabled={!bridgeOnline || !agents[0]}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30 disabled:opacity-30"
            >
              Ctrl+C
            </button>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          Type or speak what you want in plain English. Compose converts it to the right terminal command.
        </p>
      </div>
    </div>
  )
}

function SessionView({ room, onDisconnect, onSettings }: { room: Room; onDisconnect: () => void; onSettings: () => void }) {
  const bridge = useBridge(room)

  return (
    <>
      <StatusBar
        connected={bridge.connected}
        bridgeOnline={bridge.bridgeOnline}
        agents={bridge.agents}
        agentStates={bridge.agentStates}
        onDisconnect={onDisconnect}
        onSettings={onSettings}
      />
      <TranslationPanel
        bridgeOnline={bridge.bridgeOnline}
        agents={bridge.agents}
        outputBuffer={bridge.outputBuffer}
        send={bridge.send}
      />
    </>
  )
}

function CliAuthFlow() {
  const params = new URLSearchParams(window.location.search)
  const port = params.get('port') || '19283'

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
      const r = fas.rooms.join(lastSession)
      setRoom(r)
      return () => r.close()
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
        <SessionView room={room} onDisconnect={disconnect} onSettings={() => setPage('profile')} />
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
            <ConnectBridge onRoom={setRoom} />
          </main>
        </>
      )}
      <Footer />
      <BuildInfo />
    </div>
  )
}
