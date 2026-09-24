import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { AgentService } from './service'
import { evidenceFromText } from './sources'
import { DEFAULT_AGENT_SETTINGS, validateTopicProgress, type AgentTopicProgress } from '../../shared/agents'

const dirs: string[] = [], closers: (() => void | Promise<void>)[] = []
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'chouyu-topics-')); dirs.push(path); return path }
const settings = { ...DEFAULT_AGENT_SETTINGS, goal: '研究开发者付费需求', sources: ['https://example.com/'] }
const progress: AgentTopicProgress = { judgement: '初始需求假设', openQuestions: '付费意愿？', nextStep: '核对反对证据', reason: '资料 [1] 有需求线索，仍需验证。', status: 'needs_evidence' }
const output = (next: AgentTopicProgress = progress, question = '') => JSON.stringify({ title: '需求研究', body: '依据资料 [1] 更新假设，尚未验证收益。', nextStep: next.nextStep, memories: [], question, progress: next })
const reader = async () => evidenceFromText(settings.sources[0], '公开访谈：用户希望减少操作，但是否愿意付费尚未确定。'.repeat(8))
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const dir = directory(), store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader)
  closers.push(() => store.close(), () => runtime.close())
  store.save('alice', settings); store.save('bob', settings)
  return { dir, store, runtime, topic: store.overview('alice').topics[0] }
}

