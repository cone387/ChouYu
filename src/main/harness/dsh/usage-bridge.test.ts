import { expect, it, vi } from 'vitest'
import { installBudget } from '../../../../runtime/dsh/budget.mjs'

it.each([false, true])('does not interrupt the provider stream when usage RPC fails (budgeted=%s)', async budgeted => {
  const hooks = new Map<string, Function>()
  const scope = { on: (name: string, fn: Function) => hooks.set(name, fn) }
  const request = vi.fn(async (method: string) => {
    if (method.startsWith('usage:')) throw new Error('telemetry unavailable')
    return { maxOutputTokens: 10 }
  })
  installBudget(scope, { request }, { requestId: 'r', attemptId: 'a' }, 'session', 10, budgeted)
  const chunks = [{ type: 'usage', usage: { totalTokens: 20 } }, { type: 'text-delta', text: 'answer' }]
  const next = vi.fn(async function* () { yield* chunks })
  const output = []
  for await (const chunk of hooks.get('llm/stream')!({ sessionId: 'session', maxTokens: 10 }, next)) output.push(chunk)
  expect(output).toEqual(chunks)
  expect(next).toHaveBeenCalledTimes(1)
  if (budgeted) expect(request.mock.calls.map(call => call[0])).toContain('round:after')
})
