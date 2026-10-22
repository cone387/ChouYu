import Database from 'better-sqlite3'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

export function validateApplicationFile(filename: string, allowEmptyInitialization = false): void {
  const db = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > 1) throw new Error('NEWER_STORE_VERSION')
    if (version === 0 && allowEmptyInitialization && db.pragma('quick_check', { simple: true }) === 'ok') {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      if (tables.every(t => ['sessions', 'messages', 'metadata', 'state', 'delivery_receipts'].includes(t.name)
        && (db.prepare(`SELECT count(*) AS n FROM "${t.name}"`).get() as { n: number }).n === 0)) return
    }
    if (version !== 1 || db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Invalid application database')
    for (const table of ['sessions', 'messages', 'metadata', 'state', 'delivery_receipts']) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all()
  } finally { db.close() }
}
function corrupt(error: unknown) {
  return ['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_ERROR'].includes((error as { code?: string }).code ?? '') || (error instanceof Error && error.message === 'Invalid application database')
}
export function recoverApplicationFile(filename: string): string | null {
  let missing = !fs.existsSync(filename)
  if (!missing) {
    try { validateApplicationFile(filename, true); return null }
    catch (error) {
      if (!corrupt(error)) throw error
      const suffix = `.corrupt-${Date.now()}-${randomUUID()}`
      // Preserve the complete WAL family before replacing the authoritative file.
      for (const part of ['', '-wal', '-shm']) if (fs.existsSync(filename + part)) fs.renameSync(filename + part, filename + suffix + part)
    }
  }
  const backup = filename + '.bak'
  if (fs.existsSync(backup)) {
    validateApplicationFile(backup)
    fs.copyFileSync(backup, filename)
    validateApplicationFile(filename)
    return `已从上一次备份恢复聊天数据，备份之后的修改可能丢失。${missing ? '原数据文件缺失。' : '原有损坏文件已保留。'}`
  }
  if (!missing) throw new Error('Damaged application database; no verified backup')
  return null
}

/** VACUUM INTO is a consistent SQLite snapshot, including committed WAL pages. */
export function backupApplicationFile(db: Database.Database, filename: string): void {
  const temporary = `${filename}.snapshot-${randomUUID()}`
  try {
    db.prepare('VACUUM INTO ?').run(temporary)
    validateApplicationFile(temporary)
    const fd = fs.openSync(temporary, 'r+')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, filename + '.bak')
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}
