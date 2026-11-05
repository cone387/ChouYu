import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { createBackgroundHarnesses } from '../harness/background'
import { startMockProvider } from '../harness/dsh/fixtures/mock-provider.mjs'
import { createWorkModel } from './model'
import type { SkillRunner } from '../skills/runner'

it.each((['native', 'dsh'] as const).flatMap(engine => [false, true].map(fail => ({ engine, fail }))))('$engine sends persisted requests to the real provider adapter without claiming consumption on failure=$fail', async ({ engine, fail }) => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-request-model-'))
  const provider = await startMockProvider('openai', { tools: false, text: '已收到原始要求', ...(fail ? { failure: { status: 400, message: 'fixture rejected' } } : {}) })
  const harnesses = createBackgroundHarnesses({ home: join(dir, 'dsh'), node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  const store = new ContactTaskStore(join(dir, 'tasks.db'))
  try {
    store.ensure('alice')
    const topic = store.topics.create('alice', { title: '文章', goal: '写文章', constraints: '' })
    store.requests.apply('alice', { source: { requestId: 'req', sessionId: 's', text: '保留结论并增加真实案例_CEDAR_729', acceptedAt: 100 }, tool: 'edit_contact_task', arguments: { topicId: topic.id } }, () => ({ topicId: topic.id, effect: 'requirements' }))
    const runId = store.createRun('alice', '', Date.now(), topic.id), run = store.getRun(runId)!
    const identity = { id: 'alice', soul: '独立联系人', conversation: '', config: { provider: 'openai' as const, baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] } }
    const model = createWorkModel({ store, run, identity, input: { skills: { entries: [], instruction: '' }, materialDirectory: [], backgroundHarnessEngine: engine }, skillRunner: {} as SkillRunner, harnesses, changed() {}, request: async () => { throw new Error('No tool requested') } })
    store.charge(runId)
    const pending = model('按当前协议只输出正文。', new AbortController().signal, { tools: false, plainText: true })
    if (fail) await expect(pending).rejects.toThrow()
    else await expect(pending).resolves.toBe('已收到原始要求')
    expect(JSON.stringify(provider.requests[0]?.body.messages)).toContain('保留结论并增加真实案例_CEDAR_729')
    const attempt = store.requests.list('alice', topic.id).items[0].attempts[0]
    if (fail) expect(attempt.suppliedAt).toBeUndefined()
    else expect(attempt.suppliedAt).toEqual(expect.any(Number))
    expect(attempt.resultVersion).toBeUndefined()
  } finally {
    for (const engine of ['native', 'dsh'] as const) await harnesses.get(engine).lifecycle?.close?.()
    store.close(); await provider.close(); rmSync(dir, { recursive: true, force: true })
  }
}, 45000)
