import { createHash } from 'node:crypto'
import { validateReminderMinutes, type ReminderAction, type ReminderItem, type ReminderSourceState, type ReminderView } from '../../shared/reminder-followups'

export interface FollowupPorts {
  items(): ReminderItem[]
  save(items: ReminderItem[]): void
  source(item: ReminderItem): Promise<ReminderSourceState>
  sourceVersion?(item: ReminderItem): number
  complete(item: ReminderItem): Promise<void>
  markRead(item: ReminderItem): void
  isRead(item: ReminderItem): boolean
  deliver(items: ReminderItem[], receipt: string): void
  delivered(receipt: string): boolean
  changed(): void
  now?(): number
}
/** One persistent item per source, with separately acknowledged delivery attempts. */
export class FollowupService {
  private running = false
  private stopped = false
  private actions = new Set<string>()
  constructor(private ports: FollowupPorts) {}
  private now() { return this.ports.now?.() ?? Date.now() }
  private current(id: string) { return this.ports.items().find(item => item.id === id) }
  private unchanged(item: ReminderItem) { return !this.stopped && this.current(item.id)?.revision === item.revision }
  private changed() { try { this.ports.changed() } catch { /* Durable state remains authoritative; the next poll refreshes UI. */ } }
  private save(item: ReminderItem, patch: Partial<ReminderItem>): ReminderItem {
    if (!this.unchanged(item)) throw new Error('提醒状态已变化，请刷新后重试。')
    const next = { ...item, ...patch, revision: item.revision + 1 }
    this.ports.save([next]); this.changed(); return next
  }
  private async reconcile(item: ReminderItem): Promise<ReminderItem | undefined> {
    if (item.status !== 'pending') return item
    try {
      const source = await this.ports.source(item)
      if (!this.unchanged(item)) return
      if (source.status !== 'pending') return this.save(item, { status: source.status, reason: source.reason, processedAt: this.now(), error: undefined })
      if (item.error || source.label && source.label !== item.label || source.location && (source.location.sessionId !== item.sessionId || source.location.messageId !== item.messageId)) return this.save(item, { error: undefined, ...(source.label ? { label: source.label } : {}), ...(source.location ?? {}) })
      return item
    } catch (error) {
      if (this.unchanged(item)) {
        const message = error instanceof Error ? error.message : '提醒来源读取失败。'
        if (item.error !== message) { try { this.save(item, { error: message }) } catch { /* Preserve the original durable item. */ } }
      }
      return
    }
  }
  async list(sessionId?: string): Promise<ReminderView[]> {
    const belongs = (item: ReminderItem) => !sessionId || item.sessionId === sessionId || item.locations?.some(location => location.sessionId === sessionId)
    const items = this.ports.items().filter(belongs)
    // Local reconciliation is also used when the user opens a message after acting elsewhere.
    for (const item of items) if (!this.actions.has(item.id)) await this.reconcile(item)
    return this.ports.items().filter(belongs).map(item => ({ ...item, read: this.ports.isRead(item) }))
  }
  async act(id: string, revision: number, action: ReminderAction, minutes?: number): Promise<ReminderView> {
    if (this.stopped) throw new Error('提醒服务正在关闭。')
    if (!['read', 'acknowledge', 'complete', 'postpone', 'interval', 'resume'].includes(action)) throw new Error('提醒操作无效。')
    let item = this.current(id)
    if (!item || item.revision !== revision) throw new Error('提醒状态已变化，请刷新后重试。')
    if (this.actions.has(id)) throw new Error('这条提醒正在处理，请稍候。')
    if (action === 'interval' || action === 'postpone') validateReminderMinutes(minutes)
    this.actions.add(id)
    try {
      if (action === 'read') { this.ports.markRead(item); this.changed(); return { ...item, read: true } }
      if (item.status !== 'pending') return { ...item, read: this.ports.isRead(item) }
      const source = await this.ports.source(item)
      if (!this.unchanged(item)) throw new Error('提醒状态已变化，请刷新后重试。')
      if (source.status !== 'pending') item = this.save(item, { status: source.status, reason: source.reason, processedAt: this.now(), error: undefined })
      else if (action === 'acknowledge') {
        if (!['received', 'done'].includes(item.acknowledgement)) throw new Error('请通过原事项完成实际处理，阅读不能代替处理。')
        item = this.save(item, { status: 'processed', processedAt: this.now(), reason: item.acknowledgement === 'received' ? '已明确接收' : '用户确认已处理', error: undefined })
      } else if (action === 'complete') {
        if (item.source.kind !== 'todo') throw new Error('请通过原事项完成实际处理。')
        await this.ports.complete(item)
        if (!this.unchanged(item)) throw new Error('任务操作已执行，请刷新核对提醒状态。')
        const resolved = await this.ports.source(item)
        if (resolved.status === 'pending') throw new Error('尚未确认任务已完成，请核对原任务。')
        item = this.save(item, { status: resolved.status, reason: resolved.reason, processedAt: this.now(), error: undefined })
      } else if (action === 'postpone') item = this.save(item, { nextAt: this.now() + minutes! * 60000, postponed: true, error: undefined })
      else if (action === 'interval') item = this.save(item, { intervalMinutes: minutes!, nextAt: this.now() + minutes! * 60000, postponed: false, error: undefined })
      else item = this.save(item, { nextAt: this.now() + item.intervalMinutes * 60000, postponed: false, error: undefined })
      if (item.status === 'processed') this.ports.markRead(item)
      this.changed()
      return { ...item, read: this.ports.isRead(item) }
    } finally { this.actions.delete(id) }
  }
  stop() { this.stopped = true }
  async tick(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      const candidates: ReminderItem[] = []
      const versions = new Map<string, number>()
      for (const entry of this.ports.items()) {
        if (this.stopped) return
        if (entry.status !== 'pending' || this.actions.has(entry.id)) continue
        const version = this.ports.sourceVersion?.(entry) ?? 0
        const item = await this.reconcile(entry)
        if (!item || item.status !== 'pending' || item.error || item.nextAt > this.now()) continue
        versions.set(item.id, version)
        candidates.push(item)
      }
      for (const item of candidates) {
        // Recheck each item immediately before its own delivery, including after earlier deliveries.
        if (!this.unchanged(item) || this.actions.has(item.id) || versions.get(item.id) !== (this.ports.sourceVersion?.(item) ?? 0)) continue
        const due = [item]
        const receipt = createHash('sha256').update(JSON.stringify(due.map(item => [item.id, item.nextAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex')
        try {
          if (!this.ports.delivered(receipt)) this.ports.deliver(due, receipt)
          const now = this.now()
          this.ports.save(due.filter(item => this.unchanged(item)).map(item => ({ ...item, revision: item.revision + 1,
            nextAt: now + item.intervalMinutes * 60000, lastRemindedAt: now, postponed: false, error: undefined })))
          this.changed()
        } catch { /* Keep the due time and delivery receipt; recovery retries without duplicate messages. */ }
      }
    } finally { this.running = false }
  }
}
