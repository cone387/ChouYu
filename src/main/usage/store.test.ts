import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageStore } from './store'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture(now = new Date(2026, 9, 30, 12).getTime()) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-usage-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new UsageStore(dir, now)
  cleanups.push(() => store.close())
  return { dir, store, now }
}

it('counts actual requests once and replaces cumulative counters without treating unknown as zero', () => {
  const { store, now } = fixture()
  store.begin('a', 'requested', now)
  store.begin('a', 'requested', now)
  store.update('a', { model: 'actual', usage: { totalTokens: 10 } })
  store.update('a', { model: 'actual', usage: { totalTokens: 15 } })
  store.update('a', { finishReason: 'stop' })
  store.begin('b', 'actual', now)
  store.begin('c', 'unknown', now)
  const stats = store.statistics(7, now)
  expect(stats).toMatchObject({ trackingSince: now, calls: 3, reported: 1, tokens: 15 })
  expect(stats.days).toHaveLength(7)
  expect(stats.days[0]).toMatchObject({ calls: 0, reported: 0, tokens: 0 })
  expect(stats.days.at(-1)).toMatchObject({ calls: 3, reported: 1, tokens: 15 })
  expect(stats.models).toEqual([{ model: 'actual', calls: 2, reported: 1, tokens: 15 }, { model: 'unknown', calls: 1, reported: 0, tokens: null }])
})

it('shares tracking start and writes across independent connections and survives reopening', () => {
  const { store, dir, now } = fixture()
  const other = new UsageStore(dir, now + 1000)
  other.begin('worker', 'worker-model', now)
  other.update('worker', { usage: { inputTokens: 7, outputTokens: 3 } })
  other.close()
  store.begin('main', 'main-model', now)
  store.update('main', { usage: { totalTokens: 0 } })
  expect(store.statistics(7, now)).toMatchObject({ trackingSince: now, calls: 2, reported: 2, tokens: 10 })
  store.close()
  const reopened = new UsageStore(dir, now + 2000)
  expect(reopened.statistics(7, now)).toMatchObject({ trackingSince: now, calls: 2, tokens: 10 })
  reopened.close()
})

it('uses local date boundaries, excludes future/out-of-range calls and validates ranges', () => {
  const { store, now } = fixture()
  for (const [id, offset] of [['today', 0], ['week', -6], ['old', -7], ['future', 1]] as const) {
    const date = new Date(now); date.setDate(date.getDate() + offset); date.setHours(0, 0, 0, 0)
    store.begin(id, 'm', date.getTime())
  }
  expect(store.statistics(7, now)).toMatchObject({ calls: 2, reported: 0, tokens: null })
  expect(store.statistics(30, now)).toMatchObject({ calls: 3 })
  expect(() => store.statistics(8 as 7, now)).toThrow()
})

it('does not count partial, invalid or missing counters as a reported total', () => {
  const { store, now } = fixture()
  store.begin('a', 'm', now)
  store.update('a', { usage: { inputTokens: 10, totalTokens: NaN, outputTokens: -1 } })
  expect(store.statistics(7, now)).toMatchObject({ calls: 1, reported: 0, tokens: null })
})
