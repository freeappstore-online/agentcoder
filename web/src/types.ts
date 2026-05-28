export type AgentState = 'ready' | 'busy' | 'waiting'

// Bridge -> UI messages
export interface TerminalOutput {
  type: 'output'
  agent: string
  session: string
  content: string
  seq: number
  total?: number
}

export interface AgentStatusMsg {
  type: 'status'
  agent: string
  state: AgentState
}

export interface BridgeHeartbeat {
  type: 'heartbeat'
  agents: string[]
  uptime: number
}

export type BridgeMessage = TerminalOutput | AgentStatusMsg | BridgeHeartbeat

// UI -> Bridge messages
export interface CommandMessage {
  type: 'command'
  agent: string
  session: string
  text: string
}

export interface ControlMessage {
  type: 'control'
  action: 'start' | 'stop' | 'interrupt' | 'resync'
  agent: string
}

export type UIMessage = CommandMessage | ControlMessage

// Translation layer
export interface TranslationResult {
  summary: string
  filesChanged: string[]
  pendingDecision: string | null
  agentStatus: string
}
