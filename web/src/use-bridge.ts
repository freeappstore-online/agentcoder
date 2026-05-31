import { useState, useEffect, useCallback, useRef } from 'react'
import type { Room, RoomMessage } from '@freeappstore/sdk'
import type { BridgeMessage, UIMessage, AgentState } from './types'
import type { EventLog } from './use-event-log'

const MAX_BUFFER_SIZE = 500_000

interface BridgeState {
  connected: boolean
  bridgeOnline: boolean
  bridgeWasOnline: boolean
  agents: string[]
  agentStates: Record<string, AgentState>
  agentBuffers: Record<string, string>
}

export function useBridge(room: Room | null, log?: EventLog) {
  const logRef = useRef(log)
  logRef.current = log

  const [state, setState] = useState<BridgeState>({
    connected: false,
    bridgeOnline: false,
    bridgeWasOnline: false,
    agents: [],
    agentStates: {},
    agentBuffers: {},
  })

  const chunks = useRef<Map<string, { parts: string[]; total: number }>>(new Map())
  const lastHeartbeat = useRef(0)

  useEffect(() => {
    if (!room) return

    const unsubState = room.onConnectionState((connectionState) => {
      const isOpen = connectionState === 'open'
      logRef.current?.[isOpen ? 'info' : 'warn'](`Room ${isOpen ? 'connected' : connectionState}`)
      setState((prev) => ({ ...prev, connected: isOpen }))
    })

    const unsubMsg = room.onMessage<BridgeMessage>((msg: RoomMessage<BridgeMessage>) => {
      const messagePayload = msg.data
      if (!messagePayload || !messagePayload.type) return

      switch (messagePayload.type) {
        case 'heartbeat':
          lastHeartbeat.current = Date.now()
          logRef.current?.info(`Heartbeat from bridge (${messagePayload.agents.length} agent${messagePayload.agents.length !== 1 ? 's' : ''}: ${messagePayload.agents.join(', ') || 'none'})`)
          setState((prev) => ({
            ...prev,
            bridgeOnline: true,
            bridgeWasOnline: true,
            agents: messagePayload.agents,
          }))
          break

        case 'status':
          logRef.current?.info(`Agent ${messagePayload.agent}: ${messagePayload.state}`)
          setState((prev) => ({
            ...prev,
            agentStates: { ...prev.agentStates, [messagePayload.agent]: messagePayload.state },
          }))
          break

        case 'output': {
          const applyScreen = (screen: string, agent: string) => {
            setState((prev) => {
              let buf = screen
              if (buf.length > MAX_BUFFER_SIZE) buf = buf.slice(-MAX_BUFFER_SIZE)
              return {
                ...prev,
                agentBuffers: { ...prev.agentBuffers, [agent]: buf },
              }
            })
          }

          if (messagePayload.total && messagePayload.total > 1) {
            const chunkKey = `${messagePayload.agent}:${messagePayload.session}`
            let entry = chunks.current.get(chunkKey)
            if (!entry || messagePayload.seq === 0) {
              entry = { parts: [], total: messagePayload.total }
              chunks.current.set(chunkKey, entry)
            }
            entry.parts[messagePayload.seq] = messagePayload.content

            const received = entry.parts.filter(Boolean).length
            if (received === entry.total) {
              const full = entry.parts.join('')
              chunks.current.delete(chunkKey)
              logRef.current?.info(`Output received: ${messagePayload.agent} (${(full.length / 1024).toFixed(1)}KB, ${entry.total} chunks)`)
              applyScreen(full, messagePayload.agent)
            }
          } else {
            logRef.current?.info(`Output received: ${messagePayload.agent} (${(messagePayload.content.length / 1024).toFixed(1)}KB)`)
            applyScreen(messagePayload.content, messagePayload.agent)
          }
          break
        }
      }
    })

    const heartbeatCheck = setInterval(() => {
      if (lastHeartbeat.current > 0 && Date.now() - lastHeartbeat.current > 60_000) {
        setState((prev) => {
          if (prev.bridgeOnline) {
            logRef.current?.warn('Bridge heartbeat timeout (>60s) — marking offline')
            return { ...prev, bridgeOnline: false }
          }
          return prev
        })
      }
    }, 15_000)

    return () => {
      unsubState()
      unsubMsg()
      clearInterval(heartbeatCheck)
      chunks.current.clear()
      lastHeartbeat.current = 0
      setState({ connected: false, bridgeOnline: false, bridgeWasOnline: false, agents: [], agentStates: {}, agentBuffers: {} })
    }
  }, [room])

  const send = useCallback(
    (msg: UIMessage) => {
      if (room) {
        logRef.current?.info(`Sent ${msg.type}${msg.type === 'command' ? `: "${msg.text.slice(0, 50)}"` : `: ${msg.action}`}`)
        room.send(msg)
      }
    },
    [room],
  )

  return { ...state, send }
}
