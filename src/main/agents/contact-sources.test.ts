import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../../shared/agents'
import { parseResearchPlan } from './research'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const progress = { status: 'researching' as const, judgement: '已产出', openQuestions: '', nextStep: '继续', reason: '实际交付' }
const plan = { action: 'write', reason: '产出 idea', query: '', urls: [], checkAfterMinutes: 15 }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-contact-sources-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
  cleanup.push(() => { runtime.close(); store.close() })
  for (const id of ['writer', 'reviewer', 'private']) store.save(id, { ...DEFAULT_AGENT_SETTINGS, goal: id, dailyCalls: 400, intervalMinutes: 15, shareDeliveries: id === 'writer', readContactDeliveries: id === 'reviewer' })
  runtime.contactSources.names.set('writer', '阿想')
  const topic = (id: string) => store.overview(id).focusTopicId!
  function publish(id = 'writer', body = '帮助小团队整理需求的 AI 工具', section = 'idea1') {
    const run = store.createRun(id, '')
    store.finish(run, { runId: run, title: 'idea', body, nextStep: '继续', createdAt: Date.now(), evidence: [] }, [], progress,
      { completionCriteria: '持续产出', summary: 'idea', stages: [{ id: 'ideas', title: '产出', status: 'active' }], section: { id: section, title: section, body } })
    return run
  }
  return { store, runtime, topic, publish }
}
describe('agent-planned contact deliverable tools', () => {
  it('requires both permissions and exposes only shared deliverables', () => {
    const f = fixture(); f.publish(); f.publish('private', '私人成果')
    f.store.remember('writer', '私有记忆')
    const catalog = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '阿想')
    expect(catalog.items).toHaveLength(1)
    expect(JSON.stringify(catalog)).not.toContain('私有')
    expect(() => f.runtime.contactSources.discover('private', f.topic('private'), '')).toThrow('未授权')
    const ref = catalog.items[0].ref
    expect(f.runtime.contactSources.read('reviewer', f.topic('reviewer'), [ref])[0].text).toContain('AI 工具')
    expect(() => f.runtime.contactSources.read('reviewer', f.topic('reviewer'), [{ ...ref, characterId: 'private' }])).toThrow('未共享')
    expect(() => f.runtime.contactSources.read('reviewer', f.topic('reviewer'), [{ ...ref, topicId: f.topic('private') }])).toThrow()
    f.store.save('writer', { ...f.store.overview('writer').settings, shareDeliveries: false })
    expect(() => f.runtime.contactSources.read('reviewer', f.topic('reviewer'), [ref])).toThrow('撤回')
  })
  it('lets the model discover, select, read, score and trace versions without a source binding', async () => {
    const f = fixture(); f.publish()
    const run = f.store.createRun('reviewer', '')
    let calls = 0
    await f.runtime.execute(run, '独立评审员', async prompt => {
      calls++
      if (calls === 1) return JSON.stringify({ ...plan, action: 'discover_contacts', query: '阿想' })
      if (calls === 2) {
        expect(prompt).toContain('阿想')
        expect(prompt).not.toContain('帮助小团队')
        const ref = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].ref
        return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref] })
      }
      expect(prompt).toContain('帮助小团队')
      expect(prompt).toContain('contact-delivery://writer/')
      return JSON.stringify({ title: 'idea1 评价', body: '可行性 4/5；需求待验证 [1]', nextStep: '评价下一个', memories: [], question: '', progress })
    }, new AbortController().signal)
    expect(calls).toBe(3)
    expect(f.store.detail('reviewer', run).run.status).toBe('completed')
    expect(f.store.detail('reviewer', run).report?.evidence[0].url).toContain('version=1')
    expect(f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].processed).toBe(true)
    f.publish('writer', '第二个独立 idea', 'idea2')
    let catalog = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '')
    expect(catalog.items.find(i => i.ref.sectionId === 'idea1')?.processed).toBe(true)
    f.publish('writer', '修改后的 idea', 'idea1')
    catalog = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '')
    expect(catalog.items.find(i => i.ref.sectionId === 'idea1')?.processed).toBe(false)
    expect(f.store.detail('reviewer', run).report?.evidence[0].text).toContain('帮助小团队')
  })
  it('does not mark a failed evaluation as processed', async () => {
    const f = fixture(); f.publish()
    const ref = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].ref
    const run = f.store.createRun('reviewer', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref] }) : '{}', new AbortController().signal)
    expect(f.store.detail('reviewer', run).run.status).toBe('failed')
    expect(f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].processed).toBe(false)
  })
  it('repairs a source section mistakenly copied into the top-level revision ID after discovery', async () => {
    const f = fixture(); f.publish()
    const ref = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].ref
    const run = f.store.createRun('reviewer', '')
    let calls = 0
    await f.runtime.execute(run, '', async prompt => {
      calls++
      if (calls === 1) return JSON.stringify({ ...plan, action: 'discover_contacts' })
      if (calls === 2) return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref], sectionId: ref.sectionId })
      if (calls === 3) { expect(prompt).toContain('必须保留原 contactRefs'); return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref] }) }
      return JSON.stringify({ title: '评分', body: '可行性4/5 [1]', nextStep: '继续', memories: [], question: '', progress })
    }, new AbortController().signal)
    expect(calls).toBe(4)
    expect(f.store.detail('reviewer', run).run.status).toBe('completed')
    expect(f.store.detail('reviewer', run).report?.evidence[0].url).toContain(ref.sectionId)
  })
  it('validates contact refs and requires the explicit read capability', () => {
    const raw = JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [{ characterId: 'writer', topicId: 'topic', sectionId: 'idea1', version: 1 }] })
    expect(() => parseResearchPlan(raw, [], 15)).toThrow('未授权')
    expect(parseResearchPlan(raw, [], 15, 'public', false, true).action).toBe('read_contacts')
    expect(() => parseResearchPlan(raw.replace('"version":1', '"version":0'), [], 15, 'public', false, true)).toThrow('version 无效')
  })
  it.each(['missing', 'string-version', 'unknown', 'duplicate'])('repairs %s contact selections once using the real catalog', async fault => {
    const f = fixture(); f.publish()
    const ref = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].ref
    const run = f.store.createRun('reviewer', '')
    const refs = fault === 'missing' ? undefined : fault === 'string-version' ? [{ ...ref, version: '1' }]
      : fault === 'unknown' ? [{ ...ref, sectionId: 'guessed' }] : [ref, ref]
    let calls = 0
    await f.runtime.execute(run, '', async prompt => {
      calls++
      if (calls === 1) return JSON.stringify({ ...plan, action: 'discover_contacts' })
      if (calls === 2) return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: refs })
      if (calls === 3) {
        expect(prompt).toContain('修正本轮读取共享成果')
        expect(prompt).toContain(ref.topicId)
        expect(prompt).not.toContain('帮助小团队')
        return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref], resourceBudget: { modelCalls: 9999, reason: '不应增加' } })
      }
      expect(prompt).toContain('帮助小团队')
      return JSON.stringify({ title: '评价', body: '有待验证 [1]', nextStep: '继续', memories: [], question: '', progress })
    }, new AbortController().signal)
    expect(calls).toBe(4)
    const detail = f.store.detail('reviewer', run)
    expect(detail.run.status).toBe('completed')
    expect(detail.report?.evidence).toHaveLength(1)
    expect(detail.events.filter(event => event.kind === 'contact-plan-repair')).toHaveLength(1)
    expect(f.store.db.prepare('SELECT COUNT(*) AS count FROM calls WHERE run_id=?').get(run)).toEqual({ count: 4 })
  })
  it.each(['invalid-again', 'skip-reading'])('stops without publishing when contact correction returns %s', async fault => {
    const f = fixture(); f.publish()
    const run = f.store.createRun('reviewer', '')
    let calls = 0
    await f.runtime.execute(run, '', async () => {
      calls++
      if (calls === 1) return JSON.stringify({ ...plan, action: 'discover_contacts' })
      if (calls === 3 && fault === 'skip-reading') return JSON.stringify(plan)
      return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [] })
    }, new AbortController().signal)
    expect(calls).toBe(3)
    const detail = f.store.detail('reviewer', run)
    expect(detail.run.status).toBe('failed')
    expect(detail.run.error).toContain('自动修正后仍失败')
    expect(detail.report).toBeNull()
    expect(detail.events.some(event => event.kind === 'contact-source')).toBe(false)
    expect(f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].processed).toBe(false)
  })
  it('does not spend a repair call when daily resources cannot cover repair and analysis', async () => {
    const f = fixture(); f.publish()
    f.store.save('reviewer', { ...f.store.overview('reviewer').settings, dailyCalls: 3 })
    const run = f.store.createRun('reviewer', '')
    const model = vi.fn(async () => JSON.stringify({ ...plan, action: model.mock.calls.length === 1 ? 'discover_contacts' : 'read_contacts', contactRefs: [] }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(2)
    expect(f.store.detail('reviewer', run).run.error).toContain('额度不足')
    expect(f.store.detail('reviewer', run).report).toBeNull()
  })
  it('provides a real catalog for an invalid initial read plan and permits waiting without a fabricated report', async () => {
    const f = fixture(); f.publish()
    const run = f.store.createRun('reviewer', '')
    let calls = 0
    await f.runtime.execute(run, '', async prompt => {
      calls++
      if (calls === 1) return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [] })
      expect(prompt).toContain('idea1')
      return JSON.stringify({ ...plan, action: 'wait', reason: '暂时没有合适的新增评审对象' })
    }, new AbortController().signal)
    expect(calls).toBe(2)
    expect(f.store.detail('reviewer', run).run.status).toBe('completed')
    expect(f.store.detail('reviewer', run).report).toBeNull()
  })
  it('does not invoke correction or discovery without contact read permission', async () => {
    const f = fixture(); f.publish()
    const run = f.store.createRun('private', '')
    const discover = vi.spyOn(f.runtime.contactSources, 'discover')
    const model = vi.fn(async () => JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [] }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(discover).not.toHaveBeenCalled()
    expect(f.store.detail('private', run).run.error).toContain('未授权')
  })
  it('defers without analysis when no shared outputs exist', async () => {
    const f = fixture(), run = f.store.createRun('reviewer', '')
    const model = vi.fn(async () => JSON.stringify({ ...plan, action: 'discover_contacts' }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(f.store.detail('reviewer', run).run.status).toBe('completed')
    expect(f.store.detail('reviewer', run).report).toBeNull()
    expect(f.store.research(run)?.contactQuery).toBe('')
  })
  it('does not commit an evaluation after sharing is revoked mid-analysis', async () => {
    const f = fixture(); f.publish()
    const ref = f.runtime.contactSources.discover('reviewer', f.topic('reviewer'), '').items[0].ref
    const run = f.store.createRun('reviewer', '')
    await f.runtime.execute(run, '', async prompt => {
      if (prompt.startsWith('为联系人')) return JSON.stringify({ ...plan, action: 'read_contacts', contactRefs: [ref] })
      f.store.save('writer', { ...f.store.overview('writer').settings, shareDeliveries: false })
      return JSON.stringify({ title: '评分', body: '4/5', nextStep: '继续', memories: [], question: '', progress })
    }, new AbortController().signal)
    expect(f.store.detail('reviewer', run).run.status).toBe('failed')
    expect(f.store.detail('reviewer', run).report).toBeNull()
  })
  it('paces creative output when explicitly configured', async () => {
    const f = fixture()
    f.store.save('writer', { ...f.store.overview('writer').settings, paceWriting: true, enabled: true })
    const run = f.store.createRun('writer', '')
    await f.runtime.execute(run, '', async prompt => JSON.stringify(prompt.startsWith('为联系人') ? plan : {
      title: 'idea', body: '新增', nextStep: '继续', memories: [], question: '', progress,
      delivery: { completionCriteria: '持续产出', summary: '第一条', stages: [{ id: 'ideas', title: '产出', status: 'active' }], section: { id: 'idea1', title: 'idea1', body: '可用正文' } }
    }), new AbortController().signal)
    expect(f.store.detail('writer', run).run.status).toBe('completed')
    expect(f.store.overview('writer').nextAt).toBeGreaterThan(Date.now() + 14 * 60000)
  })
  it('stops a timed continuous worker before spending another model call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chouyu-timed-agent-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const model = vi.fn(async () => '{}'), service = new AgentService(dir, () => {}, () => model)
    cleanup.push(() => service.close())
    const settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, goal: '24h 实验', enabled: true, workUntil: Date.now() - 1 }
    service.store.save('writer', settings)
    await service.sync([{ id: 'writer', soul: '', conversation: '', config: null }])
    expect(service.store.overview('writer').settings.enabled).toBe(false)
    expect(model).not.toHaveBeenCalled()
  })
})
