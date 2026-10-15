import { expect, it, vi } from 'vitest'
import { routeContactChange } from './chat-changes'
import type { ContactInteraction } from '../../shared/contact-interactions'

it('routes explicit acknowledgement only for an uncertain action, without re-executing it', async () => {
  if (card.kind !== 'action') throw new Error('Invalid action fixture')
  const plan = { kind: 'interaction', interactionId: card.id, evidence: '已核对', acknowledge: true }
  const f = fixture(plan, [{ ...card, status: 'failed', retryable: false }])
  await f.run('已核对当前状态，关闭这项')
  expect(f.submit).toHaveBeenCalledExactlyOnceWith(card.id, { version: card.version, acknowledge: true })
  await expect(fixture(plan).run('已核对')).rejects.toThrow('不确定')
})

const card: ContactInteraction = { kind: 'action', id: 'action:one', version: 'saved-version', characterId: 'alice', topicTitle: '选择交付方案', status: 'pending', createdAt: 1, budgets: [], request: { purpose: 'choice', title: '选择交付方案', body: '可以先做调研或先写提纲。', sessionId: 'session', subject: { kind: 'contact' }, actions: [{ id: 'research', label: '先调研', tool: 'assign_contact_task', arguments: { description: '调研' } }, { id: 'outline', label: '先写提纲', tool: 'assign_contact_task', arguments: { description: '写提纲' } }] } }
function fixture(plan: unknown, cards = [card]) {
  const submit = vi.fn(async (id: string, _response: any) => ({ ...cards.find(card => card.id === id)!, status: 'resolved' as const, result: '任务已排队，尚未完成' }))
  const execute = vi.fn()
  const run = (content: string, previous = '之前说过同意') => routeContactChange([{ role: 'user', content: previous }, { role: 'user', content }], { read: async () => ({ topics: [], runs: [], settings: {}, revision: 1 }), model: async () => JSON.stringify(plan), execute, interactions: async () => cards, submitInteraction: submit })
  return { run, submit, execute }
}
it('uses a real pending option and captured version for a natural-language choice', async () => {
  const f = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', evidence: '先写提纲' })
  expect(await f.run('先写提纲吧')).toContain('排队')
  expect(f.submit).toHaveBeenCalledExactlyOnceWith(card.id, { version: card.version, actionId: 'outline' })
  expect(f.execute).not.toHaveBeenCalled()
})
it('repairs a missing actionId once before submitting the current explicit choice', async () => {
  const incomplete = { kind: 'interaction', interactionId: card.id, evidence: '先写提纲' }
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(incomplete)).mockResolvedValueOnce(JSON.stringify({ ...incomplete, actionId: 'outline' }))
  const submit = vi.fn(async () => ({ ...card, status: 'resolved' as const, result: '已提交提纲任务' }))
  const reply = await routeContactChange([{ role: 'user', content: '先写提纲吧' }], { read: async () => ({ topics: [], runs: [] }), model, execute: vi.fn(), interactions: async () => [card], submitInteraction: submit })
  expect(reply).toBe('已提交提纲任务')
  expect(model).toHaveBeenCalledTimes(2)
  expect(submit).toHaveBeenCalledExactlyOnceWith(card.id, { version: card.version, actionId: 'outline' })
})
it('never invents or submits an action if the repaired decision still omits actionId', async () => {
  const model = vi.fn(async () => JSON.stringify({ kind: 'interaction', interactionId: card.id, evidence: '同意' }))
  const submit = vi.fn()
  await expect(routeContactChange([{ role: 'user', content: '同意' }], { read: async () => ({ topics: [], runs: [] }), model, execute: vi.fn(), interactions: async () => [card], submitInteraction: submit })).rejects.toThrow()
  expect(model).toHaveBeenCalledTimes(2)
  expect(submit).not.toHaveBeenCalled()
})
it('does not use historical consent or invented actions as a new authorization', async () => {
  const historical = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', evidence: '同意' })
  await expect(historical.run('先别执行')).rejects.toThrow('本条')
  expect(historical.submit).not.toHaveBeenCalled()
  const invented = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'delete', evidence: '删除' })
  await expect(invented.run('删除')).rejects.toThrow('实际操作')
})
it('asks which card when multiple pending items make a short answer ambiguous', async () => {
  const f = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', evidence: '同意' }, [card, { ...card, id: 'action:two', topicTitle: '另一个事项' }])
  expect(await f.run('同意')).toContain('哪一项')
  expect(f.submit).not.toHaveBeenCalled()
})
it('distinguishes identical card titles by an explicit unique description from the latest message', async () => {
  if (card.kind !== 'action') throw new Error('fixture')
  const cards = [{ ...card, request: { ...card.request, body: '把名字改为阿笔' } }, { ...card, id: 'action:two', request: { ...card.request, body: '把名字改为小周' } }]
  const f = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', targetText: '名字改为阿笔', evidence: '同意' }, cards)
  await f.run('同意名字改为阿笔那项')
  expect(f.submit).toHaveBeenCalledTimes(1)
  const invented = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', targetText: '名字改为阿笔', evidence: '同意' }, cards)
  expect(await invented.run('同意')).toContain('哪一项')
  expect(invented.submit).not.toHaveBeenCalled()
})
it('keeps additional text only when the saved card actually provides that input', async () => {
  const f = fixture({ kind: 'interaction', interactionId: card.id, actionId: 'outline', text: '改成删除', evidence: '提纲' })
  await expect(f.run('提纲')).rejects.toThrow('回复')
  expect(f.submit).not.toHaveBeenCalled()
})
it('answers a task question through the same card submission as the button', async () => {
  const question: ContactInteraction = { kind: 'question', id: 'q', version: 'q-v1', characterId: 'alice', topicId: 't', runId: 'r', topicTitle: '文章', question: '读者是谁？', status: 'pending', createdAt: 1, budgets: [] }
  const f = fixture({ kind: 'interaction', interactionId: 'q', answer: '高中生', evidence: '高中生' }, [question])
  await f.run('高中生')
  expect(f.submit).toHaveBeenCalledExactlyOnceWith('q', { version: 'q-v1', answer: '高中生' })
})
