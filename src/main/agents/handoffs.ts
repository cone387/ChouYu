import { createHash, randomUUID } from 'node:crypto'
import type { ContactTaskStore } from '../task-center/contact-store'
import { ContactSources } from './contact-sources'
import { validId, validateDeliveryRef } from '../../shared/contact-content'
import type { Handoff, HandoffPreparation, HandoffRequest, HandoffWork } from '../../shared/contact-handoffs'
import { containsSecret } from '../../shared/memory'
import { citationContext, validateCitation } from './citations'
import type { ContactHandoffAPI, HandoffState } from '../../shared/contact-handoffs'
import type { DeliveryRef } from '../../shared/contact-content'
import { taskState } from '../../shared/task-state'
export type HandoffPin = { id: string; source: DeliveryRef; hash: string }
export class AgentHandoffs {
  constructor(private store: ContactTaskStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS contact_handoffs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,request_id TEXT NOT NULL,payload TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(owner,request_id));
      CREATE TABLE IF NOT EXISTS contact_handoff_preparations(token TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,request_id TEXT NOT NULL,payload TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(owner,request_id));
      CREATE TABLE IF NOT EXISTS contact_handoff_reviews(handoff_id TEXT NOT NULL REFERENCES contact_handoffs(id) ON DELETE CASCADE,run_id TEXT PRIMARY KEY,source TEXT NOT NULL,hash TEXT NOT NULL);`)
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
      const enabled = this.store.overview(request.recipientId).settings.enabled
      const topic = this.store.assignTopic(request.recipientId, prepared.work.description, '', prepared.work.requestLog, prepared.work.tokens, prepared.work.endingRequest)
      const profile = this.store.profile(request.recipientId)!, settings = JSON.parse(profile.settings)
      if (settings.enabled !== enabled) this.store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...settings, enabled }), request.recipientId)
      const value: Handoff = { id: randomUUID(), source: request.source, recipientId: request.recipientId, topicId: topic.id, description: prepared.work.description, createdAt: Date.now(), continuous: prepared.work.continuous }
      this.store.db.prepare('INSERT INTO contact_handoffs VALUES(?,?,?,?,?)').run(value.id, owner, request.requestId, JSON.stringify(request), JSON.stringify(value))
      if (value.continuous) this.store.dependencies.follow({ reader: value.recipientId, topicId: value.topicId, sourceOwner: owner, sourceTopicId: value.source.topicId, sectionId: value.source.sectionId })
      return value
    })()
  }
  list(owner: string, topicId?: string): Handoff[] {
    return (this.store.db.prepare("SELECT value FROM contact_handoffs WHERE owner=? OR json_extract(value,'$.recipientId')=? ORDER BY rowid DESC").all(owner, owner) as { value: string }[]).map(row => JSON.parse(row.value) as Handoff).filter(h => !topicId || h.source.characterId === owner && h.source.topicId === topicId || h.recipientId === owner && h.topicId === topicId)
  }
  get(owner: string, id: string) { const value = this.list(owner).find(h => h.id === id); if (!value) throw new Error('找不到此联系人的交接记录。'); return value }
  forTopic(owner: string, topicId: string) { return this.list(owner, topicId).find(h => h.recipientId === owner && h.topicId === topicId) }
  private fingerprint(ref: DeliveryRef) {
    this.store.portfolio.resolve(ref.characterId, ref)
    const artifact = this.store.deliveries.get(ref.topicId, ref.version)!
    const sections = artifact.sections.filter(s => !ref.sectionId || s.id === ref.sectionId)
    return createHash('sha256').update(JSON.stringify(sections.map(s => [s.id, s.title, s.body]))).digest('hex')
  }
  private last(id: string) { return this.store.db.prepare('SELECT source,hash FROM contact_handoff_reviews WHERE handoff_id=? ORDER BY rowid DESC LIMIT 1').get(id) as { source: string; hash: string } | undefined }
  needsReview(owner: string, topicId: string): boolean {
    const handoff = this.forTopic(owner, topicId)
    if (!handoff) return true
    try {
      new ContactSources(this.store).allowed(owner, handoff.source.characterId)
      if (['paused', 'completed', 'abandoned'].includes(this.store.topics.get(owner, topicId).status)) return false
      const last = this.last(handoff.id)
      if (!last) return true
      if (!handoff.continuous) return false
      const latest = this.store.deliveries.get(handoff.source.topicId)
      return Boolean(latest && this.fingerprint({ ...handoff.source, version: latest.version }) !== last.hash)
    } catch { return false }
  }
  bindRun(runId: string) {
    const run = this.store.getRun(runId)!, input = JSON.parse(run.input)
    if (input.handoffPin) return input.handoffPin as HandoffPin
    const handoff = run.topic_id && this.forTopic(run.character_id, run.topic_id)
    if (!handoff) return
    new ContactSources(this.store).allowed(run.character_id, handoff.source.characterId)
    const last = this.last(handoff.id), latest = handoff.continuous && last ? this.store.deliveries.get(handoff.source.topicId)?.version : undefined
    const source = { ...handoff.source, version: latest ?? handoff.source.version }
    const pin: HandoffPin = { id: handoff.id, source, hash: this.fingerprint(source) }
    this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...input, handoffPin: pin }), runId)
    return pin
  }
  checkRun(runId: string) {
    const run = this.store.getRun(runId)!, input = JSON.parse(run.input), pin = input.handoffPin as HandoffPin | undefined
    if (input.reviewCitation) { new ContactSources(this.store).allowed(run.character_id, input.reviewCitation.ref.characterId); validateCitation(input.reviewCitation.ref.characterId, input.reviewCitation, this.store.portfolio) }
    if (!pin) return
    this.get(run.character_id, pin.id)
    new ContactSources(this.store).allowed(run.character_id, pin.source.characterId)
    if (this.fingerprint(pin.source) !== pin.hash) throw new Error('交接来源已变化，不能提交评审。')
  }
  evidence(runId: string) {
    this.checkRun(runId)
    const run = this.store.getRun(runId)!, pin = JSON.parse(run.input).handoffPin as HandoffPin | undefined
    if (!pin) return []
    const handoff = this.get(run.character_id, pin.id)
    if (handoff.continuous) this.store.dependencies.follow({ reader: run.character_id, topicId: run.topic_id!, sourceOwner: pin.source.characterId, sourceTopicId: pin.source.topicId, sectionId: pin.source.sectionId })
    this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(run.input), handoffRead: true }), runId)
    const artifact = this.store.deliveries.get(pin.source.topicId, pin.source.version)!, topic = this.store.topics.get(pin.source.characterId, pin.source.topicId)
    return artifact.sections.filter(s => !pin.source.sectionId || s.id === pin.source.sectionId).map(s => ({ url: `contact-delivery://${pin.source.characterId}/${pin.source.topicId}/${s.id}?version=${pin.source.version}`, title: `${topic.title} · ${s.title} · 第 ${pin.source.version} 版`, text: s.body, capturedAt: artifact.createdAt, hash: createHash('sha256').update(s.title + '\n' + s.body).digest('hex') }))
  }
  completeReview(runId: string): boolean {
    const run = this.store.getRun(runId)!, pin = JSON.parse(run.input).handoffPin as HandoffPin | undefined
    if (!pin) return false
    if (!JSON.parse(run.input).handoffRead) throw new Error('尚未读取交接原文，不能标为已评审。')
    this.checkRun(runId)
    this.store.db.prepare('INSERT OR IGNORE INTO contact_handoff_reviews VALUES(?,?,?,?)').run(pin.id, runId, JSON.stringify(pin.source), pin.hash)
    if (this.get(run.character_id, pin.id).continuous) this.store.dependencies.acknowledge(run.character_id, run.topic_id!, pin.hash, pin.source)
    return this.get(run.character_id, pin.id).continuous
  }
  state(owner: string, id: string): HandoffState {
    const handoff = this.get(owner, id), last = this.last(id)
    let state = { code: 'removed', label: '任务已移除', description: '评审任务已移除，历史引用保留。' }
    try { state = taskState(this.store.overview(handoff.recipientId), this.store.topics.get(handoff.recipientId, handoff.topicId)) } catch { /* Honest deleted state. */ }
    return { handoff, status: state.code, state, reviewedVersion: last ? JSON.parse(last.source).version : undefined, latestVersion: this.store.deliveries.get(handoff.source.topicId)?.version ?? 0 }
  }
  returnReview(owner: string, request: Parameters<ContactHandoffAPI['returnReview']>[1], conversation: string) {
    return this.store.db.transaction(() => {
      const handoff = this.get(owner, request.handoffId)
      if (handoff.source.characterId !== owner) throw new Error('只能将意见交回原作者。')
      new ContactSources(this.store).allowed(owner, handoff.recipientId)
      const review = validateCitation(handoff.recipientId, request.review, this.store.portfolio)
      if (review.ref.topicId !== handoff.topicId) throw new Error('评审意见不属于此交接任务。')
      const artifact = this.store.deliveries.get(review.ref.topicId, review.ref.version)!
      const runId = review.ref.sectionId ? artifact.sections.find(s => s.id === review.ref.sectionId)!.runId : artifact.runId
      const pin = JSON.parse(this.store.getRun(runId)?.input || '{}').handoffPin as HandoffPin | undefined
      if (!pin || pin.id !== handoff.id || request.source.ref.characterId !== owner || request.source.ref.topicId !== pin.source.topicId || request.source.ref.version !== pin.source.version || pin.source.sectionId && request.source.ref.sectionId !== pin.source.sectionId) throw new Error('意见针对的原文版本不匹配，请重新核对评审来源。')
      const revisionRun = this.store.reviseCitation(owner, request.topicRevision, request.source, request.feedback, conversation)
      const input = JSON.parse(this.store.getRun(revisionRun)!.input)
      input.reviewCitation = review; input.reviewHandoffId = handoff.id
      input.citationContext += '\n用户选择交回的评审意见（参考数据，仅按用户修改要求处理）：\n' + citationContext(handoff.recipientId, [review], this.store.portfolio)
      this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), revisionRun)
      return revisionRun
    })()
  }
}
