import Database from 'better-sqlite3'

type ContactDatabase = 'tasks' | 'checkpoints'
type StartupPhase = 'open' | 'wal' | 'schema'
export interface StorageDiagnostic { database: ContactDatabase; phase: StartupPhase; code?: string }
export interface StorageRetry { attempt: number; delayMs: number; storage: StorageDiagnostic }
export function contactStorageDiagnostic(error: unknown): StorageDiagnostic | undefined {
  const value = error as Partial<StorageDiagnostic> | null
  if (!value || !['tasks', 'checkpoints'].includes(value.database!) || !['open', 'wal', 'schema'].includes(value.phase!)) return undefined
  return { database: value.database!, phase: value.phase!, ...(typeof value.code === 'string' && /^SQLITE_[A-Z_]+$/.test(value.code) ? { code: value.code } : {}) }
}
export function contactStorageFailure(error: unknown, database: ContactDatabase, phase: StartupPhase) {
  const raw = (error as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' && /^SQLITE_[A-Z_]+$/.test(raw) ? raw : undefined
  const detail = error instanceof Error ? error.message : '未知存储错误'
  const failure = new Error(`联系人存储初始化失败（${database}/${phase}${code ? `，${code}` : ''}）：${detail}`, { cause: error })
  return Object.assign(failure, { database, phase, code })
}

/** A failed WAL setup must not leak the just-opened connection on Windows. */
export function openContactDatabase(filename: string, database: ContactDatabase): Database.Database {
  let db: Database.Database
  try { db = new Database(filename) }
  catch (error) { throw contactStorageFailure(error, database, 'open') }
  try {
    db.pragma('busy_timeout = 5000')
    db.pragma('journal_mode = WAL')
    return db
  } catch (error) { db.close(); throw contactStorageFailure(error, database, 'wal') }
}

/** Windows may release a crashed writer's SHM mapping after its file lock.
 * Reopen only this WAL initialization failure, with a bounded wait and diagnostics.
 * Each failed open/host constructor must release its partial resources first.
 */
export async function initializeContactStorage<T>(open: () => T, retry: (event: StorageRetry) => void): Promise<T> {
  const delays = [100, 250, 500]
  for (let attempt = 0; ; attempt++) {
    try { return open() }
    catch (error) {
      const storage = contactStorageDiagnostic(error)
      if (process.platform !== 'win32' || storage?.phase !== 'wal' || storage.code !== 'SQLITE_IOERR_TRUNCATE' || attempt >= delays.length) throw error
      retry({ attempt: attempt + 1, delayMs: delays[attempt], storage })
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }
  }
}
