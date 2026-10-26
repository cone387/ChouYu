export interface TaskEnding {
  version: 1; acceptedAt: number; timeZone: string
  deadline?: { at: number; source: string; acceptedAt: number; timeZone: string }
  count?: { mode: 'produced' | 'delivered'; target: number; source: string }
  historyUnknown?: boolean
  occurrences: Record<string, { producedAt: number; deliveredAt?: number; noticeIds?: string[] }>
}
export interface TaskEndingRequest { patch: unknown; text: string; acceptedAt: number; timeZone: string }
interface EndingContext { text: string; acceptedAt: number; timeZone: string; isNew: boolean; calendar: boolean }
export class TaskEndingError extends Error { constructor(message: string) { super(message); this.name = 'TaskEndingError' } }
function source(value: unknown, text: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || !text.includes(value)) throw new Error('结束条件缺少用户原话依据，尚未保存。')
  return value
}
/** Convert a wall-clock date in the accepted zone, without depending on later device timezone changes. */
function midnight(date: string, zone: string): number {
  const parts = date.split('-').map(Number), base = Date.UTC(parts[0], parts[1] - 1, parts[2])
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(base).toISOString().slice(0, 10) !== date) throw new Error('截止日期无效。')
  const next = new Date(base + 86400000), target = next.getTime()
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  let at = target
  for (let i = 0; i < 4; i++) {
    const fields = Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]))
    const actual = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second))
    if (actual === target) return at
    at += target - actual
  }
  throw new Error('截止日期所在时区有歧义，请给出明确时刻。')
}
export function applyTaskEnding(previous: TaskEnding | undefined, raw: unknown, context: EndingContext): TaskEnding | undefined {
  if (raw === undefined) return previous ? structuredClone(previous) : undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('任务结束条件无效。')
  if (!Number.isFinite(context.acceptedAt) || !context.timeZone || typeof context.text !== 'string' || context.text.length > 16000) throw new Error('任务结束条件来源无效。')
  new Intl.DateTimeFormat('en', { timeZone: context.timeZone })
  const patch = raw as { deadline?: unknown; count?: unknown }
  if (Object.keys(patch).some(key => !['deadline', 'count'].includes(key))) throw new Error('任务结束条件包含未知字段。')
  const next: TaskEnding = previous ? structuredClone(previous) : { version: 1, acceptedAt: context.acceptedAt, timeZone: context.timeZone, occurrences: {} }
  if (patch.deadline === null) {
    if (!/(取消|移除|解除|不要|不设).{0,12}(截止|期限|限期)|(?:remove|cancel).{0,20}deadline/i.test(context.text)) throw new Error('请明确是否取消截止时间。')
    delete next.deadline
  } else if (patch.deadline !== undefined) {
    const value = patch.deadline as { kind?: string; value?: unknown; source?: unknown }, original = source(value?.source, context.text)
    let at: number
    if (value.kind === 'date' && typeof value.value === 'string') at = midnight(value.value, context.timeZone)
    else if (value.kind === 'instant' && typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.value)) {
      midnight(value.value.slice(0, 10), 'UTC') // Date.parse normalizes impossible days such as February 30.
      at = Date.parse(value.value)
    }
    else if (value.kind === 'duration' && typeof value.value === 'number' && Number.isSafeInteger(value.value) && value.value > 0 && value.value <= 36500 * 86400000
      && /(仅|只|后.{0,12}(结束|停止)|到期|截止|持续.{0,20}(结束|停止)|then\s+stop|only\s+for)/i.test(original)) at = context.acceptedAt + value.value
    else throw new Error('请明确截止日期、时刻或从本次要求起持续多久后结束；全天持续工作不是有限期限。')
    if (!Number.isFinite(at)) throw new Error('截止时刻无效。')
    next.deadline = { at, source: original, acceptedAt: context.acceptedAt, timeZone: context.timeZone }
  }
  if (patch.count === null) {
    if (!/(取消|移除|解除|不要|不设).{0,12}(次数|期数|上限)|(?:remove|cancel).{0,20}(count|limit)/i.test(context.text)) throw new Error('请明确是否取消成功次数限制。')
    delete next.count
  } else if (patch.count !== undefined) {
    const value = patch.count as { mode?: string; amount?: number; fromNow?: boolean; source?: unknown }, original = source(value?.source, context.text)
    if (!context.calendar) throw new Error('成功次数用于日历期次；章节、想法数量仍属于内容目标。')
    if (!['produced', 'delivered'].includes(value.mode ?? '') || !Number.isSafeInteger(value.amount) || value.amount! < 1 || value.amount! > 10000 || value.fromNow !== undefined && typeof value.fromNow !== 'boolean') throw new Error('请明确成功产出还是实际送达，以及 1–10000 次的上限。')
    if ((!context.isNew && !previous?.count || previous?.historyUnknown) && !value.fromNow) throw new Error('历史成功次数尚无可靠记录，请明确从现在再做多少次。')
    if (value.fromNow && !/(再|从现在|从本次|from now|another)/i.test(original)) throw new Error('请明确从现在再做多少次，不能自行重置计数起点。')
    const mode = value.mode as 'produced' | 'delivered', counts = endingState(next, context.acceptedAt)
    next.count = { mode, target: value.amount! + (value.fromNow ? counts[mode] : 0), source: original }
    if (value.fromNow) delete next.historyUnknown
  }
  return next
}
export function endingState(ending: TaskEnding | undefined, now = Date.now()) {
  const values = Object.values(ending?.occurrences ?? {}), produced = values.length, delivered = values.filter(value => value.deliveredAt !== undefined).length
  const count = ending?.count
  const reason = ending?.deadline && now >= ending.deadline.at ? 'deadline'
    : count && ending?.historyUnknown ? 'history-unknown'
      : count && (count.mode === 'produced' ? produced : delivered) >= count.target ? 'count'
      : count?.mode === 'delivered' && produced >= count.target ? 'delivery-pending' : undefined
  const label = reason === 'deadline' ? '已到截止时间' : reason === 'history-unknown' ? '历史次数待核对' : reason === 'count' ? '已达成功次数' : reason === 'delivery-pending' ? '等待最后一期送达' : undefined
  return { stopped: Boolean(reason), reason, label, produced, delivered }
}
export function assertTaskEnding(ending: TaskEnding | undefined, now = Date.now()): void {
  const state = endingState(ending, now)
  if (state.stopped) throw new TaskEndingError(`${state.label}，已有成果保留。请在任务描述中明确修改结束条件后再继续。`)
}
/** Facts shared by both task adapters; no new settings form. */
export function taskEndingFacts(ending: TaskEnding | undefined): [string, string][] {
  const state = endingState(ending), facts: [string, string][] = []
  if (ending?.deadline) facts.push(['截止时间', `${new Date(ending.deadline.at).toLocaleString('zh-CN', { timeZone: ending.deadline.timeZone, hour12: false })} 前（${ending.deadline.timeZone}）`])
  if (ending?.count) facts.push(['成功期次', `已产出 ${state.produced} 次 · 已送达 ${state.delivered} 次；${ending.count.mode === 'produced' ? '产出' : '送达'}上限 ${ending.count.target} 次${ending.historyUnknown ? '（恢复前历史不完整，须明确从现在再做几次）' : ''}`])
  return facts
}
export function recordOccurrence(ending: TaskEnding, id: string, kind: 'produced' | 'delivered', now = Date.now()): TaskEnding {
  if (!id || id.length > 256 || !Number.isFinite(now)) throw new Error('Invalid occurrence receipt')
  const next = structuredClone(ending), current = next.occurrences[id]
  next.occurrences[id] = { ...current, producedAt: current?.producedAt ?? now,
    ...(current?.deliveredAt !== undefined || kind === 'delivered' ? { deliveredAt: current?.deliveredAt ?? now } : {}) }
  return next
}
