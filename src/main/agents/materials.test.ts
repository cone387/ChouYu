import { afterEach, expect, it } from 'vitest'
import { AgentStore } from './store'
import type { MaterialInput } from '../../shared/contact-materials'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
const stores: AgentStore[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture() { const store = new AgentStore(':memory:'); stores.push(store); store.ensure('alice'); store.ensure('bob'); return store }
const input = (content: string): MaterialInput => ({ name: '项目.md', content, scope: { kind: 'contact' }, source: { kind: 'text', label: '手动输入' } })
it('preserves immutable versions, duplicate identity and transaction failures', () => {
  const store = fixture(), lib = store.materials
  const first = lib.save('alice', input('原文')), second = lib.save('alice', input('不同正文'))
  expect(first.id).not.toBe(second.id)
  expect(lib.save('alice', input('原文'), first.id, 1).version).toBe(1)
  const next = lib.save('alice', input('更新'), first.id, 1)
  expect(next.version).toBe(2)
  expect(lib.read({ characterId: 'alice', query: '' }, first).text).toBe('原文')
  expect(() => lib.save('alice', input('过期'), first.id, 1)).toThrow()
  store.db.exec("CREATE TRIGGER fail_material BEFORE INSERT ON contact_material_versions BEGIN SELECT RAISE(ABORT,'disk failure'); END")
  expect(() => lib.save('alice', input('失败'), first.id, 2)).toThrow('disk failure')
  expect(lib.history('alice', first.id)).toHaveLength(2)
  expect(lib.read({ characterId: 'alice', query: '' }, next).text).toBe('更新')
})
it('enforces ownership, task scopes, offsets and withdrawal across every version', () => {
  const store = fixture(), lib = store.materials
  const topic = store.topics.create('alice', { title: 'A', goal: 'A', constraints: '' }, 'user')
  const body = '正文😀'.repeat(7000), m = lib.save('alice', { ...input(body), scope: { kind: 'task', topicId: topic.id } })
  const context = { characterId: 'alice', topicId: topic.id, query: '' }
  expect(lib.list({ characterId: 'alice', query: '' })).toEqual([])
  expect(() => lib.read({ characterId: 'bob', topicId: topic.id, query: '' }, m)).toThrow()
  expect(() => lib.read({ characterId: 'alice', query: '' }, m)).toThrow()
  let text = '', offset = 0
  do { const chunk = lib.read(context, m, offset); expect(chunk.text.length).toBeLessThanOrEqual(12000); text += chunk.text; offset = chunk.nextOffset ?? -1 } while (offset >= 0)
  expect(text).toBe(body)
  for (const offset of [-1, 0.5, NaN, body.length + 1]) expect(() => lib.read(context, m, offset)).toThrow()
  lib.save('alice', { ...input('新版本'), scope: m.scope }, m.id, 1)
  lib.withdraw('alice', m.id, 2)
  expect(() => lib.read(context, m)).toThrow()
  expect(lib.list(context)).toEqual([])
})
it('enforces UTF8 file size, document count and total retained version capacity', () => {
  const store = fixture(), lib = store.materials
  expect(() => lib.save('alice', input('中'.repeat(699051)))).toThrow('2 MB')
  const first = lib.save('alice', input('x'.repeat(2 * 1024 * 1024)))
  for (let n = 1; n < 100; n++) lib.save('alice', input(`doc ${n}`))
  expect(() => lib.save('alice', input('101'))).toThrow('100')
  lib.withdraw('alice', first.id, 1)
  expect(lib.save('alice', input('replacement')).version).toBe(1)
  store.db.prepare('UPDATE contact_material_versions SET bytes=? WHERE id=?').run(200 * 1024 * 1024, first.id)
  expect(() => lib.save('alice', input('new version'), lib.list({ characterId: 'alice', query: '' })[0].id, 1)).toThrow('200 MB')
  expect(() => lib.save('alice', input('nul\0text'))).toThrow()
})
it('restores exact old snapshots on restart and invalidates them only on withdrawal', () => {
  const path = join(tmpdir(), `contact-material-${Date.now()}.db`)
  let store = new AgentStore(path)
  try {
    store.ensure('alice')
    const first = store.materials.save('alice', input('version one'))
    store.materials.save('alice', input('version two'), first.id, 1)
    store.close(); store = new AgentStore(path)
    expect(store.db.pragma('user_version', { simple: true })).toBe(13)
    expect(store.materials.read({ characterId: 'alice', query: '' }, first).text).toBe('version one')
    expect(() => store.assertContextCurrent('alice', { memories: [], materials: [first] })).not.toThrow()
    store.materials.withdraw('alice', first.id, 2)
    expect(() => store.assertContextCurrent('alice', { memories: [], materials: [first] })).toThrow()
  } finally { store.close(); for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }) }
})
it('saves only actual read passages as outcome evidence and cancels only affected work', () => {
  const store = fixture(), topic = store.topics.create('alice', { title: 'A', goal: 'A', constraints: '' }, 'user')
  const material = store.materials.save('alice', input('ABCDEFGHIJ'))
  const run = store.createRun('alice', '', Date.now(), topic.id)
  store.recordMaterialRead(run, { ...material, start: 2, end: 7 })
  store.materials.save('alice', input('new body'), material.id, 1)
  store.finish(run, { runId: run, title: 'Result', body: 'Outcome', nextStep: '', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Read', nextStep: 'Continue', openQuestions: '', reason: 'Saved evidence' }, { completionCriteria: 'Finish', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Read evidence', section: { id: 'first', title: 'First', body: 'Outcome' } })
  expect(store.detail('alice', run).report?.evidence[0]).toMatchObject({ text: 'CDEFG', hash: material.hash })
  const next = store.createRun('alice', '', Date.now(), topic.id)
  store.recordMaterialRead(next, { id: material.id, version: 2, start: 0, end: 8 })
  store.materials.withdraw('alice', material.id, 2)
  expect(store.invalidateMaterial('alice', material.id)).toEqual([next])
  expect(store.getRun(run)?.status).toBe('completed')
  expect(store.detail('alice', run).report?.body).toBe('Outcome')
  expect(() => store.assertLive(next)).toThrow()
})
