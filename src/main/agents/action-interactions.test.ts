import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { ContactActions } from './action-interactions'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'contact-actions-'))
  const path = join(directory, 'agents.db'), store = new AgentStore(path)
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '独立工作' }, Date.now(), false)
  store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: '另一位联系人' }, Date.now(), false)
  const actions = new ContactActions(store)
  const request = { purpose: 'configuration', title: '修改工作时间', body: '仅修改此联系人的工作时间。', sessionId: 'chat', subject: { kind: 'contact' }, actions: [{ id: 'apply', label: '应用', tool: 'edit_contact_work_settings', arguments: { revision: store.overview('alice').revision, workStart: '20:00', workEnd: '23:00', reason: '晚上工作' } }] }
  return { store, actions, request, path }
}
it('persists a pending action without a task and deduplicates its source request across database reopen', () => {
  const f = fixture()
  const first = f.actions.offer('alice', 'request-one', f.request)
  expect(first).toMatchObject({ kind: 'action', status: 'pending', characterId: 'alice', request: f.request })
  expect(first.topicId).toBeUndefined()
  expect(f.store.topics.list('alice')).toEqual([])
  const reopened = new AgentStore(f.path); cleanups.push(() => reopened.close())
  const actions = new ContactActions(reopened)
  expect(actions.offer('alice', 'request-one', f.request)).toEqual(first)
  expect(() => actions.get('bob', first.id)).toThrow('归属')
  expect(() => actions.offer('alice', 'request-one', { ...f.request, title: '不同操作' })).toThrow('不同')
})
it('claims an action once and preserves the exact result for repeated submissions', () => {
  const f = fixture(), first = f.actions.offer('alice', 'request-one', f.request)
  const claimed = f.actions.claim('alice', first.id, first.version, { actionId: 'apply' })
  expect(claimed.status).toBe('executing')
  expect(() => f.actions.claim('alice', first.id, first.version, { actionId: 'apply' })).toThrow('处理')
  const result = { content: '{"saved":true}', summary: '已保存工作时间' }
  const saved = f.actions.finish('alice', first.id, claimed.version, result)
  expect(saved).toMatchObject({ status: 'resolved', result: '已保存工作时间', outcome: result })
  expect(f.actions.claim('alice', first.id, first.version, { actionId: 'apply' })).toEqual(saved)
})
it('rejects expired task or delivery versions and never resurrects deleted targets', () => {
  const f = fixture(), topic = f.store.topics.create('alice', { title: '写作', goal: '写文章', constraints: '' })
  const card = f.actions.offer('alice', 'task-request', { ...f.request, subject: { kind: 'task', topicId: topic.id, revision: topic.revision } })
  f.store.topics.edit('alice', topic.id, topic.revision, { ...topic, goal: '改写文章' }, '修改')
  expect(f.actions.get('alice', card.id).status).toBe('obsolete')
  expect(() => f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })).toThrow('变化')
})
it('distinguishes an interrupted attempt from resolved and requires revalidation before retrying', () => {
  const f = fixture(), card = f.actions.offer('alice', 'request-one', f.request)
  const claimed = f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })
  f.actions.fail('alice', card.id, claimed.version, '保存失败，请重试')
  const failed = f.actions.get('alice', card.id)
  expect(failed.status).toBe('failed')
  expect(failed.outcome).toBeUndefined()
  expect(() => f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })).toThrow('变化')
  expect(f.actions.claim('alice', card.id, failed.version, { actionId: 'apply' }).status).toBe('executing')
})
it('records explicit rejection without performing work and rejects stale completion receipts', () => {
  const f = fixture(), card = f.actions.offer('alice', 'request-one', f.request)
  const rejected = f.actions.reject('alice', card.id, card.version)
  expect(rejected).toMatchObject({ status: 'resolved', result: '已拒绝，此操作未执行。' })
  expect(() => f.actions.finish('alice', card.id, card.version, { content: 'fake', summary: '假的成功' })).toThrow()
  expect(f.store.overview('alice').settings.workHours).toBeUndefined()
})
it('rolls back claims if persisting the action record fails', () => {
  const f = fixture(), card = f.actions.offer('alice', 'request-one', f.request)
  f.store.db.exec("CREATE TRIGGER fail_action BEFORE UPDATE ON contact_interactions BEGIN SELECT RAISE(ABORT,'disk full'); END")
  expect(() => f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })).toThrow('disk full')
  expect(f.actions.get('alice', card.id)).toEqual(card)
})
it('shares the existing interaction read and pending list without inventing a task', () => {
  const f = fixture(), card = f.actions.offer('alice', 'shared', f.request)
  expect(f.store.decisions.get('alice', card.id)).toEqual(card)
  expect(f.store.decisions.pending('alice')).toEqual([card])
  const claimed = f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })
  f.actions.fail('alice', card.id, claimed.version, '保存失败')
  expect(f.store.decisions.pending('alice')[0].status).toBe('failed')
})
it('recovers an interrupted execution as unresolved rather than claiming success', () => {
  const f = fixture(), card = f.actions.offer('alice', 'interrupted', f.request)
  f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })
  f.store.recover()
  expect(f.actions.get('alice', card.id)).toMatchObject({ status: 'failed', result: expect.stringContaining('尚未确认结果') })
  expect(f.actions.get('alice', card.id).outcome).toBeUndefined()
})
it('keeps the notification pending until explicitly acknowledged and never republishes an acknowledged card', () => {
  const f = fixture(), card = f.actions.offer('alice', 'notice', f.request)
  expect(f.actions.notices('alice')).toEqual([card])
  expect(() => f.actions.ack('bob', card.id)).toThrow('归属')
  f.actions.ack('alice', card.id)
  expect(f.actions.notices('alice')).toEqual([])
  f.actions.offer('alice', 'notice', f.request)
  expect(f.actions.notices('alice')).toEqual([])
})
it('does not execute a possibly committed operation again when its completion receipt was lost', () => {
  const f = fixture(), card = f.actions.offer('alice', 'uncertain', f.request)
  const claimed = f.actions.claim('alice', card.id, card.version, { actionId: 'apply' })
  f.actions.startExecution('alice', card.id, claimed.version)
  f.store.recover()
  const interrupted = f.actions.get('alice', card.id)
  expect(interrupted.retryable).toBe(false)
  expect(() => f.actions.claim('alice', card.id, interrupted.version, { actionId: 'apply' })).toThrow('核对')
})
it('invalidates a contact-only card when a manual entry changes the captured setting version', () => {
  const f = fixture(), card = f.actions.offer('alice', 'profile', { ...f.request, actions: [{ id: 'apply', label: '保存', tool: 'edit_contact_profile', arguments: { name: '新名称', revision: 'old-profile', reason: '改名' } }] })
  f.actions.reconcile('alice', { profile: 'new-profile', skills: 1, credential: 0 })
  expect(f.actions.get('alice', card.id)).toMatchObject({ status: 'obsolete', result: expect.stringContaining('设置已变化') })
  expect(f.store.decisions.pending('alice')).toEqual([])
})
