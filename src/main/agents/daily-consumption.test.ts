import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.useRealTimers() })
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 27, 12))
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-daily-consumption-')), path = join(dir, 'agents.db')
  let store = new ContactTaskStore(path)
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Research', dailyCalls: 12, searchEnabled: true, dailySearches: 2 })
  const topic = store.overview('alice').topics[0], run = store.createRun('alice', '', Date.now(), topic.id)
  return { get store() { return store }, path, topic, run,
    restart(beforeOpen?: (db: Database.Database) => void) {
      store.close()
      if (beforeOpen) { const db = new Database(path); try { beforeOpen(db) } finally { db.close() } }
      store = new ContactTaskStore(path)
    },
    deleteTask() { store.deleteTopic('alice', topic.id, store.topics.get('alice', topic.id).revision) }
  }
}

it('keeps daily model and search consumption after task deletion and restart, but resets at the next local day', () => {
  const f = fixture()
  f.store.charge(f.run); f.store.chargeSearch(f.run)
  f.deleteTask(); f.restart()
  expect(f.store.callCount('alice')).toBe(1)
  expect(f.store.searchCount('alice')).toBe(1)
  expect(f.store.getRun(f.run)).toBeUndefined()
  expect(f.store.callCount('bob')).toBe(0)
  vi.setSystemTime(new Date(2026, 9, 28, 0))
  expect(f.store.callCount('alice')).toBe(0)
  expect(f.store.searchCount('alice')).toBe(0)
})

it('still rejects new model and search requests when deleted history consumed the daily limit', () => {
  const f = fixture()
  const other = f.store.createTopic('alice', { title: 'Other', goal: 'Other', constraints: '' }).topics.find(t => t.id !== f.topic.id)!
  const next = f.store.createRun('alice', '', Date.now(), other.id)
  for (let i = 0; i < 12; i++) f.store.charge(f.run)
  f.store.chargeSearch(f.run); f.store.chargeSearch(f.run)
  f.deleteTask(); f.restart()
  expect(() => f.store.charge(next)).toThrow('今日模型调用已达上限')
  expect(() => f.store.chargeSearch(next)).toThrow('今日搜索已达上限')
})

it('migrates retained version-20 history exactly once and keeps metadata and deleted consumption', () => {
  const f = fixture()
  f.store.charge(f.run); f.store.charge(f.run); f.store.chargeSearch(f.run)
  f.store.recordCallMetadata(f.store.latestCallId(f.run)!, { usage: { totalTokens: 42 } })
  f.restart(db => db.exec('DROP TABLE IF EXISTS daily_consumption; PRAGMA user_version=20'))
  expect(f.store.callCount('alice')).toBe(2)
  expect(f.store.searchCount('alice')).toBe(1)
  expect(JSON.parse((f.store.db.prepare('SELECT metadata FROM calls WHERE id=?').get(f.store.latestCallId(f.run)) as { metadata: string }).metadata).usage.totalTokens).toBe(42)
  f.restart()
  expect(f.store.callCount('alice')).toBe(2)
  f.deleteTask(); f.restart()
  expect(f.store.callCount('alice')).toBe(2)
  expect(f.store.searchCount('alice')).toBe(1)
})

it('uses retained deleted consumption as the baseline for explicitly granted restore allowances', () => {
  const f = fixture()
  f.store.charge(f.run); f.deleteTask()
  f.store.recovery.sync('alice', { restoreId: 'restore', scopeReviewed: true, allowedTopics: [],
    additional: { day: '2026-10-27', daily: { calls: 3, tokens: 0 }, tasks: {} } })
  expect(f.store.recovery.limits('alice')?.dailyCalls).toBe(4)
})

it('releases only a matching unstarted model reservation without refunding another run', () => {
  const f = fixture()
  f.store.charge(f.run)
  const call = f.store.latestCallId(f.run)!
  f.store.callBudget.cancelUnstartedCall('wrong-run', call)
  expect(f.store.callCount('alice')).toBe(1)
  f.store.callBudget.cancelUnstartedCall(f.run, call)
  expect(f.store.callCount('alice')).toBe(0)
  expect(f.store.latestCallId(f.run)).toBeUndefined()
  f.restart()
  expect(f.store.callCount('alice')).toBe(0)
})

