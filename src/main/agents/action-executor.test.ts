import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { executeContactAction } from './action-executor'

it('executes a persisted choice once, revalidates on click, and returns its durable receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'action-executor-')), store = new AgentStore(join(dir, 'agents.db'))
  try {
    store.ensure('alice')
    const card = store.actions.offer('alice', 'one', { purpose: 'configuration', title: '更改名称', body: '名称改为 Alice', sessionId: 'session', subject: { kind: 'contact' }, actions: [{ id: 'save', label: '保存', tool: 'edit_contact_profile', arguments: { name: 'Alice', revision: 'profile-v1', reason: '改名' } }] })
    const run = vi.fn(async () => ({ content: '{"saved":true}', summary: '已保存' }))
    const prepare = vi.fn(async () => ({ execute: run }))
    const access = { start: async (version: string) => store.actions.startExecution('alice', card.id, version), read: async () => store.actions.get('alice', card.id), claim: async (version: string, response: any) => store.actions.claim('alice', card.id, version, response), finish: async (version: string, result: any) => store.actions.finish('alice', card.id, version, result), fail: async (version: string, message: string) => store.actions.fail('alice', card.id, version, message), reject: async (version: string) => store.actions.reject('alice', card.id, version), prepare }
    const response = { version: card.version, actionId: 'save' }
    const saved = await executeContactAction(access, response)
    expect(saved.status).toBe('resolved')
    expect(prepare).toHaveBeenCalledWith(card.request.actions[0], 'session')
    expect(await executeContactAction(access, response)).toEqual(saved)
    expect(run).toHaveBeenCalledTimes(1)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('never executes a stale or disabled prepared operation and retains a failed receipt', async () => {
  const card: any = { id: 'action:one', version: 'v2', kind: 'action', status: 'executing', response: { actionId: 'save' }, request: { sessionId: 'session', actions: [{ id: 'save', tool: 'edit_contact_profile', arguments: {} }] } }
  const fail = vi.fn(async (_version, message) => ({ ...card, status: 'failed', result: message }))
  const access: any = { read: async () => ({ ...card, status: 'pending' }), claim: async () => card, prepare: async () => { throw new Error('配置已变化') }, fail, finish: vi.fn() }
  expect((await executeContactAction(access, { version: 'v1', actionId: 'save' })).result).toContain('变化')
  expect(access.finish).not.toHaveBeenCalled()
})
