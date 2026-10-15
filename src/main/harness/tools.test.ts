import { expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { AIToolDefinition } from '../../shared/tools'
import { createChatTools, type ChatToolContext } from './tools'

function fixture() {
  const calls: string[] = [], offers: unknown[] = []
  const definition: AIToolDefinition = { name: 'set_contact_output_preference', displayName: '偏好', description: '偏好', risk: 'write', requiresConfirmation: true, alwaysConfirm: true, source: 'builtin', inputSchema: { type: 'object', properties: {} } }
  let enabled = true
  const context: ChatToolContext = {
    request: { requestId: 'r', characterId: 'c', sessionId: 's', messages: [], systemPrompt: '' }, owner: 'c',
    signal: new AbortController().signal, cancel() {}, state: { ownMemoryMutation: false, memoryMutationReceipt: '' }, definitions: [definition],
    getDefinition: name => name === definition.name ? definition : undefined,
    getConfig: () => ({ ...DEFAULT_APP_CONFIG, aiToolsEnabled: enabled, toolPermissionMode: 'full' }), isToolEnabled: () => enabled,
    assertContext: async () => {}, contactPolicy: async () => 'inherit',
    prepare: async () => ({ execute: () => { calls.push('write'); return { content: 'saved', summary: 'saved' } } }),
    offerAction: async (_key, request) => { offers.push(request); return { id: 'card' } as never }, approve: async () => 'approved', emit() {}
  }
  return { context, calls, offers, disable: () => { enabled = false } }
}

it('returns the original persistent card without executing an always-confirm action', async () => {
  const f = fixture(), tools = createChatTools(f.context)
  const result = JSON.parse(await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{"scope":"contact"}' }))
  expect(result).toMatchObject({ pendingInteraction: true, interactionId: 'card' })
  expect(f.calls).toEqual([])
  expect(f.offers).toHaveLength(1)
  expect(await tools.execute({ id: 'next', name: 'set_contact_output_preference', arguments: '{}' })).toContain('每次对话请求只能确认一个')
  expect(f.offers).toHaveLength(1)
})

it('rechecks permissions and context before preparing or executing', async () => {
  const f = fixture(), tools = createChatTools(f.context)
  f.disable()
  expect(await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toContain('禁用')
  expect(f.offers).toHaveLength(0)
  expect(f.calls).toHaveLength(0)
  const changed = fixture()
  changed.context.assertContext = async () => { throw new Error('stale context') }
  expect(await createChatTools(changed.context).execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toContain('stale context')
  expect(changed.calls).toHaveLength(0)
})

it('rejects a repeated configuration tool and a non-contact preference scope', async () => {
  const f = fixture(), tools = createChatTools(f.context)
  const call = { id: 'call', name: 'set_contact_output_preference', arguments: '{"scope":"contact"}' }
  await tools.execute(call, { index: 1, total: 2 })
  expect(await tools.execute(call, { index: 2, total: 2 })).toContain('组合设置步骤不在')
  expect(f.offers).toHaveLength(1)
  const other = fixture()
  expect(await createChatTools(other.context).execute({ ...call, arguments: '{"scope":"task"}' }, { index: 1, total: 2 })).toContain('组合设置步骤不在')
  expect(other.offers).toHaveLength(0)
})
