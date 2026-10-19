import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkLoopHost } from './workloop-host'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime } from '../workloop/workflow'

// On Windows a live SQLite handle prevents renaming its file. This tests actual
// resource release after partial startup, without replacing SQLite with a mock.
const windows = it.skipIf(process.platform !== 'win32')
function fixture() { return mkdtempSync(join(tmpdir(), 'chouyu-storage-startup-')) }
function released(file: string) { renameSync(file, file + '.released'); renameSync(file + '.released', file) }
function cleanup(dir: string) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* A failing leak test leaves its handle until test-worker exit. */ } }

windows('releases the contact database when opening checkpoints fails', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'checkpoints.db'))
  try {
    expect(() => new WorkLoopHost(dir, () => {})).toThrow()
    expect(() => released(join(dir, 'agents.db'))).not.toThrow()
  } finally { cleanup(dir) }
})

windows('releases both databases when module assembly fails after they opened', () => {
  const dir = fixture()
  try {
    expect(() => new WorkLoopHost(dir, () => {}, undefined, undefined, undefined, undefined, undefined, { modules: ['missing'] })).toThrow()
    expect(() => released(join(dir, 'agents.db'))).not.toThrow()
    expect(() => released(join(dir, 'checkpoints.db'))).not.toThrow()
  } finally { cleanup(dir) }
})

windows('closes a contact store whose schema setup failed and preserves its file', () => {
  const dir = fixture(), file = join(dir, 'agents.db')
  const seed = new Database(file)
  seed.exec('CREATE TABLE runs(id TEXT PRIMARY KEY)'); seed.close()
  try {
    expect(() => new ContactTaskStore(file)).toThrow()
    expect(() => released(file)).not.toThrow()
    const inspect = new Database(file)
    try { expect(inspect.pragma('table_info(runs)')).toMatchObject([{ name: 'id' }]) }
    finally { inspect.close() }
  } finally { cleanup(dir) }
})

windows('closes a failed checkpoint connection without closing the caller-owned store', () => {
  const dir = fixture(), file = join(dir, 'checkpoints.db')
  writeFileSync(file, 'not a SQLite database'.repeat(100))
  const store = new ContactTaskStore(join(dir, 'agents.db'))
  try {
    let failure: unknown
    try { new WorkStrategyRuntime(store, file) } catch (error) { failure = error }
    expect(failure).toMatchObject({ code: 'SQLITE_NOTADB', database: 'checkpoints', phase: 'wal' })
    expect(() => released(file)).not.toThrow()
    store.ensure('still-open')
    expect(store.profiles().map(p => p.character_id)).toContain('still-open')
  } finally { store.close(); cleanup(dir) }
})
