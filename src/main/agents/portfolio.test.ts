import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { deliveryText, textHash } from '../../shared/contact-content'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(f => f()))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-portfolio-')), file = join(dir, 'agents.db')
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  let store = new ContactTaskStore(file)
  cleanup.push(() => store.close())
  for (const owner of ['alice', 'bob']) store.save(owner, { ...DEFAULT_AGENT_SETTINGS, goal: '创作作品', dailyCalls: 200 })
  function topic(owner = 'alice', title = '作品') { return store.topics.create(owner, { title, goal: '写作', constraints: '' }, '用户要求') }
  function write(id: string, body = '第一段。\n\n第二段😀。', owner = 'alice', at = 1000, styleOnly = false) {
    const runId = store.createRun(owner, '', Date.now(), id)
    const update = { completionCriteria: '完成正文', stages: [{ id: 's', title: '创作', status: 'active' as const }], summary: '正文已保存',
      ...(styleOnly ? { presentation: { title: '阅读', html: '<main></main>', css: '', script: '' } } : { section: { id: 's', title: '正文', body } }) }
    store.finish(runId, { runId, title: '交付', body, nextStep: '继续', evidence: [], createdAt: at }, [],
      { status: 'researching', judgement: '推进中', openQuestions: '', nextStep: '继续', reason: '已交付' }, update)
    return { characterId: owner, topicId: id, version: store.deliveries.get(id)!.version, sectionId: 's' }
  }
  return { get store() { return store }, file, topic, write, reopen() { store.close(); store = new ContactTaskStore(file) } }
}

