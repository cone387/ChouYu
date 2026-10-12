import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { validId, type ContactReadContext } from '../../shared/contact-content'
import { validateContactScope } from '../../shared/contact-memories'
import type { MaterialInput, MaterialRead, MaterialRef, MaterialSummary, MaterialVersion } from '../../shared/contact-materials'
export class AgentMaterials {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS contact_materials(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,version INTEGER NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contact_material_versions(id TEXT NOT NULL REFERENCES contact_materials(id) ON DELETE CASCADE,version INTEGER NOT NULL,bytes INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,version));`)
  }
  private summary(v: MaterialVersion): MaterialSummary { const { content: _, ...summary } = v; return summary }
  private head(owner: string, id: string) {
    const row = this.db.prepare('SELECT version,status FROM contact_materials WHERE id=? AND owner=?').get(id, owner) as { version: number; status: string } | undefined
    if (!row) throw new Error('资料不存在或不属于此联系人。')
    return row
  }
  get(owner: string, ref: MaterialRef): MaterialVersion {
    if (!validId(ref?.id) || !Number.isSafeInteger(ref.version) || ref.version < 1) throw new Error('资料版本无效。')
    const head = this.head(owner, ref.id)
    if (head.status === 'removed') throw new Error('资料正文已移除，来源记录仍保留。')
    if (head.status === 'withdrawn') throw new Error('资料已撤回，无法继续读取。')
    const row = this.db.prepare('SELECT value FROM contact_material_versions WHERE id=? AND version=?').get(ref.id, ref.version) as { value: string } | undefined
    if (!row) throw new Error('资料版本不存在。')
    return JSON.parse(row.value)
  }
  save(owner: string, input: MaterialInput, id?: string, expectedVersion?: number): MaterialVersion {
    if (!input || typeof input.content !== 'string' || !input.content.trim() || input.content.includes('\0') || Buffer.from(input.content, 'utf8').toString('utf8') !== input.content) throw new Error('请提供有效的 UTF-8 文本，不能包含空字符。')
    const bytes = Buffer.byteLength(input.content, 'utf8')
    if (bytes > 2 * 1024 * 1024) throw new Error('单份资料不得超过 2 MB。')
    const scope = validateContactScope(input.scope)
    if (scope.kind === 'session') throw new Error('资料范围仅支持联系人或任务。')
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || !input.source || !['text', 'file', 'attachment', 'web'].includes(input.source.kind) || typeof input.source.label !== 'string' || !input.source.label.trim() || input.source.label.length > 500) throw new Error('资料名称或来源无效。')
    if (input.source.kind === 'web') { try { const url = new URL(input.source.url!); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error() } catch { throw new Error('网页来源无效。') } }
    const source = { kind: input.source.kind, label: input.source.label, ...(input.source.kind === 'web' ? { url: input.source.url } : {}) }
    const hash = createHash('sha256').update(input.content).digest('hex')
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM profiles WHERE character_id=?').get(owner)) throw new Error('联系人不存在。')
      if (scope.kind === 'task' && !this.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(scope.topicId, owner)) throw new Error('资料任务不属于此联系人。')
      let version = 1
      if (id) {
        const head = this.head(owner, id)
        if (head.status !== 'ready' || head.version !== expectedVersion) throw new Error('资料已变化或撤回，请重新读取。')
        const old = this.get(owner, { id, version: head.version })
        if (old.hash === hash && old.name === input.name.trim() && JSON.stringify(old.scope) === JSON.stringify(scope) && JSON.stringify(old.source) === JSON.stringify(source)) return old
        version = head.version + 1
      } else {
        if (expectedVersion !== undefined) throw new Error('请指定要更新的资料。')
        const count = this.db.prepare("SELECT count(*) n FROM contact_materials WHERE owner=? AND status='ready'").get(owner) as { n: number }
        if (count.n >= 100) throw new Error('资料空间最多 100 份，请先撤回不再使用的资料。')
        id = randomUUID()
      }
      const retained = this.db.prepare('SELECT coalesce(sum(v.bytes),0) n FROM contact_material_versions v JOIN contact_materials m ON m.id=v.id WHERE m.owner=?').get(owner) as { n: number }
      if (retained.n + bytes > 200 * 1024 * 1024) throw new Error('资料历史总量不得超过 200 MB。请在资料整理中清理已撤回资料的正文。')
      const value: MaterialVersion = { name: input.name.trim(), content: input.content, scope, source, id, version, owner, hash, createdAt: Date.now(), status: 'ready' }
      this.db.prepare("INSERT INTO contact_materials VALUES(?,?,?,'ready') ON CONFLICT(id) DO UPDATE SET version=excluded.version").run(id, owner, version)
      this.db.prepare('INSERT INTO contact_material_versions VALUES(?,?,?,?)').run(id, version, bytes, JSON.stringify(value))
      return value
    })()
  }
  list(context: ContactReadContext): MaterialSummary[] {
    return (this.db.prepare("SELECT v.value FROM contact_materials m JOIN contact_material_versions v ON v.id=m.id AND v.version=m.version WHERE m.owner=? AND m.status='ready' ORDER BY m.rowid DESC").all(context.characterId) as { value: string }[]).map(r => JSON.parse(r.value) as MaterialVersion).filter(m => m.scope.kind === 'contact' || m.scope.topicId === context.topicId).map(m => this.summary(m))
  }
  read(context: ContactReadContext, ref: MaterialRef, offset = 0): MaterialRead {
    const v = this.get(context.characterId, ref)
    if (v.scope.kind === 'task' && v.scope.topicId !== context.topicId) throw new Error('此资料不在本次任务范围内。')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > v.content.length) throw new Error('资料读取位置无效。')
    let end = Math.min(v.content.length, offset + 12000)
    if (end < v.content.length && /[\uD800-\uDBFF]/.test(v.content[end - 1])) end--
    return { text: v.content.slice(offset, end), ref: { id: v.id, version: v.version }, ...(end < v.content.length ? { nextOffset: end } : {}) }
  }
  history(owner: string, id: string): MaterialSummary[] {
    const head = this.head(owner, id)
    return (this.db.prepare('SELECT value FROM contact_material_versions WHERE id=? ORDER BY version DESC').all(id) as { value: string }[]).map(r => ({ ...this.summary(JSON.parse(r.value)), status: head.status as MaterialVersion['status'] }))
  }
  withdraw(owner: string, id: string, version: number) {
    const head = this.head(owner, id)
    if (head.version !== version || head.status !== 'ready') throw new Error('资料已变化或已撤回。')
    this.db.prepare("UPDATE contact_materials SET status='withdrawn' WHERE id=?").run(id)
  }
  inventory(owner: string): MaterialSummary[] {
    return (this.db.prepare('SELECT v.value,m.status FROM contact_materials m JOIN contact_material_versions v ON v.id=m.id AND v.version=m.version WHERE m.owner=? ORDER BY m.rowid DESC').all(owner) as { value: string; status: MaterialVersion['status'] }[]).map(row => ({ ...this.summary(JSON.parse(row.value)), status: row.status }))
  }
  purge(owner: string, id: string, version: number) {
    this.db.transaction(() => {
      const head = this.head(owner, id)
      if (head.version !== version || head.status !== 'withdrawn') throw new Error('只能清理当前已撤回资料，请重新读取。')
      const rows = this.db.prepare('SELECT version,value FROM contact_material_versions WHERE id=?').all(id) as { version: number; value: string }[]
      for (const row of rows) this.db.prepare('UPDATE contact_material_versions SET bytes=0,value=? WHERE id=? AND version=?').run(JSON.stringify({ ...JSON.parse(row.value), content: '', status: 'removed' }), id, row.version)
      this.db.prepare("UPDATE contact_materials SET status='removed' WHERE id=?").run(id)
    })()
  }
}
