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
    if (!existsSync(this.directory)) return []
    return readdirSync(this.directory, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !groupId.test(entry.name)) return []
      try { return [this.verify(entry.name)] } catch { return [] }
    }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  }
  create(): Promise<ContactBackupManifest> {
    if (!this.databases) return Promise.reject(new Error('备份源数据库未打开。'))
    if (this.inFlight) return this.inFlight
    this.inFlight = this.exclusive(async () => {
      mkdirSync(this.directory, { recursive: true })
      const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1, (this.list()[0]?.createdAt ?? 0) + 1)
      this.lastCreatedAt = createdAt
      const id = `${createdAt}-${randomUUID()}`, staging = join(this.directory, '.pending-' + id)
      mkdirSync(staging)
      try {
        for (const role of roles) {
          const filename = join(staging, role + '.db')
          await this.databases![role].backup(filename)
          durableFile(filename)
        }
        const manifest: ContactBackupManifest = { format: 1, id, createdAt, files: this.inspect(staging) }
        const metadata = join(staging, 'manifest.json')
        writeFileSync(metadata, JSON.stringify(manifest)); durableFile(metadata)
        renameSync(staging, this.path(id))
        // Only completed and verified groups owned by this feature are rotated.
        for (const old of this.list().slice(3)) rmSync(this.path(old.id), { recursive: true })
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
