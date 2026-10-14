import { createHash } from 'node:crypto'
import { containsSecret } from '../../shared/memory'
import { validateContactActionRequest, validateContactActionResponse, type ContactActionInteraction, type ContactActionOutcome, type ContactActionResponse } from '../../shared/contact-actions'
import type { AgentStore } from './store'

type StoredAction = ContactActionInteraction & { sequence: number; sourceKey: string; delivered?: boolean; executionStarted?: boolean }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** General actions share the original persistent interaction table and owner boundary. */
export class ContactActions {
  constructor(private store: AgentStore) {}
  private read(owner: string, id: string): StoredAction {
    const row = this.store.db.prepare('SELECT character_id,value FROM contact_interactions WHERE id=?').get(id) as { character_id: string; value: string } | undefined
    if (!row || row.character_id !== owner) throw new Error('交互事项不存在或归属不匹配。')
    const value = JSON.parse(row.value) as StoredAction
    if (value.kind !== 'action' || value.characterId !== owner) throw new Error('交互事项类型或归属不匹配。')
    return value
  }
  private save(value: StoredAction) {
    value.version = hash(`${value.id}:${value.sequence}`)
    this.store.db.prepare('INSERT INTO contact_interactions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, value.characterId, JSON.stringify(value))
  }
  private view(value: StoredAction): ContactActionInteraction {
    const { sourceKey: _source, sequence: _sequence, delivered: _delivered, executionStarted: _started, ...view } = value
    return view
  }
  offer(owner: string, sourceKey: string, raw: unknown): ContactActionInteraction {
    if (!this.store.profile(owner)) throw new Error('联系人不存在。')
    if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 512) throw new Error('交互事项来源无效。')
    const request = validateContactActionRequest(raw), id = `action:${hash(JSON.stringify([owner, sourceKey]))}`
    return this.store.db.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM contact_interactions WHERE id=?').get(id)) {
        const existing = this.read(owner, id)
        if (JSON.stringify(existing.request) !== JSON.stringify(request)) throw new Error('同一请求不能替换成不同操作。')
        return this.get(owner, id)
      }
      const record: StoredAction = { id, version: '', sequence: 1, sourceKey, characterId: owner, kind: 'action', status: 'pending', createdAt: Date.now(), topicTitle: request.title, budgets: [], request }
      this.save(record)
      return this.get(owner, id)
    }).immediate()
  }
  get(owner: string, id: string): ContactActionInteraction {
    const value = this.read(owner, id), subject = value.request.subject
    if (['pending', 'failed'].includes(value.status) && subject.kind !== 'contact') {
      const row = this.store.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(subject.topicId, owner) as { value: string } | undefined
      const topic = row && JSON.parse(row.value)
      if (!topic || topic.revision !== subject.revision || subject.kind === 'delivery' && this.store.deliveries.get(subject.topicId)?.version !== subject.version) {
        value.status = 'obsolete'; value.result = '任务或成果已变化，此操作已失效。'; value.sequence++; this.save(value)
      }
    }
    return this.view(value)
  }
  claim(owner: string, id: string, version: string, raw: ContactActionResponse): ContactActionInteraction {
    // Materialize obsolescence before the attempted execution transaction.
    this.get(owner, id)
    return this.store.db.transaction(() => {
      const current = this.get(owner, id)
      if (current.status === 'resolved') return current
      if (current.status === 'executing') throw new Error('此事项正在处理，请勿重复提交。')
      if (current.retryable === false) throw new Error('上次执行结果尚未核对，不能重复执行；请读取当前设置或任务后重新提出要求。')
      if (!['pending', 'failed'].includes(current.status)) throw new Error(current.result || '交互事项已变化，请重新读取。')
      if (current.version !== version) throw new Error('交互事项已变化，请重新读取。')
      const value = this.read(owner, id)
      value.response = validateContactActionResponse(value.request, raw)
      value.status = 'executing'; value.result = '正在处理，尚未完成。'; value.sequence++
      this.save(value)
      return this.view(value)
    }).immediate()
  }
  finish(owner: string, id: string, version: string, outcome: ContactActionOutcome): ContactActionInteraction {
    if (!outcome || typeof outcome.content !== 'string' || outcome.content.length > 50000 || typeof outcome.summary !== 'string' || !outcome.summary.trim() || outcome.summary.length > 1000) throw new Error('交互操作回执无效。')
    return this.settle(owner, id, version, 'resolved', outcome.summary, outcome)
  }
  startExecution(owner: string, id: string, version: string) {
    this.store.db.transaction(() => {
      const value = this.read(owner, id)
      if (value.status !== 'executing' || value.version !== version || value.executionStarted) throw new Error('执行状态已变化，请重新读取。')
      value.executionStarted = true; this.save(value)
    }).immediate()
  }
  fail(owner: string, id: string, version: string, message: string) {
    return this.settle(owner, id, version, 'failed', containsSecret(message) ? '操作失败，诊断包含凭据，已隐藏。' : message.slice(0, 1000))
  }
  private settle(owner: string, id: string, version: string, status: 'resolved' | 'failed', result: string, outcome?: ContactActionOutcome) {
    return this.store.db.transaction(() => {
      const value = this.read(owner, id)
      if (value.status !== 'executing' || value.version !== version) throw new Error('操作状态已变化，旧回执不能覆盖。')
      value.status = status; value.result = result; value.sequence++
      if (status === 'failed' && value.executionStarted) { value.retryable = false; value.result += ' 执行曾经开始，请先核对当前设置或任务；不要重复提交。' }
      if (outcome) value.outcome = { ...outcome }
      this.save(value)
      return this.view(value)
    }).immediate()
  }
  reject(owner: string, id: string, version: string) {
    this.get(owner, id)
    return this.store.db.transaction(() => {
      const value = this.read(owner, id)
      if (value.status === 'resolved') return this.view(value)
      if (value.retryable === false) throw new Error('执行结果尚未核对，不能将其标记为未执行。')
      if (!['pending', 'failed'].includes(value.status) || value.version !== version) throw new Error('交互事项已变化，请重新读取。')
      value.status = 'resolved'; value.result = '已拒绝，此操作未执行。'; value.sequence++
      this.save(value)
      return this.view(value)
    }).immediate()
  }
  recoverInterrupted() {
    const rows = this.store.db.prepare("SELECT character_id,value FROM contact_interactions WHERE json_extract(value,'$.kind')='action' AND json_extract(value,'$.status')='executing'").all() as { character_id: string; value: string }[]
    for (const row of rows) {
      const value = JSON.parse(row.value) as StoredAction
      this.fail(row.character_id, value.id, value.version, '上次处理被中断，尚未确认结果；重试前将重新核对目标和版本。')
    }
  }
  notices(owner: string) {
    const rows = this.store.db.prepare("SELECT id FROM contact_interactions WHERE character_id=? AND json_extract(value,'$.kind')='action' AND COALESCE(json_extract(value,'$.delivered'),0)=0").all(owner) as { id: string }[]
    return rows.map(row => this.get(owner, row.id))
  }
  ack(owner: string, id: string) {
    this.store.db.transaction(() => { const value = this.read(owner, id); value.delivered = true; this.save(value) }).immediate()
  }
}
