import { useState, useCallback, useRef } from 'react'
import type { FreeAppStore } from '@freeappstore/sdk'
import type { TranslationResult } from './types'
import { parseTranslation } from './parse-translation'
import type { EventLog } from './use-event-log'

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

export function callAnthropicApi(app: FreeAppStore, body: object, signal?: AbortSignal) {
  return app.proxy.fetch(
    'api.anthropic.com/v1/messages',
    {
      method: 'POST',
      credentials: 'omit' as RequestCredentials,
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    },
  )
}

function describeError(err: unknown): string {
  const message = (err as Error).message ?? String(err)

  // Network-level failure (CORS, DNS, offline, proxy unreachable)
  if (message === 'Failed to fetch' || message.includes('NetworkError')) {
    return 'Network error — cannot reach the AI proxy. Check your connection, or the proxy may be down.'
  }

  // Anthropic API errors
  if (message.includes('401')) {
    return 'API key rejected (401). Go to Settings and re-add your Anthropic key.'
  }
  if (message.includes('429')) {
    return 'Rate limited (429). Wait a moment and try again.'
  }
  if (message.includes('529') || message.includes('overloaded')) {
    return 'Anthropic API is overloaded (529). Try again in a few seconds.'
  }

  return message
}

export function useTranslator(app: FreeAppStore | null, log?: EventLog) {
  const logRef = useRef(log)
  logRef.current = log

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

      const inputKB = (terminalOutput.length / 1024).toFixed(1)
      logRef.current?.info(`Translation started (${inputKB}KB input)`)

      try {
        // Truncate to ~100KB for token limits
        const truncated =
          terminalOutput.length > 100_000
            ? terminalOutput.slice(-100_000)
            : terminalOutput

        const response = await callAnthropicApi(app, {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: TRANSLATE_PROMPT + truncated,
            },
          ],
        }, controller.signal)

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          const detail = errorText.slice(0, 200)
          throw new Error(`Translation failed (HTTP ${response.status}): ${detail}`)
        }

        const apiBody = await response.json() as {
          content: Array<{ type: string; text: string }>
        }
        const text = apiBody.content?.[0]?.text ?? ''

        const parsed = parseTranslation(text)
        logRef.current?.info(`Translation complete: ${parsed.agentStatus}, ${parsed.filesChanged.length} files changed`)
        setState({ translating: false, lastTranslation: parsed, error: null })
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          logRef.current?.info('Translation cancelled (new request)')
          return
        }
        const friendly = describeError(err)
        logRef.current?.error(`Translation failed: ${friendly}`)
        setState((prev) => ({
          ...prev,
          translating: false,
          error: friendly,
        }))
      }
    },
    [app],
  )

  const compose = useCallback(
    async (userIntent: string, context: string): Promise<string> => {
      if (!app) return userIntent

      logRef.current?.info(`Composing response for: "${userIntent.slice(0, 50)}"`)

      try {
        const response = await callAnthropicApi(app, {
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
        })

        if (!response.ok) {
          logRef.current?.error(`Compose failed (HTTP ${response.status})`)
          return userIntent
        }
        const apiBody = await response.json() as {
          content: Array<{ type: string; text: string }>
        }
        const composed = apiBody.content?.[0]?.text?.trim() ?? userIntent
        logRef.current?.info(`Compose complete: "${composed.slice(0, 50)}"`)
        return composed
      } catch (err) {
        const raw = (err as Error).message ?? String(err)
        logRef.current?.error(`Compose failed: ${describeError(err)}`)
        if (raw !== describeError(err)) logRef.current?.error(`Raw error: ${raw}`)
        return userIntent
      }
    },
    [app],
  )

  return { ...state, translate, compose }
}
