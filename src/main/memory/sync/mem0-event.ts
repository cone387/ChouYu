import { setTimeout as delay } from 'timers/promises'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A queued acknowledgement is not a confirmed write. Never retry the POST here. */
export async function confirmMem0Event(acknowledgement: unknown, read: (id: string, signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal,
  pause: (signal: AbortSignal) => Promise<void> = signal => delay(1000, undefined, { signal })) : Promise<unknown> {
  const initial = record(acknowledgement)
  if (initial.status === 'FAILED') throw new Error('Mem0 写入事件失败，未确认保存。')
  if (initial.event_id === undefined) {
    if (initial.status === 'PENDING' || initial.status === 'RUNNING') throw new Error('Mem0 返回待处理状态但缺少事件 ID，尚未确认保存。')
    return acknowledgement
  }
  const id = initial.event_id
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Mem0 事件 ID 无效，尚未确认保存。')
  const deadline = AbortSignal.timeout(30_000)
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline
  for (let attempt = 0; attempt < 30; attempt++) {
    bounded.throwIfAborted()
    const event = record(await read(id, bounded))
    bounded.throwIfAborted()
    if (event.id !== id || event.event_type !== 'ADD') throw new Error('Mem0 返回的写入事件不匹配，尚未确认保存。')
    if (event.status === 'FAILED') throw new Error('Mem0 写入事件失败，未确认保存。')
    if (event.status === 'SUCCEEDED') {
      if (!Array.isArray(event.results)) throw new Error('Mem0 事件结果无效，尚未确认保存。')
      return { results: event.results }
    }
    if (event.status !== 'PENDING' && event.status !== 'RUNNING') throw new Error('Mem0 事件状态未知，尚未确认保存。')
    await pause(bounded)
  }
  throw new Error('Mem0 写入仍在处理，请稍后刷新确认；未自动重发。')
}
