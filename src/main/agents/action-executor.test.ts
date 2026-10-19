import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { executeContactAction } from './action-executor'

it('executes a persisted choice once, revalidates on click, and returns its durable receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'action-executor-')), store = new ContactTaskStore(join(dir, 'agents.db'))
  try {
    store.ensure('alice')
    const card = store.actions.offer('alice', 'one', { purpose: 'configuration', title: '更改名称', body: '名称改为 Alice', sessionId: 'session', subject: { kind: 'contact' }, actions: [{ id: 'save', label: '保存', tool: 'edit_contact_profile', arguments: { name: 'Alice', revision: 'profile-v1', reason: '改名' } }] })
    const run = vi.fn(async () => ({ content: '{"saved":true}', summary: '已保存' }))
    const prepare = vi.fn(async () => ({ execute: run }))
    const access = { start: async (version: string) => store.actions.startExecution('alice', card.id, version), read: async () => store.actions.get('alice', card.id), claim: async (version: string, response: any) => store.actions.claim('alice', card.id, version, response), finish: async (version: string, result: any) => store.actions.finish('alice', card.id, version, result), fail: async (version: string, message: string) => store.actions.fail('alice', card.id, version, message), reject: async (version: string) => store.actions.reject('alice', card.id, version), prepare }
    const response = { version: card.version, actionId: 'save' }
    const saved = await executeContactAction(access, response)
    expect(saved.status).toBe('resolved')
    expect(prepare).toHaveBeenCalledWith(card.request.actions[0], 'session', undefined)
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
it('records an uncertain outcome when execution succeeded but its receipt could not be saved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'action-receipt-')), store = new ContactTaskStore(join(dir, 'agents.db'))
  try {
    store.ensure('alice')
    const card = store.actions.offer('alice', 'receipt', { purpose: 'configuration', title: '保存', body: '保存名称', sessionId: 'chat', subject: { kind: 'contact' }, actions: [{ id: 'save', label: '保存', tool: 'edit_contact_profile', arguments: { revision: 'v1', name: 'Alice', reason: '改名' } }] })
    const run = vi.fn(async () => ({ content: '{"saved":true}', summary: '已保存' }))
    const access = { read: async () => store.actions.get('alice', card.id), claim: async (v: string, r: any) => store.actions.claim('alice', card.id, v, r), start: async (v: string) => store.actions.startExecution('alice', card.id, v), prepare: async () => ({ execute: run }), finish: async () => { throw new Error('disk full') }, fail: async (v: string, m: string) => store.actions.fail('alice', card.id, v, m), reject: async (v: string) => store.actions.reject('alice', card.id, v) }
    const failed = await executeContactAction(access, { version: card.version, actionId: 'save' })
    expect(failed).toMatchObject({ status: 'failed', retryable: false })
    expect(failed.result).toContain('回执')
    expect(store.actions.acknowledge('alice', card.id, failed.version).status).toBe('resolved')
    expect(run).toHaveBeenCalledTimes(1)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('keeps a secure input out of every durable action field while passing it only to the credential writer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'action-secret-')), store = new ContactTaskStore(join(dir, 'agents.db'))
  try {
    store.ensure('alice')
    const card = store.actions.offer('alice', 'secret', { purpose: 'configuration', title: '搜索密钥', body: '使用安全输入保存。', sessionId: 'session', subject: { kind: 'contact' }, input: { label: '密钥', argument: 'credential', required: true, maxLength: 8192 }, actions: [{ id: 'save', label: '保存', tool: 'set_contact_search_credential', arguments: { revision: 0, reason: '更新密钥' } }] })
    const prepare = vi.fn(async (_option, _session, secret) => { expect(secret).toBe('private-transient-value'); return { execute: async () => ({ content: '{"saved":true}', summary: '搜索密钥已保存' }) } })
    await executeContactAction({ read: async () => card, claim: async (version, response) => store.actions.claim('alice', card.id, version, response), start: async version => store.actions.startExecution('alice', card.id, version), finish: async (version, result) => store.actions.finish('alice', card.id, version, result), fail: async (version, message) => store.actions.fail('alice', card.id, version, message), reject: async version => store.actions.reject('alice', card.id, version), prepare }, { version: card.version, actionId: 'save', credential: 'private-transient-value' })
    const row = store.db.prepare('SELECT value FROM contact_interactions WHERE id=?').get(card.id) as { value: string }
    expect(row.value).not.toContain('private-transient-value')
    expect(prepare.mock.calls[0][0].arguments).not.toHaveProperty('credential')
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
