import { describe, it, expect, vi } from 'vitest'
import { callAnthropicApi } from './use-translator'

describe('callAnthropicApi', () => {
  it('calls proxy.fetch with correct URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({ content: [] }) })
    const mockApp = { proxy: { fetch: mockFetch } } as any

    await callAnthropicApi(mockApp, { model: 'claude-haiku-4-5-20251001', messages: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      'api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
  })

  it('serializes body as JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    const mockApp = { proxy: { fetch: mockFetch } } as any

    const requestBody = { model: 'test', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
    await callAnthropicApi(mockApp, requestBody)

    const callArgs = mockFetch.mock.calls[0]
    const passedBody = JSON.parse(callArgs[1].body)
    expect(passedBody.model).toBe('test')
    expect(passedBody.max_tokens).toBe(100)
    expect(passedBody.messages).toHaveLength(1)
  })

  it('passes abort signal when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    const mockApp = { proxy: { fetch: mockFetch } } as any
    const controller = new AbortController()

    await callAnthropicApi(mockApp, {}, controller.signal)

    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBe(controller.signal)
  })

  it('does not include signal when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    const mockApp = { proxy: { fetch: mockFetch } } as any

    await callAnthropicApi(mockApp, {})

    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeUndefined()
  })
})
