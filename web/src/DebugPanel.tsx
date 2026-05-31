import { useState, useRef, useEffect } from 'react'
import type { LogEntry } from './use-event-log'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const levelColor = {
  info: 'text-[var(--muted)]',
  warn: 'text-amber-500',
  error: 'text-red-500',
} as const

export function DebugPanel({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const errorCount = entries.filter((e) => e.level === 'error').length
  const warnCount = entries.filter((e) => e.level === 'warn').length

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, open])

  return (
    <div className="border-t border-[var(--border)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-1.5 bg-[var(--surface)] hover:bg-[var(--bg)] transition-colors"
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Debug Log ({entries.length})
        </span>
        <span className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-[10px] font-medium text-red-500">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
          )}
          {warnCount > 0 && (
            <span className="text-[10px] font-medium text-amber-500">{warnCount} warn{warnCount > 1 ? 's' : ''}</span>
          )}
          <span className="text-[10px] text-[var(--muted)]">{open ? '▼' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div
          ref={scrollRef}
          className="overflow-auto bg-[var(--bg)] px-4 py-2 text-xs font-mono leading-relaxed max-h-48"
        >
          {entries.length === 0 && (
            <p className="text-[var(--muted)]">No events yet...</p>
          )}
          {entries.map((entry, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="text-[var(--muted)] shrink-0">{formatTime(entry.time)}</span>
              <span className={`${levelColor[entry.level]} shrink-0 w-10`}>{entry.level}</span>
              <span className="text-[var(--ink)]">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
