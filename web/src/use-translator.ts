import { useState, useCallback, useRef } from 'react'
import type { FreeAppStore } from '@freeappstore/sdk'
import type { TranslationResult } from './types'
import { parseTranslation } from './parse-translation'

const TRANSLATE_PROMPT = `You are an AI coding assistant interpreter. A developer is using an AI coding agent (like Claude Code) in their terminal. Below is the raw terminal output from a session.

Your job: summarize what happened in plain English so the developer can understand without reading the raw output.

Return a JSON object with these fields:
- "summary": 2-5 sentence summary of what the agent did
- "filesChanged": array of file paths that were created/modified/deleted
- "pendingDecision": if the agent is waiting for user input, describe what it's asking. null if not waiting.
- "agentStatus": one of "working", "waiting_for_input", "idle", "error"

Be specific about what changed. Name files, describe the nature of changes (refactor, bug fix, new feature, test). If there are errors, describe them clearly.

Raw terminal output:
`

interface TranslatorState {
  translating: boolean
  lastTranslation: TranslationResult | null
  error: string | null
}

export function useTranslator(app: FreeAppStore | null) {
  const [state, setState] = useState<TranslatorState>({
    translating: false,
    lastTranslation: null,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const translate = useCallback(
    async (terminalOutput: string) => {
      if (!app || !terminalOutput.trim()) return

      // Cancel any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState((prev) => ({ ...prev, translating: true, error: null }))

      try {
        // Truncate to ~100KB for token limits
        const truncated =
          terminalOutput.length > 100_000
            ? terminalOutput.slice(-100_000)
            : terminalOutput

        const res = await app.proxy.fetch(
          'api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1024,
              messages: [
                {
                  role: 'user',
                  content: TRANSLATE_PROMPT + truncated,
                },
              ],
            }),
            signal: controller.signal,
          },
        )

        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Translation failed: ${res.status} ${text}`)
        }

        const body = await res.json() as {
          content: Array<{ type: string; text: string }>
        }
        const text = body.content?.[0]?.text ?? ''

        const result = parseTranslation(text)
        setState({ translating: false, lastTranslation: result, error: null })
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setState((prev) => ({
          ...prev,
          translating: false,
          error: (e as Error).message,
        }))
      }
    },
    [app],
  )

  const compose = useCallback(
    async (userIntent: string, context: string): Promise<string> => {
      if (!app) return userIntent

      try {
        const res = await app.proxy.fetch(
          'api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              messages: [
                {
                  role: 'user',
                  content: [
                    'You are helping a developer respond to an AI coding agent running in their terminal.',
                    '',
                    'Agent context:',
                    context,
                    '',
                    'Developer intent:',
                    userIntent,
                    '',
                    'Convert the developer intent into the exact text to send to the terminal. Be concise and direct. Output ONLY the text to send, nothing else.',
                  ].join('\n'),
                },
              ],
            }),
          },
        )

        if (!res.ok) return userIntent
        const body = await res.json() as {
          content: Array<{ type: string; text: string }>
        }
        return body.content?.[0]?.text?.trim() ?? userIntent
      } catch {
        return userIntent
      }
    },
    [app],
  )

  return { ...state, translate, compose }
}