describe('persistent contact topics', () => {
  it('applies confirmed feedback with profile and topic checks and resumes without enabling scheduling', async () => {
    const model = vi.fn(async () => output())
    const service = new AgentService(directory(), () => {}, () => model, reader); closers.push(() => service.close())
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('save', 'alice', [settings])
    let data = service.store.overview('alice'), topic = data.topics[0]
    await service.request('feedback', 'alice', [data.revision, 'topicStatus', [topic.id, topic.revision, 'paused', '聊天要求暂停']])
    data = service.store.overview('alice'); topic = data.topics[0]
    await service.request('save', 'alice', [{ ...settings, dailyCalls: 3 }])
    await expect(service.request('feedback', 'alice', [data.revision, 'continueTopic', [topic.id, topic.revision, '继续', '']])).rejects.toThrow('工作设置已变化')
    expect(model).not.toHaveBeenCalled()
    data = service.store.overview('alice')
    await service.request('feedback', 'alice', [data.revision, 'continueTopic', [topic.id, topic.revision, '聊天要求继续验证']])
    await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(1))
    expect(model).toHaveBeenCalledTimes(1)
    expect(service.store.overview('alice').settings.enabled).toBe(false)
    expect(service.store.topics.detail('alice', topic.id).changes.map(change => change.reason)).toContain('聊天要求继续验证')
    await expect(service.request('feedback', 'alice', [data.revision, 'topicStatus', [topic.id, topic.revision, 'paused', '旧确认']])).rejects.toThrow('事项已变化')
  })
  it('keeps one topic through three rounds, changed evidence, restart and a human reply', async () => {
    const initial = fixture(), topicId = initial.topic.id
    let store = initial.store, runtime = initial.runtime
    const conclusions = ['需求存在但付费未知', '反对证据：访谈用户只愿意使用免费方案', '缩小到团队付费场景，待补证据']
    const runIds: string[] = []
    for (let round = 0; round < 3; round++) {
      if (round === 1) {
        runtime.close(); store.close(); closers.splice(0)
        store = new AgentStore(join(initial.dir, 'agents.db')); runtime = new AgentRuntime(store, join(initial.dir, 'checkpoints.db'), async () => evidenceFromText(settings.sources[0], '反对证据：个人用户不愿意付费，团队管理员有预算。'.repeat(8)))
        const reopenedStore = store, reopenedRuntime = runtime
        closers.push(() => reopenedStore.close(), () => reopenedRuntime.close())
      }
      const runId = store.createRun('alice', '只讨论这个研究方向'); runIds.push(runId)
      expect(store.detail('alice', runId).run.topicId).toBe(topicId)
      await runtime.execute(runId, 'Alice', async prompt => {
        expect(prompt).toContain(topicId)
        if (round) { expect(prompt).toContain(conclusions[round - 1]); expect(prompt).toContain('核对反对证据') }
        return output({ ...progress, judgement: conclusions[round], reason: round ? '新的资料 [1] 要求修正原先面向个人的假设。' : progress.reason }, round === 1 ? '是否继续研究团队？' : '')
      }, new AbortController().signal)
      if (round === 1) {
        expect(store.detail('alice', runId).run.status).toBe('waiting')
        expect(store.topics.get('alice', topicId).judgement).toBe(conclusions[0])
        runtime.close(); store.close(); closers.splice(0)
        store = new AgentStore(join(initial.dir, 'agents.db')); runtime = new AgentRuntime(store, join(initial.dir, 'checkpoints.db'), reader)
        const recoveredStore = store, recoveredRuntime = runtime
        closers.push(() => recoveredStore.close(), () => recoveredRuntime.close())
        store.recover(); store.answer('alice', runId, '继续研究团队，只读验证')
        const unusedModel = vi.fn(async () => output())
        await runtime.execute(runId, 'Alice', unusedModel, new AbortController().signal)
        expect(unusedModel).not.toHaveBeenCalled()
      }
      expect(store.topics.get('alice', topicId).judgement).toBe(conclusions[round])
    }
    const history = store.topics.detail('alice', topicId)
    expect(history.changes.filter(change => change.kind === 'research')).toHaveLength(3)
    expect(history.changes[0].before?.judgement).toBe(conclusions[1])
    expect(history.changes[0].after.judgement).toBe(conclusions[2])
    expect(history.changes.filter(change => change.runId).map(change => change.runId)).toEqual([...runIds].reverse())
    expect(store.detail('alice', runIds[1]).report?.body).toContain('继续研究团队')
    expect(store.detail('alice', runIds[0]).report?.evidence[0].hash).not.toBe(store.detail('alice', runIds[1]).report?.evidence[0].hash)
    store.finish(runIds[2], store.detail('alice', runIds[2]).report!, [], progress)
    expect(store.topics.detail('alice', topicId).changes).toHaveLength(4)
    expect(store.callCount('alice')).toBe(3)
    expect(() => store.topics.detail('bob', topicId)).toThrow()
  })

  it('isolates topic history and rejects foreign edits, runs, status and focus requests', async () => {
    const { store, runtime, topic } = fixture()
    const first = store.createRun('alice', '')
    await runtime.execute(first, '', async () => output({ ...progress, judgement: 'FIRST_TOPIC_ONLY' }), new AbortController().signal)
    const created = store.createTopic('alice', { title: '第二个事项', goal: '研究客服需求', constraints: '预算 500 元' }).topics[0]
    const second = store.createRun('alice', '', Date.now(), created.id)
    const input = JSON.parse(store.getRun(second)!.input)
    expect(input.previous).toEqual([]); expect(input.topic.constraints).toBe('预算 500 元')
    await runtime.execute(second, '', async () => output({ ...progress, judgement: 'SECOND_TOPIC_ONLY' }), new AbortController().signal)
    expect(JSON.stringify(store.topics.detail('alice', topic.id))).not.toContain('SECOND_TOPIC_ONLY')
    expect(JSON.stringify(store.topics.detail('alice', created.id))).not.toContain('FIRST_TOPIC_ONLY')
    for (const operation of [() => store.focusTopic('bob', topic.id), () => store.changeTopic('bob', topic.id, 2, { status: 'paused', reason: '越权' }), () => store.createRun('bob', '', Date.now(), topic.id)]) expect(operation).toThrow()
  })

  it('cancels late writes after editing or pausing, preserves history and rejects stale revisions', async () => {
    const { store, runtime, topic } = fixture()
    const run = store.createRun('alice', '')
    await runtime.execute(run, '', async () => {
      store.changeTopic('alice', topic.id, topic.revision, { input: { title: '更新目标', goal: '只研究团队', constraints: '不超过 500 元' }, reason: '缩小范围' })
      return output()
    }, new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('cancelled')
    expect(store.overview('alice').reports).toHaveLength(0)
    expect(store.topics.get('alice', topic.id).goal).toBe('只研究团队')
    expect(() => store.changeTopic('alice', topic.id, 1, { status: 'paused', reason: '旧页面' })).toThrow('变化')
    const next = store.createRun('alice', '')
    store.changeTopic('alice', topic.id, 2, { status: 'paused', reason: '先等用户反馈' })
    expect(store.detail('alice', next).run.status).toBe('cancelled')
    expect(() => store.createRun('alice', '')).toThrow('暂停')
    expect(() => store.finish(next, { runId: next, title: '迟到', body: '', nextStep: '', evidence: [], createdAt: Date.now() }, [], progress)).toThrow()
    expect(store.topics.detail('alice', topic.id).changes.map(change => change.reason)).toContain('先等用户反馈')
    store.remove('alice')
    expect(store.db.prepare('SELECT * FROM topics WHERE character_id=?').all('alice')).toEqual([])
    expect(store.db.prepare('SELECT * FROM topic_changes WHERE topic_id=?').all(topic.id)).toEqual([])
  })

  it('rolls back progress if report persistence fails and refuses incomplete model updates', async () => {
    const { store, runtime, topic } = fixture()
    store.db.exec("CREATE TRIGGER reject_report BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT, 'disk fixture'); END")
    const run = store.createRun('alice', '')
    await runtime.execute(run, '', async () => output(), new AbortController().signal)
    expect(store.detail('alice', run).run.status).toBe('failed')
    expect(store.topics.get('alice', topic.id).revision).toBe(1)
    expect(store.topics.detail('alice', topic.id).changes).toHaveLength(1)
    store.db.exec('DROP TRIGGER reject_report')
    const invalid = store.createRun('alice', '')
    const missing = JSON.parse(output()); delete missing.progress
    await runtime.execute(invalid, '', async () => JSON.stringify(missing), new AbortController().signal)
    expect(store.detail('alice', invalid).run.status).toBe('failed')
    expect(store.overview('alice').reports).toEqual([])
    expect(() => validateTopicProgress({ ...progress, status: 'verified' })).toThrow()
    expect(() => validateTopicProgress({ ...progress, reason: '' })).toThrow()
  })

  it('stops scheduling an ended topic and resumes only an explicitly selected eligible topic', async () => {
    const model = vi.fn(async () => output({ ...progress, status: 'abandoned', reason: '资料 [1] 不支持这一方向，停止投入。', nextStep: '' }))
    const service = new AgentService(directory(), () => {}, () => model, reader); closers.push(() => service.close())
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('save', 'alice', [{ ...settings, enabled: true }])
    await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(1))
    const original = service.store.overview('alice').topics[0]
    await service.request('createTopic', 'alice', [{ title: '下一事项', goal: '核对其他需求', constraints: '' }])
    service.store.db.prepare('UPDATE profiles SET next_at=0').run(); service.tick()
    expect(model).toHaveBeenCalledTimes(1)
    const next = service.store.overview('alice').topics.find(topic => topic.id !== original.id)!
    await service.request('focusTopic', 'alice', [next.id])
    await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(2))
    expect(model).toHaveBeenCalledTimes(2)
    expect(service.store.topics.detail('alice', original.id).changes[0].after.status).toBe('abandoned')
  })

  it('paginates the complete change history without duplicates', () => {
    const { store, topic } = fixture()
    for (let revision = 1; revision <= 35; revision++) store.changeTopic('alice', topic.id, revision, { status: revision % 2 ? 'paused' : 'planned', reason: `用户调整 ${revision}` })
    const first = store.topics.detail('alice', topic.id), second = store.topics.detail('alice', topic.id, first.nextCursor!)
    expect(first.changes).toHaveLength(30); expect(second.changes).toHaveLength(6)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.changes, ...second.changes].map(change => change.id)).size).toBe(36)
  })

  it('resumes an upgrade-era checkpoint with no topic progress without inventing a topic link', async () => {
    const { store, runtime, dir, topic } = fixture(), runId = store.createRun('alice', '')
    const input = JSON.parse(store.getRun(runId)!.input)
    delete input.topic
    store.db.prepare('UPDATE runs SET topic_id=NULL,topic_revision=NULL,input=? WHERE id=?').run(JSON.stringify(input), runId)
    const legacy = JSON.parse(output(progress, '旧版本遗留的问题'))
    delete legacy.progress
    await runtime.execute(runId, '', async () => JSON.stringify(legacy), new AbortController().signal)
    expect(store.detail('alice', runId).run.status).toBe('waiting')
    runtime.close(); store.close(); closers.splice(0)
    const reopened = new AgentStore(join(dir, 'agents.db')), recovered = new AgentRuntime(reopened, join(dir, 'checkpoints.db'), reader)
    closers.push(() => reopened.close(), () => recovered.close())
    reopened.recover(); reopened.answer('alice', runId, '旧问题的补充回复')
    const model = vi.fn(async () => output())
    await recovered.execute(runId, '', model, new AbortController().signal)
    expect(model).not.toHaveBeenCalled()
    expect(reopened.detail('alice', runId).run.topicId).toBeNull()
    expect(reopened.detail('alice', runId).report?.body).toContain('旧问题的补充回复')
    expect(reopened.topics.get('alice', topic.id).revision).toBe(1)
  })

  it('migrates v1 without assigning old reports to invented topics, and rejects future versions', () => {
    const dir = directory(), path = join(dir, 'old.db'), old = new Database(path)
    old.exec(`CREATE TABLE profiles(character_id TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL, next_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE runs(id TEXT PRIMARY KEY,character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,revision INTEGER NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,question TEXT NOT NULL DEFAULT '',answer TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',input TEXT NOT NULL);
      CREATE TABLE reports(run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,value TEXT NOT NULL); PRAGMA user_version=1;`)
    old.prepare('INSERT INTO profiles VALUES(?,?,1,0,0)').run('alice', JSON.stringify(settings))
    old.prepare("INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input) VALUES('old','alice',1,'completed',1,1,'{}')").run()
    const report = { runId: 'old', title: '升级前报告', body: '旧判断', nextStep: '旧的下一步', evidence: [], createdAt: 1 }
    old.prepare('INSERT INTO reports VALUES(?,?,?)').run('old', 'alice', JSON.stringify(report)); old.close()
    const migrated = new AgentStore(path)
    expect(migrated.overview('alice').reports).toEqual([report])
    expect(migrated.detail('alice', 'old').run.topicId).toBeNull()
    const topic = migrated.overview('alice').topics[0]
    expect(topic.goal).toBe(settings.goal); expect(topic.judgement).toBe('')
    expect(migrated.profile('alice')!.focus_topic_id).toBe(topic.id)
    migrated.close()
    const reopened = new AgentStore(path)
    expect(reopened.overview('alice').topics).toHaveLength(1)
    expect(reopened.db.pragma('foreign_key_check')).toEqual([])
    reopened.db.pragma('user_version=99'); reopened.close()
    expect(() => new AgentStore(path)).toThrow('版本较新')
  })
})
