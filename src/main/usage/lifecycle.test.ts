import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beginUsageCall, closeUsage, getUsageStore, initializeUsage, markUsageCollectionIssue } from './index'

afterEach(closeUsage)
it('initializes explicitly, persists observed usage on close/reopen, and releases the connection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-usage-lifecycle-'))
  try {
    expect(() => getUsageStore()).toThrow()
    initializeUsage(dir)
    beginUsageCall('model').update({ usage: { totalTokens: 17 } })
    const since = getUsageStore().statistics(7).trackingSince
    closeUsage()
    expect(() => getUsageStore()).toThrow()
    initializeUsage(dir)
    expect(getUsageStore().statistics(7)).toMatchObject({ trackingSince: since, calls: 1, tokens: 17 })
  } finally { closeUsage(); rmSync(dir, { recursive: true, force: true }) }
})

it('does not block execution when the ledger cannot initialize, and exposes a safe unavailable error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-usage-broken-'))
  try {
    writeFileSync(join(dir, 'app-usage.sqlite'), 'broken sqlite file')
    let failure = false
    expect(() => initializeUsage(dir, () => { failure = true })).not.toThrow()
    expect(failure).toBe(true)
    expect(() => beginUsageCall('model').update({ usage: { totalTokens: 12 } })).not.toThrow()
    expect(() => getUsageStore()).toThrow('Token 用量存储暂时不可用')
  } finally { closeUsage(); rmSync(dir, { recursive: true, force: true }) }
})

it('preserves a known collection gap across reopening instead of presenting incomplete data as complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-usage-gap-'))
  try {
    initializeUsage(dir)
    markUsageCollectionIssue()
    closeUsage(); initializeUsage(dir)
    expect(getUsageStore().statistics(7).collectionIssue).toBe('部分调用用量未能保存，统计可能不完整。')
  } finally { closeUsage(); rmSync(dir, { recursive: true, force: true }) }
})

it('shows the in-memory collection gap when both the call write and durable gap write fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-usage-write-failure-'))
  try {
    initializeUsage(dir)
    const db = new Database(join(dir, 'app-usage.sqlite'))
    db.exec("CREATE TRIGGER fail_calls BEFORE INSERT ON usage_calls BEGIN SELECT RAISE(ABORT,'full'); END; CREATE TRIGGER fail_meta BEFORE INSERT ON usage_meta BEGIN SELECT RAISE(ABORT,'full'); END;")
    expect(() => beginUsageCall('model').update({ usage: { totalTokens: 17 } })).not.toThrow()
    db.close()
    expect(getUsageStore().statistics(7)).toMatchObject({ calls: 0, collectionIssue: '部分调用用量未能保存，统计可能不完整。' })
  } finally { closeUsage(); rmSync(dir, { recursive: true, force: true }) }
})
