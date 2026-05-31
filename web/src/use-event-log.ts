import { useState, useCallback, useRef } from 'react'

export interface LogEntry {
  time: number
  level: 'info' | 'warn' | 'error'
  message: string
}

const MAX_LOG_ENTRIES = 100

export function useEventLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const entriesRef = useRef<LogEntry[]>([])

  const log = useCallback((level: LogEntry['level'], message: string) => {
    const entry: LogEntry = { time: Date.now(), level, message }
    entriesRef.current = [...entriesRef.current.slice(-(MAX_LOG_ENTRIES - 1)), entry]
    setEntries(entriesRef.current)
  }, [])

  const info = useCallback((message: string) => log('info', message), [log])
  const warn = useCallback((message: string) => log('warn', message), [log])
  const error = useCallback((message: string) => log('error', message), [log])

  return { entries, info, warn, error }
}

export type EventLog = ReturnType<typeof useEventLog>
