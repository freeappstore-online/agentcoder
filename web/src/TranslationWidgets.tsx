import { Spinner, KeyPrompt, Card } from '@freeappstore/sdk/ui'
import { VoiceTextArea } from '@freeappstore/sdk/ui'
import type { FreeAppStore } from '@freeappstore/sdk'
import type { useVoiceInput } from '@freeappstore/sdk/hooks'
import type { useTranslator } from './use-translator'
import { CopyLine } from './ConnectBridge'
import { storageGet } from './safe-storage'
import type { AgentState } from './types'

export function AgentTabs({ agents, selectedAgent, agentStates, onSelectAgent }: {
  agents: string[]
  selectedAgent: string | null
  agentStates: Record<string, AgentState>
  onSelectAgent: (agent: string) => void
}) {
  if (agents.length <= 1) return null
  return (
    <div className="flex gap-1 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 overflow-x-auto">
      {agents.map((agent) => {
        const state = agentStates[agent]
        const isActive = agent === selectedAgent
        const dot = state === 'busy' ? 'bg-blue-500'
          : state === 'ready' ? 'bg-emerald-500'
          : 'bg-[var(--muted)] opacity-40'
        return (
          <button
            key={agent}
            onClick={() => onSelectAgent(agent)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-[var(--surface)] text-[var(--ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {agent}
          </button>
        )
      })}
    </div>
  )
}

export function TaskCompletionBanner({ selectedAgent, needsKey, lastTranslation, translating, outputBuffer, onManageKey, onSummarize }: {
  selectedAgent: string | null
  needsKey: boolean
  lastTranslation: ReturnType<typeof useTranslator>['lastTranslation']
  translating: boolean
  outputBuffer: string
  onManageKey: () => void
  onSummarize: () => void
}) {
  return (
    <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Task completed
          </h3>
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
            {selectedAgent} finished working
            {lastTranslation ? '' : needsKey ? ' — add API key for summaries' : ''}
          </p>
        </div>
        {needsKey && outputBuffer.length > 0 && (
          <button
            onClick={onManageKey}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Add key for summary
          </button>
        )}
        {!needsKey && !lastTranslation && !translating && outputBuffer.length > 0 && (
          <button
            onClick={onSummarize}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Summarize
          </button>
        )}
      </div>
    </div>
  )
}

export function TranslationResults({ lastTranslation, outputBuffer }: {
  lastTranslation: NonNullable<ReturnType<typeof useTranslator>['lastTranslation']>
  outputBuffer: string
}) {
  return (
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
  )
}

export function StatusContent({ app, bridgeOnline, bridgeWasOnline, outputBuffer, needsKey, keyDismissed, setKeyDismissed, taskCompleted, selectedAgent, lastTranslation, translating, error, onCatchUp, onManageKey }: {
  app: FreeAppStore
  bridgeOnline: boolean
  bridgeWasOnline: boolean
  outputBuffer: string
  needsKey: boolean
  keyDismissed: boolean
  setKeyDismissed: (v: boolean) => void
  taskCompleted: boolean
  selectedAgent: string | null
  lastTranslation: ReturnType<typeof useTranslator>['lastTranslation']
  translating: boolean
  error: string | null
  onCatchUp: () => void
  onManageKey: () => void
}) {
  return (
    <>
      {!bridgeOnline && !bridgeWasOnline && (
        <Card>
          <div className="text-center py-4 space-y-3">
            <p className="text-sm font-medium text-[var(--ink)]">Bridge not connected</p>
            <p className="text-xs text-[var(--muted)]">Run this on your machine to connect:</p>
            <div className="text-sm font-mono bg-[var(--bg)] rounded-lg p-3 text-left">
              <CopyLine text={`npx github:freeappstore-online/agentcoder start --session ${storageGet('ac:session') ?? ''}`} />
            </div>
          </div>
        </Card>
      )}

      {!bridgeOnline && bridgeWasOnline && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Bridge disconnected</h3>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The bridge stopped sending heartbeats. It may have crashed, lost network, or the token expired.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Check the bridge terminal for errors, or restart it:
            </p>
            <div className="text-sm font-mono bg-[var(--bg)] rounded-lg p-3 text-left">
              <CopyLine text={`npx github:freeappstore-online/agentcoder start --session ${storageGet('ac:session') ?? ''}`} />
            </div>
          </div>
        </div>
      )}

      {bridgeOnline && outputBuffer.length === 0 && (!needsKey || keyDismissed) && (
        <Card>
          <p className="text-sm text-[var(--muted)] text-center py-4">
            Bridge connected. Waiting for agent output...
          </p>
        </Card>
      )}

      {needsKey && bridgeOnline && !keyDismissed && (
        <div className="relative">
          <button
            onClick={() => setKeyDismissed(true)}
            className="absolute top-2 right-2 text-[var(--muted)] hover:text-[var(--ink)] text-xs"
          >
            Dismiss
          </button>
          <KeyPrompt
            app={app}
            provider="anthropic"
            providerName="Anthropic"
            message="Add your Anthropic API key to enable AI summaries. Everything else works without it."
          />
        </div>
      )}

      {taskCompleted && (
        <TaskCompletionBanner
          selectedAgent={selectedAgent}
          needsKey={needsKey}
          lastTranslation={lastTranslation}
          translating={translating}
          outputBuffer={outputBuffer}
          onManageKey={onManageKey}
          onSummarize={onCatchUp}
        />
      )}

      {outputBuffer.length > 0 && !lastTranslation && !translating && !needsKey && !taskCompleted && (
        <div className="flex justify-center">
          <button
            onClick={onCatchUp}
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
        <TranslationResults lastTranslation={lastTranslation} outputBuffer={outputBuffer} />
      )}

      {bridgeOnline && outputBuffer.length > 0 && !lastTranslation && (
        <div className="text-xs text-[var(--muted)] text-center">
          Receiving output... {(outputBuffer.length / 1024).toFixed(1)}KB buffered
        </div>
      )}
    </>
  )
}

export function InputBar({ input, setInput, voice, bridgeOnline, selectedAgent, onSend, onCompose, onInterrupt }: {
  input: string
  setInput: (v: string) => void
  voice: ReturnType<typeof useVoiceInput>
  bridgeOnline: boolean
  selectedAgent: string | null
  onSend: () => void
  onCompose: () => void
  onInterrupt: () => void
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) {
        onCompose()
      } else {
        onSend()
      }
    }
  }

  return (
    <div className="border-t border-[var(--border)] p-3">
      <div className="flex gap-2">
        <div className="flex-1" onKeyDown={handleKeyDown}>
          <VoiceTextArea
            value={input}
            onChange={setInput}
            voice={voice}
            placeholder={bridgeOnline ? "Type a message for your agent..." : "Connect bridge first..."}
            disabled={!bridgeOnline}
          />
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={onSend}
            disabled={!input.trim() || !bridgeOnline || !selectedAgent}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-30"
            title="Send (Enter)"
          >
            Send
          </button>
          <button
            onClick={onInterrupt}
            disabled={!bridgeOnline || !selectedAgent}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30 disabled:opacity-30"
          >
            Ctrl+C
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        Enter to send. Cmd+Enter to AI-rewrite first. Shift+Enter for newline.
      </p>
    </div>
  )
}
