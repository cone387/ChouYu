import type Database from 'better-sqlite3'
import { readStoredDelivery } from './delivery-blocks'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AgentDelivery, DeliverySection } from '../../shared/agent-delivery'
import { deliveryText, textHash, validId, validateAnchor, validateDeliveryRef, validatePortfolioQuery, type DeliveryRef, type PortfolioPage, type PortfolioQuery, type ReadingPosition } from '../../shared/contact-content'

type IndexedSection = { id: string; title: string; text: string; textHash: string }
type StoredSection = Omit<IndexedSection, 'text'> & { searchTitle: string }
type IndexedVersion = { seq: number; topic_id: string; version: number; title: string; created_at: number; sections: string }
type Cursor = { owner: string; filter: string; watermark: number; favoriteIds: string[]; last: { title: string; createdAt: number; topicId: string } }

/** Formal versions are immutable; personal state never changes a task's lifecycle. */
export class AgentPortfolio {
  private key: Buffer
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS portfolio_versions (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, topic_id TEXT NOT NULL, version INTEGER NOT NULL,
      title TEXT NOT NULL, created_at INTEGER NOT NULL, search_text TEXT NOT NULL, sections TEXT NOT NULL,
      UNIQUE(topic_id,version), FOREIGN KEY(topic_id,version) REFERENCES delivery_versions(topic_id,version) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS portfolio_topic_sequence ON portfolio_versions(topic_id,seq DESC);
      CREATE TABLE IF NOT EXISTS portfolio_favorites (topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS portfolio_reading (topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS portfolio_read_sections (topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,section_id TEXT NOT NULL,text_hash TEXT NOT NULL,PRIMARY KEY(topic_id,section_id));
      CREATE TABLE IF NOT EXISTS portfolio_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS portfolio_texts(hash TEXT PRIMARY KEY,text TEXT NOT NULL,search_text TEXT NOT NULL);`)
    db.prepare("INSERT OR IGNORE INTO portfolio_meta VALUES('cursor-key',?)").run(randomBytes(32).toString('hex'))
    this.key = Buffer.from((db.prepare("SELECT value FROM portfolio_meta WHERE key='cursor-key'").get() as { value: string }).value, 'hex')
    db.transaction(() => {
      const keys = db.prepare("SELECT seq FROM portfolio_versions WHERE json_type(sections,'$[0].text') IS NOT NULL").all() as { seq: number }[]
      for (const key of keys) {
        const row = db.prepare('SELECT seq,title,sections FROM portfolio_versions WHERE seq=?').get(key.seq) as { seq: number; title: string; sections: string }
        const old = JSON.parse(row.sections) as IndexedSection[]
        const sections = old.map(s => this.storeSection(s))
        if (JSON.stringify(this.readSections(sections)) !== JSON.stringify(old)) throw new Error('成果检索迁移不一致。')
        db.prepare('UPDATE portfolio_versions SET search_text=?,sections=? WHERE seq=?').run(row.title.toLowerCase(), JSON.stringify(sections), row.seq)
      }
    })()
  }
  private storeSection(section: IndexedSection): StoredSection {
    const { text, ...metadata } = section
    if (textHash(text) !== section.textHash) throw new Error('成果检索正文损坏。')
    this.db.prepare('INSERT OR IGNORE INTO portfolio_texts VALUES(?,?,?)').run(section.textHash, text, text.toLowerCase())
    if ((this.db.prepare('SELECT text FROM portfolio_texts WHERE hash=?').get(section.textHash) as { text: string }).text !== text) throw new Error('成果检索正文损坏。')
    return { ...metadata, searchTitle: section.title.toLowerCase() }
  }
  private readSections(sections: StoredSection[]): IndexedSection[] {
    const get = this.db.prepare('SELECT text FROM portfolio_texts WHERE hash=?')
    return sections.map(({ searchTitle: _, ...section }) => {
      const row = get.get(section.textHash) as { text: string } | undefined
      if (!row || textHash(row.text) !== section.textHash) throw new Error('成果检索正文缺失或损坏。')
      return { id: section.id, title: section.title, text: row.text, textHash: section.textHash }
    })
  }
  collectUnreferenced(): void {
    this.db.exec("DELETE FROM portfolio_texts WHERE NOT EXISTS (SELECT 1 FROM portfolio_versions p,json_each(p.sections) s WHERE json_extract(s.value,'$.textHash')=portfolio_texts.hash)")
  }
  backfill() {
    const rows = this.db.prepare('SELECT d.topic_id,d.value FROM delivery_versions d LEFT JOIN portfolio_versions p ON p.topic_id=d.topic_id AND p.version=d.version WHERE p.seq IS NULL ORDER BY d.rowid').all() as { topic_id: string; value: string }[]
    for (const row of rows) this.index(row.topic_id, readStoredDelivery(this.db, row.value))
  }
  index(topicId: string, artifact: AgentDelivery) {
    const topic = this.db.prepare('SELECT value FROM topics WHERE id=?').get(topicId) as { value: string }
    const title = JSON.parse(topic.value).title as string
    const sections = artifact.sections.map(s => { const text = deliveryText(s.body); return { id: s.id, title: s.title, text, textHash: textHash(text) } })
    this.db.transaction(() => {
      const stored = sections.map(s => this.storeSection(s))
      this.db.prepare('INSERT INTO portfolio_versions(topic_id,version,title,created_at,search_text,sections) VALUES(?,?,?,?,?,?)')
        .run(topicId, artifact.version, title, artifact.createdAt, title.toLowerCase(), JSON.stringify(stored))
    })()
  }
  private owner(owner: string, topicId: string) {
    if (!validId(owner) || !validId(topicId) || !this.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(topicId, owner)) throw new Error('找不到此联系人的任务。')
  }
  resolve(owner: string, raw: DeliveryRef): { artifact: AgentDelivery; section?: DeliverySection } {
    const ref = validateDeliveryRef(raw)
    if (ref.characterId !== owner) throw new Error('成果不属于此联系人。')
    this.owner(owner, ref.topicId)
    const row = this.db.prepare('SELECT value FROM delivery_versions WHERE topic_id=? AND version=?').get(ref.topicId, ref.version) as { value: string } | undefined
    if (!row) throw new Error('找不到该成果版本。')
    const artifact = readStoredDelivery(this.db, row.value), section = artifact.sections.find(s => s.id === ref.sectionId)
    if (ref.sectionId !== undefined && !section) throw new Error('找不到该成果分节。')
    return { artifact, ...(section ? { section } : {}) }
  }
  list(owner: string, raw: PortfolioQuery): PortfolioPage {
    if (!validId(owner)) throw new Error('联系人无效。')
    const q = validatePortfolioQuery(raw), filter = JSON.stringify({ ...q, cursor: undefined })
    if (q.topicId) this.owner(owner, q.topicId)
    const favoriteIds = (this.db.prepare('SELECT f.topic_id FROM portfolio_favorites f JOIN topics t ON t.id=f.topic_id WHERE t.character_id=?').all(owner) as { topic_id: string }[]).map(r => r.topic_id)
    const watermark = (this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM portfolio_versions').get() as { n: number }).n
    const snapshot = q.cursor ? this.decode(q.cursor) : { owner, filter, watermark, favoriteIds, last: null }
    if (snapshot.owner !== owner || snapshot.filter !== filter || !Number.isSafeInteger(snapshot.watermark) || snapshot.watermark < 0 || snapshot.watermark > watermark) throw new Error('成果分页位置无效，请重新查询。')
    const clauses = ['t.character_id=@owner', 'p.seq=(SELECT MAX(v.seq) FROM portfolio_versions v WHERE v.topic_id=p.topic_id AND v.seq<=@watermark)'], args: Record<string, string | number> = { owner, watermark: snapshot.watermark }
    if (q.topicId) { clauses.push('p.topic_id=@topic'); args.topic = q.topicId }
    if (q.query) {
      // Reconstruct the original lowercased search stream, including boundaries,
      // without storing a second cumulative copy for every immutable version.
      clauses.push(`instr(p.search_text || COALESCE((SELECT char(10) || group_concat(part,char(10)) FROM
        (SELECT json_extract(s.value,'$.searchTitle') || char(10) || x.search_text AS part
         FROM json_each(p.sections) s JOIN portfolio_texts x ON x.hash=json_extract(s.value,'$.textHash') ORDER BY CAST(s.key AS INTEGER))),''),@query)>0`)
      args.query = q.query.toLowerCase()
    }
    if (q.favoritesOnly) { clauses.push('p.topic_id IN (SELECT value FROM json_each(@favorites))'); args.favorites = JSON.stringify(snapshot.favoriteIds) }
    if (snapshot.last) {
      const last = snapshot.last
      if (q.sort === 'name') { clauses.push('(p.title>@title OR (p.title=@title AND p.topic_id>@lastId))'); args.title = last.title }
      else { clauses.push('(p.created_at<@time OR (p.created_at=@time AND p.topic_id>@lastId))'); args.time = last.createdAt }
      args.lastId = last.topicId
    }
    const rows = this.db.prepare(`SELECT p.* FROM portfolio_versions p JOIN topics t ON t.id=p.topic_id WHERE ${clauses.join(' AND ')} ORDER BY ${q.sort === 'name' ? 'p.title ASC' : 'p.created_at DESC'},p.topic_id ASC LIMIT 31`).all(args) as IndexedVersion[]
    const items = rows.slice(0, 30).map(row => {
      const sections = this.readSections(JSON.parse(row.sections)), needle = q.query?.toLowerCase() ?? ''
      const match = sections.find(s => s.title.toLowerCase().includes(needle) || s.text.toLowerCase().includes(needle)) ?? sections[0]
      const start = Math.max(0, (match?.text.toLowerCase().indexOf(needle) ?? 0) - 50)
      const read = new Map((this.db.prepare('SELECT section_id,text_hash FROM portfolio_read_sections WHERE topic_id=?').all(row.topic_id) as { section_id: string; text_hash: string }[]).map(r => [r.section_id, r.text_hash]))
      return { ref: { characterId: owner, topicId: row.topic_id, version: row.version, ...(match ? { sectionId: match.id } : {}) }, title: row.title, excerpt: match?.text.slice(start, start + 220) ?? '', createdAt: row.created_at, favorite: favoriteIds.includes(row.topic_id), sections: sections.map(s => ({ id: s.id, title: s.title, textHash: s.textHash, readHash: read.get(s.id) ?? null })) }
    })
    const last = rows[29]
    return { items, nextCursor: rows.length > 30 ? this.encode({ ...snapshot, last: { title: last.title, createdAt: last.created_at, topicId: last.topic_id } }) : null }
  }
  favorite(owner: string, topicId: string, value: boolean) {
    this.owner(owner, topicId)
    if (typeof value !== 'boolean') throw new Error('收藏状态无效。')
    if (value) this.db.prepare('INSERT OR IGNORE INTO portfolio_favorites VALUES(?)').run(topicId)
    else this.db.prepare('DELETE FROM portfolio_favorites WHERE topic_id=?').run(topicId)
  }
  saveReading(owner: string, input: ReadingPosition) {
    if (!input || typeof input !== 'object' || !Number.isFinite(input.scrollRatio) || input.scrollRatio < 0 || input.scrollRatio > 1 || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) throw new Error('阅读位置无效。')
    const ref = validateDeliveryRef(input.ref), { section } = this.resolve(owner, ref)
    if (!section) throw new Error('请指定正在阅读的分节。')
    const text = deliveryText(section.body), anchor = input.anchor === undefined ? undefined : validateAnchor(input.anchor, text)
    const position: ReadingPosition = { ref, ...(anchor ? { anchor } : {}), scrollRatio: input.scrollRatio, updatedAt: input.updatedAt }
    this.db.transaction(() => {
      // Late debounced events must not replace a newer user position.
      if ((this.reading(owner, ref.topicId)?.updatedAt ?? -1) > position.updatedAt) return
      this.db.prepare('INSERT INTO portfolio_reading VALUES(?,?) ON CONFLICT(topic_id) DO UPDATE SET value=excluded.value').run(ref.topicId, JSON.stringify(position))
      this.db.prepare('INSERT INTO portfolio_read_sections VALUES(?,?,?) ON CONFLICT(topic_id,section_id) DO UPDATE SET text_hash=excluded.text_hash').run(ref.topicId, section.id, textHash(text))
    })()
  }
  reading(owner: string, topicId: string): ReadingPosition | null {
    this.owner(owner, topicId)
    const row = this.db.prepare('SELECT value FROM portfolio_reading WHERE topic_id=?').get(topicId) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  private encode(cursor: Cursor) {
    const body = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    return `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`
  }
  private decode(cursor: string): Cursor {
    try {
      const parts = cursor.split('.'), body = parts[0], signature = Buffer.from(parts[1] ?? '', 'base64url')
      const expected = createHmac('sha256', this.key).update(body).digest()
      if (parts.length !== 2 || signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error()
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch { throw new Error('成果分页位置无效，请重新查询。') }
  }
}
