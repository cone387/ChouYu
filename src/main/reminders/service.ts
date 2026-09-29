import { randomUUID } from 'node:crypto'
import { legacyAssistantMessageKind, type AssistantMessageKind } from '../../shared/assistant-message'
import { normalizeTaskReminderRef, reminderKey, type AssistantSnooze, type TaskReminderRef } from '../../shared/reminders'
export interface ReminderMessage { id: string; role: string; content: string; assistantKind?: AssistantMessageKind; taskReminder?: TaskReminderRef; snoozeKey?: string }
export interface ReminderDependencies {
  read(): string | null
  write(value: string): void
  message(sessionId: string, messageId: string): ReminderMessage | undefined
  task(ref: TaskReminderRef): string | null
  append(item: AssistantSnooze, content: string): void
  changed(): void
  now?(): number
}
/** Persist first; acknowledge only after the idempotent chat write succeeds. */
export class SnoozeService {
  constructor(private deps: ReminderDependencies) {}
  list(): AssistantSnooze[] {
    const raw = this.deps.read()
    if (!raw) return []
    const items: unknown = JSON.parse(raw)
    if (!Array.isArray(items)) throw new Error('稍后提醒记录无法读取，请先恢复数据。')
    return items.flatMap((raw: any) => {
      if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.content !== 'string' || !raw.content.trim() || !Number.isFinite(raw.dueAt)) return []
      return [{ id: raw.id, key: typeof raw.key === 'string' ? raw.key : `legacy:${raw.id}`, content: raw.content.slice(0, 20_000), dueAt: raw.dueAt, taskRef: normalizeTaskReminderRef(raw.taskRef) }]
    })
  }
  private save(items: AssistantSnooze[]): void {
    this.deps.write(JSON.stringify(items))
    this.deps.changed()
  }
  schedule(sessionId: string, messageId: string, minutes: number): AssistantSnooze {
    if (![10, 30, 60].includes(minutes)) throw new Error('请选择 10、30 或 60 分钟。')
    const message = this.deps.message(sessionId, messageId)
    const kind = message?.assistantKind ?? legacyAssistantMessageKind(message?.content ?? '')
    if (!message || message.role !== 'assistant' || !['rest', 'task', 'snooze'].includes(kind ?? '')) throw new Error('这条消息不支持稍后提醒。')
    if (message.taskReminder && !this.deps.task(message.taskReminder)) throw new Error('任务已完成、改期或移除，无需再次提醒。')
    const key = reminderKey(sessionId, message)
    const item: AssistantSnooze = { id: randomUUID(), key, content: message.content.replace(/^(?:⏰ )?稍后提醒：/u, ''), dueAt: (this.deps.now?.() ?? Date.now()) + minutes * 60_000, taskRef: message.taskReminder }
    this.save([...this.list().filter(old => old.key !== key), item])
    return item
  }
  cancel(key: string): void { this.save(this.list().filter(item => item.key !== key)) }
  tick(): void {
    const now = this.deps.now?.() ?? Date.now()
    for (const item of this.list()) {
      try {
        const title = item.taskRef ? this.deps.task(item.taskRef) : undefined
        if (title === null) { this.cancel(item.key); continue }
        if (item.dueAt > now) continue
        this.deps.append(item, `⏰ 稍后提醒：${title ? `任务提醒：${title}` : item.content}`)
        this.cancel(item.key)
      } catch { /* Preserve unacknowledged work; retry after storage recovery. */ }
    }
  }
}
