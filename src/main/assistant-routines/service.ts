import { randomUUID } from 'node:crypto'
import { nextRoutineAt, validateRoutine, type AssistantRoutine } from '../../shared/assistant-routines'

interface Dependencies {
  read(): string | undefined | null
  write(value: string): void
  generate(item: AssistantRoutine, signal: AbortSignal): Promise<string>
  deliver(receipt: string, content: string): void
}
export class AssistantRoutineService {
  private busy = false
  private controller?: AbortController
  private closed = false
  constructor(private deps: Dependencies) {}
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
    const item: AssistantRoutine = { ...input, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, nextAt: nextRoutineAt(input, now), lastAt: previous?.lastAt, lastResult: previous?.lastResult }
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
        try {
          this.controller = new AbortController()
          const content = item.pending?.content ?? (item.kind === 'reminder' ? item.instruction : await this.deps.generate(item, this.controller.signal))
          if (!content.trim() || content.length > 18000) throw new Error('助手没有生成有效结果。')
          if (this.closed) break
          let items = this.list(), current = items.find(i => i.id === item.id)
          // Editing/pausing/deleting while the model works invalidates that result.
          if (!current?.enabled || current.revision !== item.revision) continue
          const dueAt = current.pending?.dueAt ?? item.nextAt
          current.pending = { dueAt, content }
          this.deps.write(JSON.stringify(items))
          this.deps.deliver(`routine:${item.id}:${item.revision}:${dueAt}`, `${item.title}\n\n${content}`)
          items = this.list(); current = items.find(i => i.id === item.id)!
          const completedAt = now + Math.max(0, Date.now() - startedAt)
          current.lastAt = completedAt; current.lastResult = content; current.lastError = undefined; current.pending = undefined
          current.nextAt = nextRoutineAt(current, completedAt); current.retryAt = undefined; current.failures = 0
          this.deps.write(JSON.stringify(items))
        } catch (error) {
          if (this.closed) break
          const items = this.list(), current = items.find(i => i.id === item.id)
          if (current?.revision === item.revision) {
            current.lastError = error instanceof Error ? error.message : '执行失败，将在 15 分钟后重试。'
            current.failures = (current.failures ?? 0) + 1
            current.retryAt = now + Math.min(24 * 60, 15 * 2 ** Math.min(current.failures - 1, 7)) * 60000
            this.deps.write(JSON.stringify(items))
          }
        }
      }
    } finally { this.busy = false; this.controller = undefined }
  }
}