describe('formal portfolio and reading', () => {
  it('preserves Unicode and cross-section search while migrating old indexes without changing sequence', () => {
    const f = fixture(), topic = f.topic('alice', 'École')
    f.write(topic.id, 'ÄBC\n末尾')
    const sql = new Database(f.file)
    try {
      // The old index stored normalized prose twice per version.
      const sections = [{ id: 's', title: '正文', text: 'ÄBC\n末尾', textHash: textHash('ÄBC\n末尾') }]
      sql.prepare('UPDATE portfolio_versions SET search_text=?,sections=? WHERE topic_id=?').run('école\n正文\näbc\n末尾', JSON.stringify(sections), topic.id)
    } finally { sql.close() }
    const before = f.store.db.prepare('SELECT seq FROM portfolio_versions WHERE topic_id=?').get(topic.id)
    f.reopen()
    expect(f.store.portfolio.list('alice', { query: '正文\näbc' }).items[0]?.ref.topicId).toBe(topic.id)
    expect(f.store.portfolio.list('alice', { query: 'ÉCOLE\n正文' }).items[0]?.ref.topicId).toBe(topic.id)
    const row = f.store.db.prepare('SELECT seq,search_text,sections FROM portfolio_versions WHERE topic_id=?').get(topic.id) as { seq: number; search_text: string; sections: string }
    expect({ seq: row.seq }).toEqual(before)
    expect(JSON.parse(row.sections)[0].text).toBeUndefined()
    expect(row.search_text).not.toContain('末尾')
  })
  it.each(['updated', 'name'] as const)('pages a stable 31-work snapshot sorted by %s across inserts and updates', sort => {
    const f = fixture(), ids: string[] = []
    for (let n = 0; n < 31; n++) { const t = f.topic(); ids.push(t.id); f.write(t.id, `原稿${n}`) }
    const first = f.store.portfolio.list('alice', { sort })
    expect(first.items).toHaveLength(30)
    const last = ids.find(id => !first.items.some(item => item.ref.topicId === id))!
    f.write(f.topic().id, '新增', 'alice', 2000)
    f.write(last, '更新', 'alice', 3000)
    const second = f.store.portfolio.list('alice', { sort, cursor: first.nextCursor! })
    expect(second.items.map(item => [item.ref.topicId, item.ref.version])).toEqual([[last, 1]])
    expect(second.nextCursor).toBeNull()
    expect(() => f.store.portfolio.list('bob', { sort, cursor: first.nextCursor! })).toThrow()
    expect(() => f.store.portfolio.list('alice', { sort, query: 'changed', cursor: first.nextCursor! })).toThrow()
  })
  it('searches only the latest formal body and resolves exact owner/version/section', () => {
    const f = fixture(), topic = f.topic(), old = f.write(topic.id, '旧词'), current = f.write(topic.id, '新词')
    expect(f.store.portfolio.list('alice', { query: '旧词' }).items).toEqual([])
    expect(f.store.portfolio.list('alice', { query: '新词' }).items[0].ref).toEqual(current)
    expect(f.store.portfolio.resolve('alice', old).section?.body).toBe('旧词')
    for (const ref of [{ ...old, version: 99 }, { ...old, version: 0 }, { ...old, sectionId: 'missing' }, { ...old, characterId: 'bob' }]) {
      expect(() => f.store.portfolio.resolve('alice', ref)).toThrow()
    }
    expect(() => f.store.portfolio.resolve('bob', old)).toThrow()
    expect(() => f.store.portfolio.favorite('bob', topic.id, true)).toThrow()
    expect(f.store.portfolio.list('bob', {}).items).toEqual([])
  })
  it('persists favorites, exact anchors and only actually-read sections across reopen and style changes', () => {
    const f = fixture(), topic = f.topic(), ref = f.write(topic.id), body = deliveryText(f.store.deliveries.get(topic.id)!.sections[0].body)
    const position = { ref, anchor: { start: 6, end: body.length, quote: body.slice(6), textHash: textHash(body) }, scrollRatio: 0.7, updatedAt: 1234 }
    f.store.portfolio.favorite('alice', topic.id, true)
    f.store.portfolio.saveReading('alice', position)
    f.reopen()
    expect(f.store.portfolio.reading('alice', topic.id)).toEqual(position)
    f.write(topic.id, '', 'alice', 2000, true)
    const item = f.store.portfolio.list('alice', { favoritesOnly: true }).items[0]
    expect(item.ref.version).toBe(2)
    expect(item.sections[0].readHash).toBe(item.sections[0].textHash)
    expect(f.store.portfolio.reading('alice', topic.id)?.ref.version).toBe(1)
    expect(() => f.store.portfolio.saveReading('alice', { ...position, scrollRatio: 2 })).toThrow()
    expect(() => f.store.portfolio.saveReading('alice', { ...position, anchor: { ...position.anchor, quote: '伪造' } })).toThrow()
    expect(f.store.portfolio.reading('alice', topic.id)).toEqual(position)
    f.store.portfolio.favorite('alice', topic.id, false)
    expect(f.store.portfolio.list('alice', { favoritesOnly: true }).items).toEqual([])
  })
  it('rolls back index and delivery together and cascades deletion for this task only', () => {
    const f = fixture(), a = f.topic(), b = f.topic(); f.write(a.id); f.write(b.id)
    f.store.db.exec("CREATE TRIGGER fail_index BEFORE INSERT ON portfolio_versions BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    expect(() => f.write(a.id, '不能保存')).toThrow('disk failure')
    expect(f.store.deliveries.get(a.id)!.version).toBe(1)
    expect(f.store.portfolio.list('alice', {}).items).toHaveLength(2)
    f.store.db.exec('DROP TRIGGER fail_index')
    f.store.db.prepare('DELETE FROM topics WHERE id=?').run(a.id)
    expect(f.store.portfolio.list('alice', {}).items.map(x => x.ref.topicId)).toEqual([b.id])
  })
  it('backfills real old versions without invented reading and refuses future schemas', () => {
    const f = fixture(), topic = f.topic(); f.write(topic.id)
    f.store.db.exec('DROP TABLE portfolio_read_sections; DROP TABLE portfolio_reading; DROP TABLE portfolio_favorites; DROP TABLE portfolio_versions; PRAGMA user_version=8')
    f.reopen()
    expect(f.store.db.pragma('user_version', { simple: true })).toBe(20)
    expect(f.store.portfolio.list('alice', {}).items).toHaveLength(1)
    expect(f.store.portfolio.reading('alice', topic.id)).toBeNull()
    expect(f.store.portfolio.list('alice', {}).items[0].sections[0].readHash).toBeNull()
    const future = join(tmpdir(), `chouyu-future-${Date.now()}.db`), db = new Database(future)
    db.pragma('user_version=999'); db.close()
    cleanup.push(() => rmSync(future, { force: true }))
    expect(() => new ContactTaskStore(future)).toThrow('版本较新')
  })
  it('rejects malformed query cursors and invalid query fields', () => {
    const f = fixture()
    for (const cursor of ['{', 'e30=', 'null', 'x'.repeat(5000)]) expect(() => f.store.portfolio.list('alice', { cursor })).toThrow()
    expect(() => f.store.portfolio.list('alice', { query: 'x'.repeat(1001) })).toThrow()
    expect(() => f.store.portfolio.list('alice', { sort: 'bad' as 'name' })).toThrow()
  })
  it('projects Markdown with the renderer parser, preserving visible text and UTF16 offsets', () => {
    expect(deliveryText('# 标题\r\n\r\n**重复😀** 与 [链接](https://example.com)\n\n`a_b`\n\n```ts\nx < 2\n```')).toBe('标题\n\n重复😀 与 链接\n\na_b\n\nx < 2')
    expect(deliveryText('&#x1f600; &amp; **文字**')).toBe('😀 & 文字')
    expect(textHash('正文')).toBe(textHash('正文'))
    expect(textHash('正文')).not.toBe(textHash('正文改'))
  })
})
