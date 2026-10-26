import { afterEach, expect, it, vi } from 'vitest'
import type { ChatRuntime } from '../chat/runtime'

const transport = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: transport }))
import { registerChatHandlers } from './chat'

afterEach(() => vi.clearAllMocks())

it.each([true, false])('sends the terminal event after tool/text events, before returning the result (ok=%s)', async ok => {
  const events: string[] = []
  const sender = { isDestroyed: () => false, send: (channel: string, event: { done?: boolean }) => events.push(event.done ? 'end' : channel) }
  const result = { ok, error: ok ? undefined : 'failed' }
  const dispose = registerChatHandlers({ service: { run: async () => {
    sender.send('tool', {}); sender.send('text', {})
    return result
  } }, approvals: {} } as unknown as ChatRuntime)
  try {
    const handler = transport.handle.mock.calls.find(([channel]) => channel === 'ai:stream')![1]
    const returned = await handler({ sender }, { requestId: 'r', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }] })
    events.push('result')
    expect(events).toEqual(['tool', 'text', 'end', 'result'])
    expect(returned).toEqual({ ...result, waitForStreamEnd: true })
  } finally { dispose() }
})
