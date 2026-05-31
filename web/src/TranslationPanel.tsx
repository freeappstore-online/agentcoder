import { useState, useEffect, useRef, useCallback } from 'react'
import { useVoiceInput } from '@freeappstore/sdk/hooks'
import type { FreeAppStore } from '@freeappstore/sdk'
import { useTranslator } from './use-translator'
import { TerminalView } from './TerminalView'
import { DebugPanel } from './DebugPanel'
import { AgentTabs, StatusContent, InputBar } from './TranslationWidgets'
import type { AgentState, UIMessage } from './types'
import type { EventLog } from './use-event-log'

interface TranslationPanelProps {
  app: FreeAppStore
  log: EventLog
  bridgeOnline: boolean
  bridgeWasOnline: boolean
  selectedAgent: string | null
  agents: string[]
  agentStates: Record<string, AgentState>
  outputBuffer: string
  onSelectAgent: (agent: string) => void
  send: (msg: UIMessage) => void
}

export function TranslationPanel({ app, log, bridgeOnline, bridgeWasOnline, selectedAgent, agents, agentStates, outputBuffer, onSelectAgent, send }: TranslationPanelProps) {
  const { translating, lastTranslation, error, translate, compose, reset: resetTranslation } = useTranslator(app, log)
  const voice = useVoiceInput()
  const [input, setInput] = useState('')
  const [needsKey, setNeedsKey] = useState(true)
  const [keyDismissed, setKeyDismissed] = useState(false)
  const [prefs, setPrefs] = useState({ autoTranslate: true, translateDebounce: 3 })
  const [taskCompleted, setTaskCompleted] = useState(false)
  const lastTranslatedLen = useRef(0)
  const prevAgentState = useRef<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Load prefs from KV
  useEffect(() => {
    app.kv.get<typeof prefs>('prefs').then((p) => { if (p) setPrefs(p) }).catch(console.error)
  }, [])

  // Check if user has an API key
  useEffect(() => {
    const check = () => app.keys.has('anthropic').then((has) => {
      setNeedsKey(!has)
      log.info(has ? 'API key: configured' : 'API key: not set')
    }).catch(() => setNeedsKey(true))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  // Reset translation state when switching agents
  const prevAgent = useRef(selectedAgent)
  useEffect(() => {
    if (prevAgent.current !== selectedAgent) {
      prevAgent.current = selectedAgent
      resetTranslation()
      lastTranslatedLen.current = 0
      setTaskCompleted(false)
    }
  }, [selectedAgent, resetTranslation])

  // Detect task completion: busy -> ready transition
  const agentState = selectedAgent ? agentStates[selectedAgent] : undefined
  useEffect(() => {
    const prev = prevAgentState.current
    prevAgentState.current = agentState ?? null

    if (prev === 'busy' && agentState === 'ready') {
      setTaskCompleted(true)
      log.info(`Task completed: ${selectedAgent} finished`)
    } else if (agentState === 'busy') {
      setTaskCompleted(false)
    }
  }, [agentState])

  // Auto-translate on task completion
  useEffect(() => {
    if (taskCompleted && !needsKey && prefs.autoTranslate && outputBuffer.trim()) {
      translate(outputBuffer)
      lastTranslatedLen.current = outputBuffer.length
    }
  }, [taskCompleted]) // eslint-disable-line -- intentionally fires once on completion

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
  }, [outputBuffer, translate, needsKey, prefs])

  const handleCatchUp = () => {
    translate(outputBuffer)
    lastTranslatedLen.current = outputBuffer.length
  }

  const handleSend = useCallback(() => {
    if (!input.trim() || !selectedAgent) return
    send({ type: 'command', agent: selectedAgent, session: '', text: input })
    setInput('')
  }, [input, selectedAgent, send])

  const handleCompose = async () => {
    if (!input.trim() || !selectedAgent) return
    const context = lastTranslation?.summary ?? 'No context available'
    const composed = await compose(input, context)
    if (composed.trim()) {
      send({ type: 'command', agent: selectedAgent, session: '', text: composed })
      setInput('')
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <AgentTabs agents={agents} selectedAgent={selectedAgent} agentStates={agentStates} onSelectAgent={onSelectAgent} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={outputRef}>
        <StatusContent
          app={app}
          bridgeOnline={bridgeOnline}
          bridgeWasOnline={bridgeWasOnline}
          outputBuffer={outputBuffer}
          needsKey={needsKey}
          keyDismissed={keyDismissed}
          setKeyDismissed={setKeyDismissed}
          taskCompleted={taskCompleted}
          selectedAgent={selectedAgent}
          lastTranslation={lastTranslation}
          translating={translating}
          error={error}
          onCatchUp={handleCatchUp}
          onManageKey={() => app.keys.manage('anthropic')}
        />
      </div>

      <TerminalView output={outputBuffer} />
      <DebugPanel entries={log.entries} />

      <InputBar
        input={input}
        setInput={setInput}
        voice={voice}
        bridgeOnline={bridgeOnline}
        selectedAgent={selectedAgent}
        onSend={handleSend}
        onCompose={handleCompose}
        onInterrupt={() => { if (selectedAgent) send({ type: 'control', action: 'interrupt', agent: selectedAgent }) }}
      />
    </div>
  )
}
