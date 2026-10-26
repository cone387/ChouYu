import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { ContactBackups } from './contact-backups'

export type ContactStorageHealth = { kind: 'new' | 'healthy' | 'damaged' | 'missing' | 'incompatible' | 'unavailable' }
const files = ['agents.db', 'checkpoints.db'] as const
const family = files.flatMap(file => [file, file + '-wal', file + '-shm'])
export function inspectContactStorage(directory: string): ContactStorageHealth {
  const present = files.map(file => existsSync(join(directory, file)))
  if (!present.some(Boolean)) {
    const previous = existsSync(join(directory, 'backups')) && readdirSync(join(directory, 'backups')).length > 0
    return { kind: previous || existsSync(join(directory, 'restore.json')) ? 'missing' : 'new' }
  }
  let problem: ContactStorageHealth['kind'] | undefined
  for (const file of files) {
    if (!existsSync(join(directory, file))) continue
    let db: Database.Database | undefined
    try {
      db = new Database(join(directory, file), { readonly: true, fileMustExist: true })
      if ((db.pragma('user_version', { simple: true }) as number) > (file === 'agents.db' ? 19 : 0)) return { kind: 'incompatible' }
      if (db.pragma('quick_check', { simple: true }) !== 'ok') problem ??= 'damaged'
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') problem ??= 'damaged'
      else problem = 'unavailable'
    } finally { db?.close() }
  }
  return { kind: problem ?? (present.every(Boolean) ? 'healthy' : 'missing') }
}
type Journal = { format: 1; id: string; group: string; phase: 'preserving' | 'publishing' | 'complete' }
function durable(filename: string) { const fd = openSync(filename, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) } }
function digest(filename: string) { return createHash('sha256').update(readFileSync(filename)).digest('hex') }

/** Caller must stop the worker and all SQLite handles before entering this protocol. */
export class ContactRestore {
  constructor(private directory: string, private protect: (group: string, restoreId: string) => void,
    private checkpoint: (phase: string) => void = () => {}, private verifyProtection = protect) {}
  private save(journal: Journal) {
    const temp = join(this.directory, 'restore.json.tmp')
    writeFileSync(temp, JSON.stringify(journal)); durable(temp)
    renameSync(temp, join(this.directory, 'restore.json'))
  }
  restore(group: string) {
    const health = inspectContactStorage(this.directory)
    if (health.kind !== 'damaged' && health.kind !== 'missing') throw new Error('只有确认损坏或缺失的联系人数据库可以恢复备份。')
    const backup = new ContactBackups(this.directory).verify(group)
    if (backup.files.tasks.schema > 19 || backup.files.checkpoints.schema > 0) throw new Error('备份数据版本较新，请升级应用。')
    const journal: Journal = { format: 1, id: randomUUID(), group, phase: 'preserving' }
    const target = join(this.directory, 'recovery', journal.id)
    mkdirSync(join(target, 'original'), { recursive: true })
    mkdirSync(join(target, 'replacement'))
    for (const [index, file] of files.entries()) {
      const output = join(target, 'replacement', file)
      copyFileSync(join(this.directory, 'backups', group, index === 0 ? 'tasks.db' : 'checkpoints.db'), output); durable(output)
    }
    // Persist protection outside the restored pair before any live file is moved.
    this.protect(group, journal.id)
    this.save(journal); this.checkpoint('prepared')
    this.resume()
  }
  resume() {
    const filename = join(this.directory, 'restore.json')
    if (!existsSync(filename)) return
    const journal = JSON.parse(readFileSync(filename, 'utf8')) as Journal
    if (journal.format !== 1 || !/^[a-f0-9-]{36}$/.test(journal.id) || !['preserving', 'publishing', 'complete'].includes(journal.phase)) throw new Error('联系人恢复日志无效，未打开任务数据库。')
    this.verifyProtection(journal.group, journal.id)
    if (journal.phase === 'complete') return
    const backup = new ContactBackups(this.directory).verify(journal.group)
    const target = join(this.directory, 'recovery', journal.id)
    if (journal.phase === 'preserving') {
      for (const file of family) {
        const original = join(target, 'original', file), live = join(this.directory, file)
        if (existsSync(live)) {
          if (existsSync(original)) throw new Error('恢复原文件存在冲突，已停止替换。')
          renameSync(live, original)
        }
        this.checkpoint('preserved:' + file)
      }
      journal.phase = 'publishing'; this.save(journal); this.checkpoint('publishing')
    }
    for (const [index, file] of files.entries()) {
      const staged = join(target, 'replacement', file), live = join(this.directory, file)
      const expected = index === 0 ? backup.files.tasks.sha256 : backup.files.checkpoints.sha256
      if (existsSync(staged)) {
        if (existsSync(live) || digest(staged) !== expected) throw new Error('恢复文件校验失败，已停止替换。')
        renameSync(staged, live)
      }
      if (!existsSync(live) || digest(live) !== expected) throw new Error('恢复文件组不一致，未打开任务数据库。')
      this.checkpoint('published:' + file)
    }
    journal.phase = 'complete'; this.save(journal)
  }
}
