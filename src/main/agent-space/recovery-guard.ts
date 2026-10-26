import { createHash } from 'node:crypto'
import type { ContactRecoveryIdentity, ContactRecoveryOwner, ContactRecoveryRecord, RecoveryAllowance, RecoveryRequest, RecoveryReview } from '../../shared/contact-recovery'

const currentKey = 'contact-recovery:current'
const key = (id: string) => 'contact-recovery:' + id
const day = () => { const date = new Date(); return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-') }
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\r\n\0]/.test(id)
const allowance = (value: RecoveryAllowance | undefined) => {
  if (!value) return
  if (![value.calls, value.tokens].every(n => Number.isSafeInteger(n) && n >= 0) || value.calls > 10000 || value.tokens > 1000000000) throw new Error('恢复后新增额度无效。')
  return { calls: value.calls, tokens: value.tokens }
}
/** Application-owned authorization. No task-database snapshot can roll this back. */
export class ContactRecoveryGuard {
  constructor(private read: (key: string) => string | null, private write: (key: string, value: string) => void) {}
  current(): ContactRecoveryRecord | undefined {
    const id = this.read(currentKey)
    if (!id) return
    const raw = this.read(key(id))
    if (!raw) throw new Error('恢复保护记录缺失，联系人工作保持停止。')
    const value = JSON.parse(raw) as ContactRecoveryRecord
    if (value.restoreId !== id || value.unknownHistory !== true || !value.owners || !value.requests || !value.grants) throw new Error('恢复保护记录无效。')
    return value
  }
  begin(group: string, restoreId: string, owners: string[]) {
    if (![group, restoreId, ...owners].every(validId)) throw new Error('恢复归属无效。')
    if (this.read(key(restoreId))) {
      const existing = this.current()
      if (existing?.restoreId === restoreId && existing.group === group) return
      throw new Error('恢复记录已存在且不属于当前恢复，保持停止。')
    }
    const value: ContactRecoveryRecord = { group, restoreId, at: Date.now(), unknownHistory: true,
      owners: Object.fromEntries(owners.map(owner => [owner, { tasks: {}, daily: {}, allowances: {} }])), grants: {}, requests: {} }
    this.write(key(restoreId), JSON.stringify(value))
    this.write(currentKey, restoreId)
  }
  private require(restoreId: string, owner: string): [ContactRecoveryRecord, ContactRecoveryOwner] {
    const value = this.current()
    if (!value || value.restoreId !== restoreId) throw new Error('恢复记录已变化，请重新读取。')
    if (!Object.hasOwn(value.owners, owner)) throw new Error('联系人不在本次恢复范围。')
    return [value, value.owners[owner]]
  }
  identity(owner: string): ContactRecoveryIdentity | undefined {
    const value = this.current(), own = value?.owners[owner]
    if (!value || !own) return
    return { restoreId: value.restoreId, scopeReviewed: Boolean(own.scopeReviewedAt),
      allowedTopics: Object.entries(own.tasks).filter(([id, review]) => review.externalEffects === 'verified' && own.scopeReviewedAt
        && own.daily[day()]?.calls > 0 && own.daily[day()]?.tokens > 0 && own.allowances[id]?.calls > 0 && own.allowances[id]?.tokens > 0).map(([id]) => id),
      additional: { day: day(), daily: own.daily[day()] ?? { calls: 0, tokens: 0 }, tasks: structuredClone(own.allowances) } }
  }
  assertContext(owner: string, topicId?: string) {
    const value = this.current(), own = value?.owners[owner]
    if (!value || !own) return
    if (!own.scopeReviewedAt || topicId && !own.tasks[topicId]) throw new Error('恢复后的资料、权限和任务尚待核对，暂不提供给模型。')
  }
  review(input: RecoveryReview) {
    const [value, own] = this.require(input.restoreId, input.owner)
    if (![input.requestId, input.topicId].every(validId) || typeof input.scopesReviewed !== 'boolean'
      || !['verified', 'unresolved'].includes(input.externalEffects) || typeof input.evidence !== 'string' || input.evidence.trim().length < 10 || input.evidence.length > 4000) throw new Error('请记录实际核对的资料、权限和外部操作结果。')
    const daily = allowance(input.daily), task = allowance(input.task)
    const fingerprint = createHash('sha256').update(JSON.stringify({ owner: input.owner, topicId: input.topicId, scopesReviewed: input.scopesReviewed,
      externalEffects: input.externalEffects, evidence: input.evidence, daily, task })).digest('hex')
    const previous = value.grants[input.requestId]
    if (previous) { if (previous !== fingerprint) throw new Error('同一核对请求不能变更授权内容。'); return value }
    if (input.scopesReviewed) own.scopeReviewedAt = Date.now()
    own.tasks[input.topicId] = { reviewedAt: Date.now(), externalEffects: input.externalEffects, evidence: input.evidence.trim() }
    const add = (target: Record<string, RecoveryAllowance>, id: string, extra: RecoveryAllowance | undefined) => {
      if (extra) { const before = target[id] ?? { calls: 0, tokens: 0 }; target[id] = { calls: before.calls + extra.calls, tokens: before.tokens + extra.tokens } }
    }
    add(own.daily, day(), daily); add(own.allowances, input.topicId, task)
    value.grants[input.requestId] = fingerprint
    this.write(key(value.restoreId), JSON.stringify(value))
    return value
  }
  reserve(input: RecoveryRequest) {
    const [value, own] = this.require(input.restoreId, input.owner)
    if (![input.requestId, input.topicId].every(validId) || !Number.isSafeInteger(input.tokens) || input.tokens < 0) throw new Error('恢复请求额度无效。')
    this.assertContext(input.owner, input.topicId)
    if (own.tasks[input.topicId]?.externalEffects !== 'verified') throw new Error('尚有未核实的外部操作，不能继续执行。')
    const previous = value.requests[input.requestId]
    if (previous) {
      if (previous.owner !== input.owner || previous.topicId !== input.topicId || previous.reservedTokens !== input.tokens) throw new Error('恢复请求身份冲突。')
      return
    }
    const today = day(), daily = own.daily[today], task = own.allowances[input.topicId]
    const requests = Object.values(value.requests).filter(request => request.owner === input.owner)
    const fits = (budget: RecoveryAllowance | undefined, relevant: typeof requests) => budget && relevant.length < budget.calls
      && relevant.reduce((sum, request) => sum + request.tokens, 0) + input.tokens <= budget.tokens
    if (!fits(daily, requests.filter(request => request.day === today)) || !fits(task, requests.filter(request => request.topicId === input.topicId))) throw new Error('恢复后新增额度不足；历史用量仍不完整，需分别核对今日与本任务的新增授权。')
    value.requests[input.requestId] = { owner: input.owner, topicId: input.topicId, day: today, tokens: input.tokens, reservedTokens: input.tokens, settled: false }
    this.write(key(value.restoreId), JSON.stringify(value))
  }
  settle(restoreId: string, requestId: string, tokens?: number) {
    const value = this.current()
    if (!value || value.restoreId !== restoreId) throw new Error('恢复记录已变化。')
    const reservation = value.requests[requestId]
    if (!reservation) throw new Error('缺少恢复请求的用量预留。')
    if (tokens === undefined) return // Unknown usage retains the full reservation, never zero.
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('请求用量无效。')
    if (reservation.settled) { if (reservation.tokens !== tokens) throw new Error('请求用量已结算。'); return }
    reservation.tokens = tokens; reservation.settled = true
    this.write(key(value.restoreId), JSON.stringify(value))
  }
}
