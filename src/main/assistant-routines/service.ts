import { randomUUID } from 'node:crypto'
import { nextRoutineAt, validateRoutine, type AssistantRoutine, type AssistantRoutineExecution, type AssistantRoutineHistoryPage } from '../../shared/assistant-routines'

interface Dependencies {
  read(): string | undefined | null
  write(value: string): void
  readHistory(id: string): string | undefined | null
  writeHistory(id: string, value: string): void
  generate(item: AssistantRoutine, signal: AbortSignal): Promise<string>
  deliver(receipt: string, content: string): { sessionId: string; messageId: string } | void
}
export class AssistantRoutineService {
  private busy = false
  private controller?: AbortController
  private closed = false
  private executionId?: string
  constructor(private deps: Dependencies) {}
  private records(id: string): AssistantRoutineExecution[] {
    const records = JSON.parse(this.deps.readHistory(id) || '[]')
    if (!Array.isArray(records) || records.some(r => !r || typeof r.id !== 'string' || !Number.isFinite(r.startedAt) || !['running', 'completed', 'failed', 'cancelled'].includes(r.status))) throw new Error('执行历史无法读取，请恢复数据后重试。')
    return records
  }
  history(id: string, before?: number): AssistantRoutineHistoryPage {
    if (!this.list().some(item => item.id === id)) throw new Error('任务已删除或不存在。')
    const records = this.records(id).map(entry => {
      if (entry.status !== 'running' || entry.id === this.executionId && !this.closed) return entry
      const interrupted: AssistantRoutineExecution = { ...entry, status: 'failed', error: '上次执行被应用退出中断，尚未完成。' }
      this.record(id, interrupted)
      return interrupted
    })
    const end = before === undefined ? records.length : before
    if (!Number.isInteger(end) || end < 0 || end > records.length) throw new Error('历史分页无效。')
    const start = Math.max(0, end - 20)
    return { items: records.slice(start, end).reverse(), nextCursor: start > 0 ? start : undefined }
  }
  private record(id: string, entry: AssistantRoutineExecution) {
    const records = this.records(id), index = records.findIndex(r => r.id === entry.id)
    if (index < 0) records.push(entry); else records[index] = entry
    this.deps.writeHistory(id, JSON.stringify(records))
  }
  list(): AssistantRoutine[] {
    const raw = this.deps.read()
    if (!raw) return []
    const value = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 50 || new Set(value.map(v => v?.id)).size !== value.length || value.some(v => !v || typeof v.id !== 'string' || !v.id || !Number.isInteger(v.revision) || v.revision < 1 || !Number.isFinite(v.nextAt) || v.pending && (!Number.isFinite(v.pending.dueAt) || typeof v.pending.content !== 'string' || !v.pending.content.trim() || v.pending.content.length > 18000))) throw new Error('助手安排无法读取，请恢复数据后重试。')
    value.forEach(validateRoutine)
    return value
  }
  save(raw: unknown, id?: string, revision?: number, now = Date.now()) {
    const input = validateRoutine(raw), items = this.list()
    const previous = id ? items.find(i => i.id === id) : undefined
    if (id && (!previous || previous.revision !== revision)) throw new Error('安排已变化，请刷新后再修改。')
    if (!id && items.length >= 50) throw new Error('最多保存 50 项助手安排。')
    const item: AssistantRoutine = { ...input, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? (previous ? undefined : now), updatedAt: now, nextAt: nextRoutineAt(input, now), lastAt: previous?.lastAt, lastResult: previous?.lastResult }
    const next = previous ? items.map(i => i.id === id ? item : i) : [...items, item]
    this.deps.write(JSON.stringify(next))
    return next
  }
  remove(id: string, revision: number) {
    const items = this.list(), item = items.find(i => i.id === id)
    if (!item || item.revision !== revision) throw new Error('安排已变化，请刷新后再删除。')
    const next = items.filter(i => i.id !== id)
    this.deps.write(JSON.stringify(next)); return next
  }
  close() { this.closed = true; this.controller?.abort() }
  async tick(now = Date.now()) {
    if (this.busy || this.closed) return
    const startedAt = Date.now()
    this.busy = true
    try {
      for (const item of this.list()) {
        if (this.closed) break
        if (!item.enabled || item.nextAt > now || (item.retryAt ?? 0) > now) continue
        const dueAt = item.pending?.dueAt ?? item.nextAt
        const entry: AssistantRoutineExecution = { id: randomUUID(), receipt: `routine:${item.id}:${item.revision}:${dueAt}`, title: item.title, scheduledAt: dueAt, startedAt: now + Math.max(0, Date.now() - startedAt), status: 'running' }
        this.executionId = entry.id
        try {
          // A crash leaves an honest interrupted attempt, never a false completion.
          for (const previous of this.records(item.id).filter(r => r.status === 'running')) this.record(item.id, { ...previous, status: 'failed', finishedAt: entry.startedAt, error: '上次执行被应用退出中断，本次重新接续。' })
          this.record(item.id, entry)
          this.controller = new AbortController()
          const content = item.pending?.content ?? (item.kind === 'reminder' ? item.instruction : await this.deps.generate(item, this.controller.signal))
          if (!content.trim() || content.length > 18000) throw new Error('助手没有生成有效结果。')
          if (this.closed) break
          let items = this.list(), current = items.find(i => i.id === item.id)
          // Editing/pausing/deleting while the model works invalidates that result.
          if (!current?.enabled || current.revision !== item.revision) { this.record(item.id, { ...entry, status: 'cancelled', finishedAt: now + Math.max(0, Date.now() - startedAt), error: '任务已修改、暂停或删除，本次结果未发送。' }); continue }
          const dueAt = current.pending?.dueAt ?? item.nextAt
          current.pending = { dueAt, content }
          this.deps.write(JSON.stringify(items))
          const target = this.deps.deliver(entry.receipt, `${item.title}\n\n${content}`)
          Object.assign(entry, target)
          items = this.list(); current = items.find(i => i.id === item.id)!
          const completedAt = now + Math.max(0, Date.now() - startedAt)
          current.lastAt = completedAt; current.lastResult = content; current.lastError = undefined; current.pending = undefined
          this.record(item.id, { ...entry, status: 'completed', finishedAt: completedAt, content })
          current.nextAt = nextRoutineAt(current, completedAt); current.retryAt = undefined; current.failures = 0
          this.deps.write(JSON.stringify(items))
        } catch (error) {
          if (this.closed) break
          this.record(item.id, { ...entry, status: 'failed', finishedAt: now + Math.max(0, Date.now() - startedAt), error: error instanceof Error ? error.message : '执行失败。' })
          const items = this.list(), current = items.find(i => i.id === item.id)
          if (current?.revision === item.revision) {
            current.lastError = error instanceof Error ? error.message : '执行失败，将在 15 分钟后重试。'
            current.failures = (current.failures ?? 0) + 1
            current.retryAt = now + Math.min(24 * 60, 15 * 2 ** Math.min(current.failures - 1, 7)) * 60000
            this.deps.write(JSON.stringify(items))
          }
        }
      }
    } finally { this.busy = false; this.controller = undefined; this.executionId = undefined }
  }
}