it('removes consumption with an explicitly deleted contact, matching existing token-ledger ownership', () => {
  const f = fixture()
  f.store.charge(f.run); f.store.chargeSearch(f.run)
  f.store.remove('alice'); f.restart()
  expect(f.store.callCount('alice')).toBe(0)
  expect(f.store.searchCount('alice')).toBe(0)
})

it('rolls back both the execution record and the consumption entry if either write fails', () => {
  const f = fixture()
  f.store.db.exec("CREATE TRIGGER reject_consumption BEFORE INSERT ON daily_consumption BEGIN SELECT RAISE(ABORT,'ledger unavailable'); END")
  expect(() => f.store.charge(f.run)).toThrow('ledger unavailable')
  expect(() => f.store.chargeSearch(f.run)).toThrow('ledger unavailable')
  expect(f.store.callCount('alice')).toBe(0)
  expect(f.store.searchCount('alice')).toBe(0)
  expect(f.store.latestCallId(f.run)).toBeUndefined()
  expect(f.store.db.prepare('SELECT count(*) AS n FROM search_calls').get()).toEqual({ n: 0 })
  f.store.db.exec('DROP TRIGGER reject_consumption')
  f.store.charge(f.run); f.store.chargeSearch(f.run)
  expect(f.store.callCount('alice')).toBe(1)
  expect(f.store.searchCount('alice')).toBe(1)
})

it('cannot refund a request once token reservation or provider metadata exists', () => {
  const f = fixture()
  f.store.charge(f.run)
  const first = f.store.latestCallId(f.run)!
  const reservation = f.store.tokens.reserve(f.run, first, 'alice', f.topic.id, 'prompt', 512)
  expect(reservation.error).toBeUndefined()
  expect(() => f.store.callBudget.cancelUnstartedCall(f.run, first)).toThrow('已预留 Token')
  f.store.charge(f.run)
  const second = f.store.latestCallId(f.run)!
  f.store.recordCallMetadata(second, { usage: { totalTokens: 42 } })
  f.store.callBudget.cancelUnstartedCall(f.run, second)
  expect(f.store.callCount('alice')).toBe(2)
})

it('does not infer missing legacy consumption from unrelated token estimates', () => {
  const f = fixture()
  f.store.charge(f.run)
  f.store.tokens.reserve(f.run, f.store.latestCallId(f.run)!, 'alice', f.topic.id, 'prompt', 512)
  f.deleteTask()
  f.restart(db => db.exec('DROP TABLE daily_consumption; PRAGMA user_version=20'))
  expect(f.store.callCount('alice')).toBe(0)
  expect(f.store.tokens.usage('alice').today).toBeGreaterThan(0)
})

it('rolls back a failed legacy import and retries without partial or doubled consumption', () => {
  const f = fixture()
  f.store.charge(f.run); f.store.chargeSearch(f.run)
  expect(() => f.restart(db => db.exec(`DELETE FROM daily_consumption; PRAGMA user_version=20;
    CREATE TRIGGER reject_search_migration BEFORE INSERT ON daily_consumption WHEN NEW.kind='search'
    BEGIN SELECT RAISE(ABORT,'migration unavailable'); END`))).toThrow('migration unavailable')
  const raw = new Database(f.path)
  try {
    expect(raw.pragma('user_version', { simple: true })).toBe(20)
    expect(raw.prepare('SELECT count(*) AS n FROM daily_consumption').get()).toEqual({ n: 0 })
  } finally { raw.close() }
  f.restart(db => db.exec('DROP TRIGGER reject_search_migration'))
  expect(f.store.callCount('alice')).toBe(1)
  expect(f.store.searchCount('alice')).toBe(1)
})
