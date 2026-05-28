import type { TranslationResult } from './types'

/**
 * Parse a TranslationResult from an AI response string.
 * Handles: raw JSON, markdown code blocks, JSON with surrounding text.
 */
export function parseTranslation(text: string): TranslationResult {
  // Try direct parse first
  try {
    return JSON.parse(text) as TranslationResult
  } catch {
    // noop
  }

  // Try extracting from markdown code block
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = codeBlock?.[1] ?? text

  // Find the outermost balanced braces
  const start = jsonStr.indexOf('{')
  if (start === -1) throw new Error('No JSON in translation response')

  let depth = 0
  let end = start
  for (let i = start; i < jsonStr.length; i++) {
    if (jsonStr[i] === '{') depth++
    else if (jsonStr[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  return JSON.parse(jsonStr.slice(start, end + 1)) as TranslationResult
}
