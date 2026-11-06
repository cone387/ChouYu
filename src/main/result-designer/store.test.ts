import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResultDesignStore } from './store'
import { codeHash, sourceSnapshot, type DesignEvidence, type ResultDesignCode } from '../../shared/result-design'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'result-design-')), path = join(dir, 'design.sqlite')
  let db = new Database(path), store = new ResultDesignStore(db)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => db.close())
  return { get db() { return db }, get store() { return store }, reopen() { db.close(); db = new Database(path); store = new ResultDesignStore(db); store.recover() } }
}
const task = { domain: 'contact' as const, ownerId: 'author', taskId: 'novel' }
const snapshot = (version = 1, body = '真实的第一章正文。') => sourceSnapshot(task, String(version), '小说', [{ id: 'one', title: '第一章', body, sources: [] }], [])
const code: ResultDesignCode = { title: '书页', html: '<div id="content"></div>', css: '.body{line-height:1.8}', script: '' }
const evidence = (hash = codeHash(code)): DesignEvidence => ({
  codeHash: hash, environmentVersion: 'v1', sourceHash: snapshot().ref.contentHash,
  observations: [375, 1024].flatMap(width => (['light', 'dark'] as const).map(theme => ({ width, height: width === 375 ? 700 : 768, theme,
    screenshotId: `${width}-${theme}`, contentComplete: true, interactionsPassed: true, errors: [] }))),
  visualReview: { requestId: 'visual-call', response: '四张页面截图的正文与目录可读。', accepted: true }, checkedAt: 100
})

it('accepts formal sources idempotently inside the caller transaction', () => {
  const f = fixture()
  expect(() => f.db.transaction(() => { f.store.accept(snapshot(), 'v1'); throw new Error('rollback') })()).toThrow('rollback')
  expect(f.store.pending()).toEqual([])
  const a = f.store.accept(snapshot(), 'v1')
  expect(f.store.accept(snapshot(), 'v1')).toEqual(a)
  expect(f.store.pending()).toHaveLength(1)
})

it('keeps source versions separate from design versions and persists fixed bindings', () => {
  const f = fixture(), receipt = f.store.accept(snapshot(), 'v1'), job = f.store.claim(receipt.requestId, 'run-1')
  const draft = f.store.saveCandidate(job.id, code)
  f.store.publish(job.id, draft.id, evidence())
  f.reopen()
  expect(f.store.view(snapshot().ref).active).toMatchObject({ id: draft.id, version: 1, source: snapshot().ref })
  expect(f.store.pending()).toEqual([])
  expect(f.store.readSource(snapshot().ref).sections[0].body).toBe('真实的第一章正文。')
})

it('rejects stale publication after an explicit request and preserves the newer requirement', () => {
  const f = fixture(), receipt = f.store.accept(snapshot(), 'v1'), job = f.store.claim(receipt.requestId, 'run')
  const draft = f.store.saveCandidate(job.id, code)
  const revised = f.store.request(task, '目录放左侧', 'user-message-1')
  expect(() => f.store.publish(job.id, draft.id, evidence())).toThrow(/变化|过期/)
  expect(f.store.view(snapshot().ref).active).toBeUndefined()
  f.store.fail(job.id, 'cancelled', 'old attempt')
  expect(f.store.pending()[0]).toMatchObject({ requestId: revised.requestId, requestRevision: 2, text: '目录放左侧' })
  expect(f.store.request(task, '目录放左侧', 'user-message-1')).toEqual(revised)
  expect(() => f.store.request(task, '删掉目录', 'user-message-1')).toThrow(/请求/)
})

it('coalesces pending source changes without replacing the active attempt', () => {
  const f = fixture(), first = f.store.accept(snapshot(), 'v1'), job = f.store.claim(first.requestId, 'run')
  f.store.accept(snapshot(2, '第二版正文'), 'v1')
  f.store.accept(snapshot(3, '第三版正文'), 'v1')
  expect(f.store.pending()).toHaveLength(0)
  expect(f.store.job(job.id).source.sourceId).toBe('1')
  f.store.fail(job.id, 'cancelled', 'superseded')
  expect(f.store.pending()).toHaveLength(1)
  expect(f.store.pending()[0].source.sourceId).toBe('3')
})

it('requires evidence matching code, environment, source and all viewport/theme combinations', () => {
  const f = fixture(), receipt = f.store.accept(snapshot(), 'v1'), job = f.store.claim(receipt.requestId, 'run')
  const draft = f.store.saveCandidate(job.id, code)
  for (const bad of [ { ...evidence(), codeHash: 'wrong' }, { ...evidence(), sourceHash: 'wrong' },
    { ...evidence(), observations: evidence().observations.slice(1) },
    { ...evidence(), visualReview: undefined },
    { ...evidence(), observations: evidence().observations.map(o => ({ ...o, contentComplete: false })) } ]) {
    expect(() => f.store.publish(job.id, draft.id, bad as DesignEvidence)).toThrow(/检查|证据/)
  }
  expect(f.store.view(snapshot().ref).active).toBeUndefined()
})

it('preserves explicit requirements when new content arrives and does not retry failed polling', () => {
  const f = fixture(); f.store.accept(snapshot(), 'v1')
  const request = f.store.request(task, '保留左侧目录', 'message')
  const job = f.store.claim(request.requestId, 'run')
  f.store.fail(job.id, 'failed', '视觉检查失败')
  f.store.accept(snapshot(), 'v1')
  expect(f.store.pending()).toHaveLength(0)
  f.store.accept(snapshot(2, '新正文'), 'v1')
  expect(f.store.pending()[0].text).toBe('保留左侧目录')
})

it('recovers interrupted attempts, retains completed versions and invalidates deleted sources', () => {
  const f = fixture(), receipt = f.store.accept(snapshot(), 'v1')
  f.store.claim(receipt.requestId, 'run')
  f.reopen()
  expect(f.store.pending()).toHaveLength(1)
  f.store.invalidate(task)
  expect(f.store.pending()).toEqual([])
  expect(() => f.store.readSource(snapshot().ref)).toThrow(/来源/)
  expect(f.store.view(snapshot().ref).active).toBeUndefined()
})

it('never exposes an author legacy presentation as designer input', () => {
  const f = fixture(), input = { ...snapshot(), presentation: { script: 'legacy-secret' } }
  f.store.accept(input, 'v1')
  expect(JSON.stringify(f.store.readSource(input.ref))).not.toContain('legacy-secret')
})
