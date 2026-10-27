import { afterEach, expect, it } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import type { DeliveryUpdate } from '../../shared/agent-delivery'

const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture() {
  const store = new ContactTaskStore(':memory:'); stores.push(store)
  for (const owner of ['alice', 'bob']) store.ensure(owner)
  const topic = (owner: string) => store.topics.create(owner, { title: 'Book', goal: 'Write', constraints: '' })
  const write = (owner: string, id: string, style = false) => {
    const runId = store.createRun(owner, '', Date.now(), id)
    const update: DeliveryUpdate = { completionCriteria: 'Finish', stages: [{ id: 'write', title: 'Write', status: 'active' }], summary: 'Saved',
      ...(style ? { presentation: { title: 'Reading', html: '<main/>', css: 'p{color:red}', script: '' } } : { section: { id: 'one', title: 'First', body: 'Shared immutable prose 😀' } }) }
    store.finish(runId, { runId, title: 'Saved', body: 'Saved', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: 'Saved', reason: 'Continue', openQuestions: '', nextStep: 'Continue' }, update)
  }
  return { store, topic, write }
}
it('marks the incompatible body format newer than the old application accepts', () => {
  const f = fixture()
  expect(f.store.db.pragma('user_version', { simple: true })).toBe(21)
})
it('shares immutable prose across versions and owners without sharing access, and collects only unreferenced blocks', () => {
  const f = fixture(), a = f.topic('alice'), b = f.topic('bob')
  f.write('alice', a.id); f.write('bob', b.id); f.write('alice', a.id, true)
  expect(f.store.db.prepare('SELECT body FROM delivery_blocks').all()).toEqual([{ body: 'Shared immutable prose 😀' }])
  const rows = f.store.db.prepare('SELECT value FROM delivery_versions').all() as { value: string }[]
  expect(rows.every(r => !r.value.includes('Shared immutable prose'))).toBe(true)
  expect(f.store.deliveries.get(a.id, 1)?.sections).toEqual(f.store.deliveries.get(a.id, 2)?.sections)
  expect(() => f.store.portfolio.resolve('alice', { characterId: 'bob', topicId: b.id, version: 1 })).toThrow()
  expect(f.store.db.prepare('SELECT text FROM portfolio_texts').all()).toHaveLength(1)
  f.store.deleteTopic('alice', a.id, f.store.topics.get('alice', a.id).revision)
  expect(f.store.deliveries.get(b.id, 1)?.sections[0].body).toBe('Shared immutable prose 😀')
  expect(f.store.db.prepare('SELECT * FROM delivery_blocks').all()).toHaveLength(1)
  f.store.remove('bob')
  expect(f.store.db.prepare('SELECT * FROM delivery_blocks').all()).toEqual([])
  expect(f.store.db.prepare('SELECT * FROM portfolio_texts').all()).toEqual([])
})
it('fails visibly on a missing or changed body instead of returning blank or altered prose', () => {
  const f = fixture(), a = f.topic('alice'); f.write('alice', a.id)
  const block = f.store.db.prepare('SELECT * FROM delivery_blocks').get() as { hash: string; body: string }
  f.store.db.prepare('UPDATE delivery_blocks SET body=? WHERE hash=?').run('corrupted', block.hash)
  expect(() => f.store.deliveries.get(a.id, 1)).toThrow(/正文.*损坏/)
  f.store.db.pragma('foreign_keys = OFF'); f.store.db.exec('DELETE FROM delivery_blocks')
  expect(() => f.store.portfolio.resolve('alice', { characterId: 'alice', topicId: a.id, version: 1 })).toThrow(/正文.*缺失/)
})
