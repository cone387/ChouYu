import { randomUUID } from 'node:crypto'
import type { AgentStore } from './store'
import { ContactSources } from './contact-sources'
import { validId, validateDeliveryRef } from '../../shared/contact-content'
import type { Handoff, HandoffPreparation, HandoffRequest, HandoffWork } from '../../shared/contact-handoffs'
import { containsSecret } from '../../shared/memory'
export class AgentHandoffs {
  constructor(private store: AgentStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS contact_handoffs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,request_id TEXT NOT NULL,payload TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(owner,request_id));
      CREATE TABLE IF NOT EXISTS contact_handoff_preparations(token TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,request_id TEXT NOT NULL,payload TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(owner,request_id));`)
  }
  validate(owner: string, raw: HandoffRequest): HandoffRequest {
    if (!raw || !validId(raw.requestId) || !validId(raw.recipientId) || raw.recipientId === owner || typeof raw.description !== 'string' || !raw.description.trim() || raw.description.length > 8000 || containsSecret(raw.description)) throw new Error('请选择另一位联系人并描述评审任务。')
    const request = { requestId: raw.requestId, source: validateDeliveryRef(raw.source), recipientId: raw.recipientId, description: raw.description.trim() }
    if (request.source.characterId !== owner) throw new Error('只能交接此联系人的成果。')
    this.store.portfolio.resolve(owner, request.source)
    new ContactSources(this.store).allowed(request.recipientId, owner)
    return request
  }
  existing(owner: string, raw: HandoffRequest): Handoff | null {
    const row = this.store.db.prepare('SELECT payload,value FROM contact_handoffs WHERE owner=? AND request_id=?').get(owner, raw.requestId) as { payload: string; value: string } | undefined
    if (!row) return null
    if (row.payload !== JSON.stringify(raw)) throw new Error('同一次交接的内容已变化，请重新发起。')
    return JSON.parse(row.value)
  }
  stage(owner: string, raw: HandoffRequest, work: HandoffWork): HandoffPreparation {
    const request = this.validate(owner, raw), existing = this.existing(owner, request)
    if (existing) return { kind: 'committed', handoff: existing }
    if (typeof work?.description !== 'string' || !work.description.trim() || work.description.length > 2000 || typeof work.requestLog !== 'string' || typeof work.continuous !== 'boolean' || containsSecret(work.description) || (work.tokens !== undefined && (!Number.isSafeInteger(work.tokens) || work.tokens < 1 || work.tokens > 1000000000))) throw new Error('任务解析结果无效，尚未交接。')
    const payload = JSON.stringify(request)
    const old = this.store.db.prepare('SELECT payload,value FROM contact_handoff_preparations WHERE owner=? AND request_id=?').get(owner, request.requestId) as { payload: string; value: string } | undefined
    if (old?.payload === payload) return JSON.parse(old.value)
    if (old) throw new Error('同一次交接的内容已变化，请重新发起。')
    const value: HandoffPreparation = { kind: 'ready', token: randomUUID(), request, work: { description: work.description.trim(), requestLog: work.requestLog, continuous: work.continuous, ...(work.tokens === undefined ? {} : { tokens: work.tokens }) } }
    this.store.db.prepare('INSERT INTO contact_handoff_preparations VALUES(?,?,?,?,?) ON CONFLICT(owner,request_id) DO UPDATE SET token=excluded.token,payload=excluded.payload,value=excluded.value').run(value.token, owner, request.requestId, payload, JSON.stringify(value))
    return value
  }
  commit(owner: string, raw: HandoffPreparation): Handoff {
    if (raw?.kind === 'committed') return this.get(owner, raw.handoff.id)
    if (raw?.kind !== 'ready' || !validId(raw.token)) throw new Error('交接准备无效，请重新描述。')
    return this.store.db.transaction(() => {
      const row = this.store.db.prepare('SELECT value FROM contact_handoff_preparations WHERE token=? AND owner=?').get(raw.token, owner) as { value: string } | undefined
      if (!row) throw new Error('交接准备已变化，请重新发起。')
      const prepared = JSON.parse(row.value) as Extract<HandoffPreparation, { kind: 'ready' }>
      const existing = this.existing(owner, prepared.request)
      if (existing) return existing
      const request = this.validate(owner, prepared.request)
      const topic = this.store.assignTopic(request.recipientId, prepared.work.description, '', prepared.work.requestLog, prepared.work.tokens)
      const value: Handoff = { id: randomUUID(), source: request.source, recipientId: request.recipientId, topicId: topic.id, description: prepared.work.description, createdAt: Date.now(), continuous: prepared.work.continuous }
      this.store.db.prepare('INSERT INTO contact_handoffs VALUES(?,?,?,?,?)').run(value.id, owner, request.requestId, JSON.stringify(request), JSON.stringify(value))
      return value
    })()
  }
  list(owner: string, topicId?: string): Handoff[] {
    return (this.store.db.prepare("SELECT value FROM contact_handoffs WHERE owner=? OR json_extract(value,'$.recipientId')=? ORDER BY rowid DESC").all(owner, owner) as { value: string }[]).map(row => JSON.parse(row.value) as Handoff).filter(h => !topicId || h.source.characterId === owner && h.source.topicId === topicId || h.recipientId === owner && h.topicId === topicId)
  }
  get(owner: string, id: string) { const value = this.list(owner).find(h => h.id === id); if (!value) throw new Error('找不到此联系人的交接记录。'); return value }
}
