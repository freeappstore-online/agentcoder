import { useState, useEffect, useCallback, useRef } from 'react'
import type { Room, RoomMessage } from '@freeappstore/sdk'
import type { BridgeMessage, UIMessage, AgentState } from './types'

const MAX_BUFFER_SIZE = 500_000 // 500KB, matches bridge buffer

interface BridgeState {
  connected: boolean
  bridgeOnline: boolean
  agents: string[]
  agentStates: Record<string, AgentState>
  outputBuffer: string
}

export function useBridge(room: Room | null) {
  const [state, setState] = useState<BridgeState>({
    connected: false,
    bridgeOnline: false,
    agents: [],
    agentStates: {},
    outputBuffer: '',
  })

  // Chunk reassembly
  const chunks = useRef<Map<string, { parts: string[]; total: number }>>(new Map())
  const lastHeartbeat = useRef(0)

  useEffect(() => {
    if (!room) return

    const unsubState = room.onConnectionState((s) => {
      setState((prev) => ({ ...prev, connected: s === 'open' }))
    })

    const unsubMsg = room.onMessage<BridgeMessage>((msg: RoomMessage<BridgeMessage>) => {
      const data = msg.data
      if (!data || !data.type) return

      switch (data.type) {
        case 'heartbeat':
          lastHeartbeat.current = Date.now()
          setState((prev) => ({
            ...prev,
            bridgeOnline: true,
            agents: data.agents,
          }))
          break

        case 'status':
          setState((prev) => ({
            ...prev,
            agentStates: { ...prev.agentStates, [data.agent]: data.state },
          }))
          break

        case 'output': {
          if (data.total && data.total > 1) {
            // Multi-chunk message — reassemble
            const chunkKey = `${data.agent}:${data.session}`
            let entry = chunks.current.get(chunkKey)
            if (!entry || data.seq === 0) {
              entry = { parts: [], total: data.total }
              chunks.current.set(chunkKey, entry)
            }
            entry.parts[data.seq] = data.content

            // Check if all chunks received
            const received = entry.parts.filter(Boolean).length
            if (received === entry.total) {
              const full = entry.parts.join('')
              chunks.current.delete(chunkKey)
              setState((prev) => {
                let buf = prev.outputBuffer + full
                if (buf.length > MAX_BUFFER_SIZE) buf = buf.slice(-MAX_BUFFER_SIZE)
                return { ...prev, outputBuffer: buf }
              })
            }
          } else {
            // Single chunk
            setState((prev) => {
              let buf = prev.outputBuffer + data.content
              if (buf.length > MAX_BUFFER_SIZE) buf = buf.slice(-MAX_BUFFER_SIZE)
              return { ...prev, outputBuffer: buf }
            })
          }
          break
        }
      }
    })

    // Detect bridge going offline (no heartbeat for 60s)
    const heartbeatCheck = setInterval(() => {
      if (lastHeartbeat.current > 0 && Date.now() - lastHeartbeat.current > 60_000) {
        setState((prev) => prev.bridgeOnline ? { ...prev, bridgeOnline: false } : prev)
      }
    }, 15_000)

    return () => {
      unsubState()
      unsubMsg()
      clearInterval(heartbeatCheck)
    }
  }, [room])

  const send = useCallback(
    (msg: UIMessage) => {
      if (room) room.send(msg)
    },
    [room],
  )

  const clearBuffer = useCallback(() => {
    setState((prev) => ({ ...prev, outputBuffer: '' }))
  }, [])

  return { ...state, send, clearBuffer }
}
