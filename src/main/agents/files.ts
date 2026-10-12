import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { extname } from 'node:path'
import { validateFileContext, workFileName, type WorkFileContext, type ContactFile, type ValidatedWorkFile } from '../../shared/contact-files'
import { validId, validateDeliveryRef, type DeliveryRef } from '../../shared/contact-content'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const media: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
/** Only validated byte snapshots enter this archive. SQLite atomically owns both copies and provenance. */
export class AgentFiles {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS contact_file_bytes(hash TEXT PRIMARY KEY,body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS contact_files(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,hash TEXT NOT NULL REFERENCES contact_file_bytes(hash),identity TEXT NOT NULL UNIQUE,value TEXT NOT NULL);`)
    db.prepare('DELETE FROM contact_file_bytes WHERE hash NOT IN (SELECT hash FROM contact_files)').run()
  }
  archive(raw: WorkFileContext, files: ValidatedWorkFile[]): ContactFile[] {
    const context = validateFileContext(raw)
    if (!Array.isArray(files) || files.length > 128) throw new Error('每次最多归档 128 个工作文件。')
    let total = 0
    const normalized = files.map(file => {
      const name = workFileName(file?.name)
      if (!(file.bytes instanceof Uint8Array) || file.bytes.length > 200000) throw new Error('单个工作文件最多 200 KB。')
      const bytes = Buffer.from(file.bytes); total += bytes.length
      return { name, bytes, hash: hash(bytes) }
    })
    if (total > 8 * 1024 * 1024 || new Set(normalized.map(f => f.name)).size !== files.length) throw new Error('工作文件超过 8 MB 或存在重复名称。')
    return this.db.transaction(() => {
      if (context.sessionId && !this.db.prepare('SELECT 1 FROM contact_memory_sessions WHERE session_id=? AND owner=?').get(context.sessionId, context.characterId)) throw new Error('文件会话不属于此联系人。')
      if (context.runId) {
        const run = this.db.prepare('SELECT character_id,topic_id,status FROM runs WHERE id=?').get(context.runId) as { character_id: string; topic_id: string; status: string } | undefined
        if (!run || run.character_id !== context.characterId || run.topic_id !== context.topicId || !['running', 'queued', 'interrupted'].includes(run.status)) throw new Error('文件对应的工作轮次已停止或归属不匹配。')
      }
      return normalized.map(item => {
        const identity = JSON.stringify([context, item.name, item.hash])
        const old = this.db.prepare('SELECT value FROM contact_files WHERE identity=?').get(identity) as { value: string } | undefined
        if (old) return JSON.parse(old.value) as ContactFile
        const file: ContactFile = { id: randomUUID(), context, name: item.name, hash: item.hash, bytes: item.bytes.length, mediaType: media[extname(item.name).toLowerCase()] || 'application/octet-stream', createdAt: Date.now() }
        this.db.prepare('INSERT OR IGNORE INTO contact_file_bytes VALUES(?,?)').run(item.hash, item.bytes)
        this.db.prepare('INSERT INTO contact_files VALUES(?,?,?,?,?)').run(file.id, context.characterId, item.hash, identity, JSON.stringify(file))
        return file
      })
    })()
  }
  list(owner: string, topicId?: string): ContactFile[] {
    if (!validId(owner) || topicId !== undefined && !validId(topicId)) throw new Error('文件范围无效。')
    return (this.db.prepare('SELECT value FROM contact_files WHERE owner=? ORDER BY rowid DESC').all(owner) as { value: string }[]).map(row => JSON.parse(row.value) as ContactFile).filter(file => !topicId || file.context.topicId === topicId)
  }
  read(owner: string, id: string) {
    if (!validId(owner) || !validId(id)) throw new Error('文件标识无效。')
    const row = this.db.prepare('SELECT value,body FROM contact_files f JOIN contact_file_bytes b ON f.hash=b.hash WHERE f.id=? AND owner=?').get(id, owner) as { value: string; body: Buffer } | undefined
    if (!row) throw new Error('文件不存在或不属于此联系人。')
    const file = JSON.parse(row.value) as ContactFile
    if (row.body.length !== file.bytes || hash(row.body) !== file.hash) throw new Error('归档文件校验失败，旧成果未被改写。')
    return { file, bytes: new Uint8Array(row.body) }
  }
  attach(owner: string, raw: DeliveryRef, fileIds: string[]) {
    const ref = validateDeliveryRef(raw)
    if (owner !== ref.characterId || !Array.isArray(fileIds) || fileIds.length > 128 || new Set(fileIds).size !== fileIds.length) throw new Error('文件交付引用无效。')
    this.db.transaction(() => {
      const version = this.db.prepare('SELECT d.run_id,r.character_id,r.status FROM delivery_versions d JOIN runs r ON r.id=d.run_id WHERE d.topic_id=? AND d.version=?').get(ref.topicId, ref.version) as { run_id: string; character_id: string; status: string } | undefined
      if (!version || version.character_id !== owner || version.status === 'cancelled' || version.status === 'failed') throw new Error('文件必须关联真实有效的成果。')
      for (const id of fileIds) {
        const { file } = this.read(owner, id)
        if (file.context.runId !== version.run_id || file.context.topicId !== ref.topicId) throw new Error('不能把其他轮次的工作文件当成本轮成果。')
        this.db.prepare('UPDATE contact_files SET value=? WHERE id=?').run(JSON.stringify({ ...file, deliveryRef: ref }), id)
      }
    })()
  }
}
