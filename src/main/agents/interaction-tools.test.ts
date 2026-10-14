import { expect, it, vi } from 'vitest'
import { createInteractionTools } from './interaction-tools'
import type { ToolExecutionContext } from '../tools/registry'
import { validateToolArguments } from '../../shared/tools'

const request = { purpose: 'choice', title: '选择方案', body: '想先做哪一项？', subject: { kind: 'contact' }, actions: [{ id: 'one', label: '先调研', tool: 'assign_contact_task', arguments: { description: '调研现有方案' } }] }
it('offers a validated choice with authoritative previews without executing any option', async () => {
  const execute = vi.fn(), offer = vi.fn(async (_owner, _key, request) => ({ id: 'action:one', request })), prepare = vi.fn(async () => ({ preview: '实际操作：新建调研任务', execute }))
  const tool = createInteractionTools({ owner: () => 'alice', prepare, offer })[0]
  const args = validateToolArguments(tool.inputSchema, { request: JSON.stringify({ ...request, sessionId: 'forged' }) })
  const result = await tool.execute(args, { sessionId: 'real-session' } as ToolExecutionContext)
  expect(JSON.parse(result.content)).toMatchObject({ pendingInteraction: true, interactionId: 'action:one' })
  expect(offer.mock.calls[0][2]).toMatchObject({ sessionId: 'real-session', body: expect.stringContaining('实际操作：新建调研任务') })
  expect(execute).not.toHaveBeenCalled()
})
it('rejects unknown operations before publishing a card', async () => {
  const offer = vi.fn(), tool = createInteractionTools({ owner: () => 'alice', prepare: vi.fn(), offer })[0]
  await expect(tool.execute({ request: JSON.stringify({ ...request, actions: [{ ...request.actions[0], tool: 'run_shell' }] }) }, { sessionId: 'session' } as ToolExecutionContext)).rejects.toThrow('操作无效')
  expect(offer).not.toHaveBeenCalled()
})
it('refuses stale options and unowned sessions instead of offering a promise that cannot execute', async () => {
  const offer = vi.fn(), context = { sessionId: 'session' } as ToolExecutionContext
  const tool = createInteractionTools({ owner: () => 'alice', prepare: async () => { throw new Error('配置已变化') }, offer })[0]
  await expect(tool.execute({ request: JSON.stringify(request) }, context)).rejects.toThrow('变化')
  expect(offer).not.toHaveBeenCalled()
  const foreign = createInteractionTools({ owner: () => undefined, prepare: vi.fn(), offer })[0]
  await expect(foreign.execute({ request: JSON.stringify(request) }, context)).rejects.toThrow('会话')
})
