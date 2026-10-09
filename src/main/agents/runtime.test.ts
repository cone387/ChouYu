import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime, parseDraft } from './runtime'
import { AgentService, type AgentIdentity } from './service'
import { evidenceFromText, publicAddress } from './sources'
import { DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../shared/agents'

const directories: string[] = []
const cleanups: (() => void | Promise<void>)[] = []
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'chouyu-agents-')); directories.push(dir); return dir }
const settings = { ...DEFAULT_AGENT_SETTINGS, goal: '研究真实需求', sources: ['https://example.com/'] }
const evidence = evidenceFromText(settings.sources[0], '<title>调查</title>' + '这是本轮真实读取的资料，用户愿意为什么付费还需要验证。'.repeat(4))
const reader = vi.fn(async () => evidence)
const draft = { title: '本轮机会假设', body: '资料 [1] 提到了需求，尚未验证付费意愿。', nextStep: '下轮跟进需求证据', memories: ['付费意愿仍是待验证假设'], question: '', progress: { judgement: '需求存在，付费意愿尚未验证。', openQuestions: '用户是否付费？', nextStep: '下轮跟进需求证据', reason: '资料 [1] 提到了需求，但没有付费证据。', status: 'needs_evidence' } }
afterEach(async () => { reader.mockClear(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const dir = directory(), store = new AgentStore(join(dir, 'store.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader)
  cleanups.push(() => store.close(), () => runtime.close())
  store.save('alice', settings); store.save('bob', settings)
  return { dir, store, runtime }
}
describe('contact agent durability and isolation', () => {
  it.each(['stop', 'length'])('handles provider output ending with %s without a blind repair', async finishReason => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).max_tokens).toBe(8192)
      const payloads = [
        { choices: [{ delta: { content: finishReason === 'stop' ? JSON.stringify(draft) : '{"body":"unfinished' } }] },
        { choices: [{ delta: {}, finish_reason: finishReason }] },
        { choices: [], usage: { completion_tokens: finishReason === 'stop' ? 3000 : 8192 } }
      ]
      return new Response(payloads.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    })
    cleanups.push(() => fetchMock.mockRestore())
    const service = new AgentService(directory(), () => {}, undefined, reader)
    cleanups.push(() => service.close())
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('save', 'alice', [settings])
    await service.request('run', 'alice')
    await vi.waitFor(() => expect(service.store.overview('alice').runs[0]?.status).toBe(finishReason === 'stop' ? 'completed' : 'failed'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const run = service.store.overview('alice').runs[0]
    expect(service.store.detail('alice', run.id).events.some(e => e.kind === 'format-repair')).toBe(false)
    if (finishReason === 'length') {
      expect(run.error).toContain('被截断')
      expect(service.store.overview('alice').reports).toEqual([])
      expect(service.store.overview('alice').memories).toEqual([])
    }
  })
  it('repairs malformed output once and charges the additional call before committing', async () => {
    const { store, runtime } = fixture(), run = store.createRun('alice', '')
    const model = vi.fn().mockResolvedValueOnce('invalid JSON').mockResolvedValueOnce(JSON.stringify(draft))
    await runtime.execute(run, '', model, new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('completed')
    expect(store.overview('alice').reports).toHaveLength(1)
    expect(store.callCount('alice')).toBe(2)
    expect(store.detail('alice', run).events.some(e => e.kind === 'format-repaired')).toBe(true)
    expect(model.mock.calls[1][0]).toContain('校验错误：')
    expect(model.mock.calls[1][0]).toContain('模型未返回有效的结构化成果')
    expect(store.overview('alice').latestActivity?.kind).toBe('completed')
    expect(store.overview('bob').latestActivity).toBeUndefined()
  })
  it('stops after one unsuccessful repair without creating a report or memory', async () => {
    const { store, runtime } = fixture(), run = store.createRun('alice', '')
    const model = vi.fn(async () => 'invalid JSON')
    await runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(2)
    expect(store.detail('alice', run).run.status).toBe('failed')
    expect(store.overview('alice').reports).toEqual([])
    expect(store.overview('alice').memories).toEqual([])
    expect(store.detail('alice', run).run.error).toContain('模型未返回有效的结构化成果')
    expect(store.overview('alice').latestActivity?.kind).toBe('failed')
  })
  it('does not exceed the daily budget for format repair', async () => {
    const { store, runtime } = fixture()
    store.save('alice', { ...settings, dailyCalls: 2 })
    const run = store.createRun('alice', ''), model = vi.fn(async () => 'invalid JSON')
    store.charge(run)
    await runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(store.callCount('alice')).toBe(2)
    expect(store.detail('alice', run).run.status).toBe('failed')
  })
  it('commits evidence and private memories once, without leaking another contact', async () => {
    const { store, runtime } = fixture()
    store.remember('bob', 'BOB_PRIVATE')
    const run = store.createRun('alice', 'ALICE_CHAT'), model = vi.fn(async prompt => { expect(prompt).toContain('ALICE_CHAT'); expect(prompt).not.toContain('BOB_PRIVATE'); return JSON.stringify(draft) })
    await runtime.execute(run, 'Alice', model, new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('completed')
    expect(store.detail('alice', run).report?.evidence[0].hash).toBe(evidence.hash)
    expect(store.overview('alice').memories[0].runId).toBe(run)
    expect(store.overview('bob').reports).toEqual([])
    expect(() => store.detail('bob', run)).toThrow()
    store.finish(run, store.detail('alice', run).report!, draft.memories)
    expect(store.overview('alice').reports).toHaveLength(1)
    expect(store.callCount('alice')).toBe(1)
  })
  it('resumes a legacy persisted human interrupt without another model call', async () => {
    const { dir, store, runtime } = fixture()
    const run = store.createRun('alice', '')
    const legacyInput = JSON.parse(store.getRun(run)!.input); delete legacyInput.deliveryVersion; delete legacyInput.delivery
    store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(legacyInput), run)
    await runtime.execute(run, 'Alice', async () => JSON.stringify({ ...draft, question: '你更熟悉哪个行业？' }), new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('waiting')
    runtime.close(); store.close(); cleanups.splice(0)
    const reopened = new AgentStore(join(dir, 'store.db')), recovered = new AgentRuntime(reopened, join(dir, 'checkpoints.db'), reader)
    cleanups.push(() => reopened.close(), () => recovered.close())
    reopened.recover(); reopened.answer('alice', run, '开发者工具')
    const model = vi.fn(async () => { throw new Error('must not call') })
    await recovered.execute(run, 'Alice', model, new AbortController().signal)
    expect(reopened.detail('alice', run).run.status).toBe('completed')
    expect(reopened.detail('alice', run).report?.body).toContain('开发者工具')
    expect(model).not.toHaveBeenCalled(); expect(reader).toHaveBeenCalledTimes(1)
    expect(reopened.callCount('alice')).toBe(1)
  })
  it('retries an interrupted model step from its checkpoint, charges attempts, and does not reread sources', async () => {
    const { store, runtime } = fixture(), run = store.createRun('alice', ''), controller = new AbortController()
    await expect(runtime.execute(run, '', async () => { controller.abort(); throw new Error('process interrupted') }, controller.signal)).rejects.toThrow()
    store.recover()
    await runtime.execute(run, '', async () => JSON.stringify(draft), new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('completed')
    expect(reader).toHaveBeenCalledTimes(1); expect(store.callCount('alice')).toBe(2)
  })
  it('rejects late results after pause and enforces daily budget before calls', async () => {
    const { store, runtime } = fixture(), run = store.createRun('alice', '')
    await runtime.execute(run, '', async () => { store.pause('alice'); return JSON.stringify(draft) }, new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('cancelled')
    expect(store.overview('alice').reports).toHaveLength(0)
    store.save('alice', { ...settings, dailyCalls: 2 }); const next = store.createRun('alice', '')
    store.charge(next); expect(() => store.charge(next)).toThrow('上限')
    expect(store.callCount('alice')).toBe(2)
  })
  it('does not turn missing evidence or malformed output into memories', async () => {
    const { store, runtime } = fixture(), run = store.createRun('alice', '')
    const model = vi.fn(async () => 'not json')
    reader.mockRejectedValueOnce(new Error('unavailable'))
    await runtime.execute(run, '', model, new AbortController().signal)
    expect(model).not.toHaveBeenCalled(); expect(store.detail('alice', run).run.status).toBe('failed')
    const next = store.createRun('alice', '')
    await runtime.execute(next, '', model, new AbortController().signal)
    expect(store.overview('alice').memories).toHaveLength(0)
    expect(store.detail('alice', next).run.status).toBe('failed')
  })
  it('continues three rounds using its previous conclusions and changing evidence', async () => {
    const { store, runtime } = fixture()
    for (let round = 0; round < 3; round++) {
      const changed = { ...evidence, text: `round-${round}: ` + evidence.text, hash: `hash-${round}` }
      reader.mockResolvedValueOnce(changed)
      const run = store.createRun('alice', '')
      await runtime.execute(run, 'Alice', async prompt => {
        expect(prompt).toContain(`round-${round}`)
        if (round) expect(prompt).toContain(`conclusion-${round - 1}`)
        return JSON.stringify({ ...draft, title: `conclusion-${round}`, body: round ? '新证据改变了上轮假设。' : '初始假设需要验证。', memories: [`第 ${round} 轮结论`] })
      }, new AbortController().signal)
    }
    const overview = store.overview('alice')
    expect(overview.reports).toHaveLength(3)
    expect(overview.reports.map(r => r.evidence[0].hash)).toEqual(['hash-2', 'hash-1', 'hash-0'])
    expect(overview.memories).toHaveLength(3)
  })
  it('deduplicates active work and blocks automatic dispatch after three failures', () => {
    const { store } = fixture(); store.save('alice', { ...settings, enabled: true })
    const first = store.createRun('alice', '')
    expect(store.createRun('alice', '')).toBe(first)
    for (let i = 0; i < 3; i++) { const id = store.createRun('alice', ''); store.fail(id, 'source unavailable') }
    expect(store.overview('alice').settings.enabled).toBe(true)
    expect(store.overview('alice').failures).toBe(3)
    expect(store.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
  })
  it('removes a role while a model call is in flight and cannot resurrect its records', async () => {
    const dir = directory(); let started!: () => void
    const entered = new Promise<void>(r => { started = r })
    const service = new AgentService(dir, () => {}, () => async (_prompt, signal) => { started(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); return JSON.stringify(draft) }, reader)
    cleanups.push(() => service.close())
    const identity: AgentIdentity = { id: 'alice', soul: 'Alice', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'private-provider-secret', model: 'test', thinkingDisabledModels: [] } }
    await service.sync([identity]); await service.request('save', 'alice', [settings]); await service.request('run', 'alice')
    await entered
    expect(JSON.stringify(service.store.db.prepare('SELECT input FROM runs').all())).not.toContain('private-provider-secret')
    await service.remove('alice')
    expect(service.store.profile('alice')).toBeUndefined(); expect(service.store.runnable()).toEqual([])
    const persisted = service.store.db.prepare('SELECT input FROM runs').all()
    expect(JSON.stringify(persisted)).not.toContain('private-provider-secret')
  })
  it('automatically schedules enabled contacts, leaves others idle, and respects the next due time', async () => {
    const model = vi.fn(async () => JSON.stringify(draft))
    const service = new AgentService(directory(), () => {}, () => model, reader)
    cleanups.push(() => service.close())
    const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }
    await service.sync(['alice', 'bob'].map(id => ({ id, soul: id, conversation: '', config })))
    await service.request('save', 'bob', [settings])
    expect(model).not.toHaveBeenCalled()
    await service.request('save', 'alice', [{ ...settings, enabled: true }])
    await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(1))
    service.tick(); expect(model).toHaveBeenCalledTimes(1)
    service.store.db.prepare('UPDATE profiles SET next_at=0 WHERE character_id=?').run('alice')
    service.tick()
    await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(2))
    expect(service.store.overview('bob').runs).toHaveLength(0)
    await expect(service.request('remove', 'not-yet-synced')).resolves.toBeNull()
  })
})
describe('agent source and output boundaries', () => {
  it.each(['127.0.0.1', '10.0.0.8', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1'])('blocks reserved address %s', ip => expect(publicAddress(ip)).toBe(false))
  it('accepts public IPv4, rejects credential URLs, and strips executable text', () => {
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(() => validateAgentSettings({ ...settings, sources: ['https://user:password@example.com'] })).toThrow()
    expect(() => validateAgentSettings({ ...settings, intervalMinutes: 0 })).toThrow()
    expect(evidenceFromText('https://example.com', '<script>STEAL_TOKEN</script>' + 'public text '.repeat(10)).text).not.toContain('STEAL_TOKEN')
    expect(() => parseDraft('{"title":1}')).toThrow()
  })
})

it('accepts unambiguous JSON wrappers and lossless optional question representations', () => {
  const base = { title: '报告', body: '正文', nextStep: '继续', memories: [], question: null,
    progress: { judgement: '已交付', reason: '实际正文', nextStep: '继续', status: 'researching', openQuestions: ['验证需求', '核对成本'] } }
  const value = parseDraft(`以下是成果：\n${JSON.stringify(base)}\n结束。`)
  expect(value.question).toBe('')
  expect(value.progress?.openQuestions).toBe('验证需求\n核对成本')
  expect(parseDraft(JSON.stringify({ ...base, question: ['选择哪个方向？'], progress: { ...base.progress, openQuestions: null } })).question).toBe('选择哪个方向？')
  expect(() => parseDraft(JSON.stringify({ ...base, progress: { ...base.progress, openQuestions: { bad: true } } }))).toThrow('类型应为字符串')
  expect(() => parseDraft(JSON.stringify(base) + JSON.stringify(base))).toThrow('唯一')
  expect(() => parseDraft(JSON.stringify({ ...base, title: 'x'.repeat(161) }))).toThrow('长度 161 超过 160')
  expect(() => parseDraft(JSON.stringify({ ...base, progress: { ...base.progress, reason: '' } }))).toThrow('变化原因')
})

it('preserves stage 31 through 300 for a long-running deliverable while retaining a bounded capacity', () => {
  const base = { title: '新章节', body: '变化说明', nextStep: '继续', question: '', memories: [],
    delivery: { completionCriteria: '写完整本书', summary: '累计进度', section: { id: 'chapter31', title: '新章节', body: '实际正文' },
      stages: Array.from({ length: 31 }, (_, i) => ({ id: `stage${i}`, title: `阶段${i}`, status: i < 30 ? 'done' : 'active' })) } }
  expect(parseDraft(JSON.stringify(base)).delivery?.stages).toHaveLength(31)
  const full = { ...base, delivery: { ...base.delivery, stages: Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, title: '阶段', status: 'active' })) } }
  expect(parseDraft(JSON.stringify(full)).delivery?.stages).toHaveLength(300)
  expect(() => parseDraft(JSON.stringify({ ...full, delivery: { ...full.delivery, stages: [...full.delivery.stages, { id: 'overflow', title: '阶段', status: 'active' }] } }))).toThrow('300')
})

it('uses validated section prose when the redundant report body is absent', () => {
  const base = { title: '新章节', nextStep: '继续', question: '', memories: [],
    delivery: { completionCriteria: '完成全书', summary: '已写第一节', stages: [{ id: 'volume1', title: '第一卷', status: 'active' }], section: { id: 'ch1', title: '第一节', body: '真正的小说正文。' } } }
  expect(parseDraft(JSON.stringify(base)).body).toBe(base.delivery.section.body)
  expect(parseDraft(JSON.stringify({ ...base, body: null })).body).toBe(base.delivery.section.body)
  expect(() => parseDraft(JSON.stringify({ ...base, delivery: { ...base.delivery, section: { ...base.delivery.section, body: '' } } }))).toThrow('分节')
  expect(() => parseDraft(JSON.stringify({ ...base, delivery: undefined }))).toThrow('body')
})
