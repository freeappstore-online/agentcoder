import { useRef, useEffect, useState } from 'react'

/**
 * Syntax-highlight Claude Code terminal output.
 * Ported from ~/dev/ac/platform/web/src/components/Message.tsx
 */
export function highlightLine(line: string): React.ReactNode {
  // Tool calls: ⏺ Read(...), ⏺ Bash(...)
  if (/^⏺\s*(Read|Update|Write|Bash|Search|Glob|Grep|Edit)\(/.test(line)) {
    const match = line.match(/^(⏺\s*)(Read|Update|Write|Bash|Search|Glob|Grep|Edit)(\()(.*)(\).*)$/)
    if (match) {
      return (
        <>
          <span className="text-[var(--muted)]">{match[1]}</span>
          <span className="text-amber-400 font-semibold">{match[2]}</span>
          <span className="text-[var(--muted)]">{match[3]}</span>
          <span className="text-cyan-400">{match[4]}</span>
          <span className="text-[var(--muted)]">{match[5]}</span>
        </>
      )
    }
  }
  // Tool results: ⎿
  if (line.startsWith('  ⎿')) {
    return <span className="text-[var(--muted)] opacity-60">{line}</span>
  }
  // Thinking blocks
  if (/^∴\s*Thinking/.test(line)) {
    return <span className="text-purple-400 italic">{line}</span>
  }
  // Diff: added (lines starting with + but not tmux window list like "+ 1: shell")
  if (/^\+[^+\d]/.test(line.trim())) {
    return <span className="text-emerald-400">{line}</span>
  }
  // Diff: removed (lines starting with - but not tmux separators)
  if (/^-[^-]/.test(line.trim())) {
    return <span className="text-red-400">{line}</span>
  }
  // Status lines ❯ ✻ ⏵
  if (/^[❯✻⏵]/.test(line)) {
    return <span className="text-blue-400">{line}</span>
  }
  // Done/success
  if (/^⏺?\s*Done\.?/.test(line) || line.includes('successfully')) {
    return <span className="text-emerald-400">{line}</span>
  }
  return line
}

interface TerminalViewProps {
  output: string
}

export function TerminalView({ output }: TerminalViewProps) {
  const ref = useRef<HTMLPreElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [output, autoScroll])

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (!ref.current) return
    const { scrollTop, scrollHeight, clientHeight } = ref.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }

  if (!output) return null

  // Show last 200 lines, render as single pass (no per-line React elements)
  const lines = output.split('\n')
  const visible = lines.slice(-200)
  const startIdx = lines.length - visible.length

  return (
    <div className="border-t border-[var(--border)]">
      <div className="flex items-center justify-between px-4 py-1.5 bg-[var(--surface)]">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Terminal
        </span>
        <span className="text-[10px] text-[var(--muted)]">
          {(output.length / 1024).toFixed(1)}KB{!autoScroll && ' — scroll to bottom to resume'}
        </span>
      </div>
      <pre
        ref={ref}
        onScroll={handleScroll}
        className="overflow-auto bg-[var(--bg)] px-4 py-2 text-sm font-mono leading-relaxed text-[var(--ink)] max-h-64"
      >
        {visible.map((line, i) => (
          <span key={startIdx + i}>
            {highlightLine(line)}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  )
}
