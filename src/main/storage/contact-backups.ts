import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { ContactBackupFile, ContactBackupManifest } from '../../shared/contact-backups'

type Databases = { tasks: Database.Database; checkpoints: Database.Database }
type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>
const roles = ['tasks', 'checkpoints'] as const
const groupId = /^\d{13}-[a-f0-9-]{36}$/
function hashFile(filename: string): string {
  const fd = openSync(filename, 'r'), buffer = Buffer.allocUnsafe(65536), hash = createHash('sha256')
  try { let count: number; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); return hash.digest('hex') }
  finally { closeSync(fd) }
}
function durableFile(filename: string) { const fd = openSync(filename, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) } }
function hasTable(db: Database.Database, table: string) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) }

/** No application recovery or authorization is inferred from a valid backup. */
export class ContactBackups {
  readonly directory: string
  private lastCreatedAt = 0
  private inFlight?: Promise<ContactBackupManifest>
  constructor(directory: string, private databases?: Databases, private exclusive: Exclusive = operation => operation()) {
    this.directory = resolve(directory, 'backups')
  }
  private path(id: string): string {
    if (!groupId.test(id)) throw new Error('备份标识无效。')
    const path = resolve(this.directory, id)
    if (!path.startsWith(this.directory + sep)) throw new Error('备份路径无效。')
    return path
  }
  private inspect(directory: string): ContactBackupManifest['files'] {
    const connections: Partial<Databases> = {}, files = {} as ContactBackupManifest['files']
    try {
      for (const role of roles) {
        const filename = join(directory, role + '.db')
        const db = connections[role] = new Database(filename, { readonly: true, fileMustExist: true })
        if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('备份数据库完整性检查失败。')
        files[role] = { schema: db.pragma('user_version', { simple: true }) as number, bytes: statSync(filename).size, sha256: hashFile(filename) }
      }
      const tasks = connections.tasks!, checkpoints = connections.checkpoints!
      if (!hasTable(tasks, 'runs') || !hasTable(tasks, 'profiles')) throw new Error('任务备份缺少业务记录结构。')
      if (hasTable(checkpoints, 'checkpoints')) {
        const known = tasks.prepare('SELECT 1 FROM runs WHERE id=?')
        const cleanup = hasTable(tasks, 'execution_cleanup') ? tasks.prepare('SELECT 1 FROM execution_cleanup WHERE request_id=?') : undefined
        for (const row of checkpoints.prepare('SELECT DISTINCT thread_id FROM checkpoints').iterate() as Iterable<{ thread_id: string }>) {
          if (!known.get(row.thread_id) && !cleanup?.get(row.thread_id)) throw new Error('检查点与任务备份归属不一致。')
        }
      }
      return files
    } finally { for (const role of roles) connections[role]?.close() }
  }
  verify(id: string): ContactBackupManifest {
    const directory = this.path(id)
    const value = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as ContactBackupManifest
    if (value.format !== 1 || value.id !== id || !Number.isSafeInteger(value.createdAt) || !value.files) throw new Error('备份清单无效。')
    const files = this.inspect(directory)
    for (const role of roles) {
      const expected: ContactBackupFile | undefined = value.files[role]
      if (!expected || expected.schema !== files[role].schema || expected.sha256 !== files[role].sha256 || expected.bytes !== files[role].bytes) throw new Error('备份文件与清单校验不一致。')
    }
    return value
  }
  list(): ContactBackupManifest[] {
    return this.ownedGroups().flatMap(id => {
      try { return [this.verify(id)] } catch { return [] }
    }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  }
  private ownedGroups(): string[] {
    if (!existsSync(this.directory)) return []
    return readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && groupId.test(entry.name)).map(entry => entry.name)
  }
  create(): Promise<ContactBackupManifest> {
    if (!this.databases) return Promise.reject(new Error('备份源数据库未打开。'))
    if (this.inFlight) return this.inFlight
    this.inFlight = this.exclusive(async () => {
      mkdirSync(this.directory, { recursive: true })
      // Ordering needs only our timestamped names, not a full read of every old
      // database. Integrity is checked once, after publishing, before rotation.
      const latest = this.ownedGroups().reduce((at, id) => Math.max(at, Number(id.slice(0, 13))), 0)
      const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1, latest + 1)
      this.lastCreatedAt = createdAt
      const id = `${createdAt}-${randomUUID()}`, staging = join(this.directory, '.pending-' + id)
      mkdirSync(staging)
      try {
        for (const role of roles) {
          const filename = join(staging, role + '.db')
          // Bound each transfer to about 8 MiB while yielding between batches.
          // The driver's 100-page default adds hundreds of small disk writes to
          // large final snapshots, including the database's reusable free pages.
          const pageSize = this.databases![role].pragma('page_size', { simple: true }) as number
          await this.databases![role].backup(filename, { progress: () => Math.max(1, Math.floor(8 * 1024 * 1024 / pageSize)) })
          durableFile(filename)
        }
        const manifest: ContactBackupManifest = { format: 1, id, createdAt, files: this.inspect(staging) }
        const metadata = join(staging, 'manifest.json')
        writeFileSync(metadata, JSON.stringify(manifest)); durableFile(metadata)
        renameSync(staging, this.path(id))
        // Only completed and verified groups owned by this feature are rotated.
        // The new group was just inspected and fsynced. Audit each old group
        // once; preserve damaged groups for recovery investigation and retain
        // two verified predecessors in addition to this new verified snapshot.
        const predecessors = this.ownedGroups().filter(previous => previous !== id).flatMap(previous => {
          try { return [this.verify(previous)] } catch { return [] }
        }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
        for (const old of predecessors.slice(2)) rmSync(this.path(old.id), { recursive: true })
        return manifest
      } finally {
        if (existsSync(staging)) {
          const absolute = resolve(staging)
          if (absolute.startsWith(this.directory + sep) && absolute === join(this.directory, '.pending-' + id)) rmSync(absolute, { recursive: true, force: true })
        }
      }
    }).finally(() => { this.inFlight = undefined })
    return this.inFlight
  }
}
