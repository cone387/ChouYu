import { expect, it } from 'vitest'
import { FollowupService } from './followups'
import type { ReminderItem, ReminderSourceState } from '../../shared/reminder-followups'

function fixture() {
  let now = 1000, writeError = false, deliveryError = false
  const saved = new Map<string, ReminderItem>(), states = new Map<string, ReminderSourceState>()
  const deliveries = new Map<string, string[]>(), read = new Set<string>()
  let completeCount = 0
  const deps = {
    items: () => structuredClone([...saved.values()]),
    save: (items: ReminderItem[]) => { if (writeError) throw new Error('disk'); items.forEach(item => saved.set(item.id, structuredClone(item))) },
    source: async (item: ReminderItem): Promise<ReminderSourceState> => states.get(item.id) ?? { status: 'pending' },
    complete: async (item: ReminderItem) => { completeCount++; states.set(item.id, { status: 'processed' }) },
    markRead: (item: ReminderItem) => { read.add(item.id) }, isRead: (item: ReminderItem) => read.has(item.id),
    deliver: (items: ReminderItem[], receipt: string) => { if (deliveryError) throw new Error('delivery'); deliveries.set(receipt, items.map(item => item.id)) },
    delivered: (receipt: string) => deliveries.has(receipt), changed: () => {}, now: () => now
  }
  const add = (id = 'a', source: ReminderItem['source'] = { kind: 'message' }) => {
    const item: ReminderItem = { id, owner: 'alice', sessionId: 's', messageId: `m:${id}`, label: id, source,
      acknowledgement: source.kind === 'todo' ? 'task' : source.kind === 'interaction' ? 'action' : 'received',
      status: 'pending', createdAt: 1000, nextAt: 1_801_000, intervalMinutes: 30, revision: 1 }
    saved.set(id, item); return item
  }
  return { deps, add, saved, states, deliveries, read, completeCount: () => completeCount,
    time: (v: number) => { now = v }, failWrite: (v: boolean) => { writeError = v }, failDelivery: (v: boolean) => { deliveryError = v }, service: new FollowupService(deps) }
}
it('continues after reading and recreation until explicit acknowledgement', async () => {
  const f = fixture(); f.add(); await f.service.act('a', 1, 'read')
  f.time(1_801_000); await f.service.tick()
  expect(f.deliveries.size).toBe(1); expect(f.saved.get('a')!.status).toBe('pending')
  f.time(3_601_000); const restored = new FollowupService(f.deps); await restored.tick()
  expect(f.deliveries.size).toBe(2)
  await restored.act('a', f.saved.get('a')!.revision, 'acknowledge')
  f.time(6_001_000); await restored.tick()
  expect(f.deliveries.size).toBe(2); expect(f.saved.get('a')!.status).toBe('processed')
})
it('postpones once then resumes the configured interval', async () => {
  const f = fixture(); f.add(); await f.service.act('a', 1, 'interval', 60)
  await f.service.act('a', f.saved.get('a')!.revision, 'postpone', 10)
  f.time(601_000); await f.service.tick()
  expect(f.saved.get('a')).toMatchObject({ nextAt: 4_201_000, intervalMinutes: 60, status: 'pending', postponed: false })
  f.time(4_201_000); await f.service.tick(); expect(f.deliveries.size).toBe(2)
})
it('merges offline backlog without losing items or repeating missed intervals', async () => {
  const f = fixture(); f.add(); f.add('b'); f.time(99_001_000); await f.service.tick(); await f.service.tick()
  expect([...f.deliveries.values()]).toEqual([['a', 'b']]); expect(f.saved.size).toBe(2)
  expect(f.saved.get('a')!.nextAt).toBe(100_801_000)
})
it('retires completed and obsolete sources but preserves source read failures', async () => {
  const f = fixture(); f.add(); f.add('b'); f.add('c')
  f.states.set('a', { status: 'processed', reason: '已完成任务' }); f.states.set('b', { status: 'obsolete', reason: '已删除' })
  const source = f.deps.source; f.deps.source = async item => { if (item.id === 'c') throw new Error('读取失败'); return source(item) }
  const service = new FollowupService(f.deps); f.time(1_801_000); await service.tick()
  expect(f.saved.get('a')!.status).toBe('processed'); expect(f.saved.get('b')!.status).toBe('obsolete')
  expect(f.saved.get('c')).toMatchObject({ status: 'pending', error: '读取失败' }); expect(f.deliveries.size).toBe(0)
  f.deps.source = source; await service.tick(); expect([...f.deliveries.values()]).toEqual([['c']])
})
it('retries delivery and deduplicates a delivery whose subsequent state save failed', async () => {
  const f = fixture(); f.add(); f.time(1_801_000); f.failDelivery(true); await f.service.tick()
  expect(f.saved.get('a')!.nextAt).toBe(1_801_000)
  f.failDelivery(false); f.failWrite(true); await f.service.tick()
  expect(f.deliveries.size).toBe(1); f.failWrite(false); await f.service.tick()
  expect(f.deliveries.size).toBe(1); expect(f.saved.get('a')!.nextAt).toBe(3_601_000)
})
it('does not send a stale result when source checking races with postpone', async () => {
  const f = fixture(); f.add(); f.time(1_801_000)
  let release!: () => void, first = true
  const source = f.deps.source
  f.deps.source = async item => { if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) } return source(item) }
  const service = new FollowupService(f.deps), tick = service.tick()
  await service.act('a', 1, 'postpone', 60); release(); await tick
  expect(f.deliveries.size).toBe(0); expect(f.saved.get('a')!.nextAt).toBe(5_401_000)
})
it('requires actual action and reconciles a completed task after a state-save failure', async () => {
  const f = fixture(); f.add('a', { kind: 'interaction', interactionId: 'q' })
  await expect(f.service.act('a', 1, 'acknowledge')).rejects.toThrow('原事项')
  f.add('b', { kind: 'todo', ref: { taskId: 't', reminderAt: 1 } })
  f.failWrite(true); await expect(f.service.act('b', 1, 'complete')).rejects.toThrow('disk')
  expect(f.completeCount()).toBe(1)
  f.failWrite(false); await f.service.act('b', 1, 'complete'); expect(f.completeCount()).toBe(1)
  expect(f.saved.get('b')!.status).toBe('processed')
})
it('rejects stale versions and invalid intervals without prematurely acknowledging', async () => {
  const f = fixture(); f.add()
  await expect(f.service.act('a', 0, 'acknowledge')).rejects.toThrow('变化')
  await expect(f.service.act('a', 1, 'interval', 0)).rejects.toThrow('1～1440')
  f.failWrite(true); await expect(f.service.act('a', 1, 'acknowledge')).rejects.toThrow('disk')
  expect(f.saved.get('a')!.status).toBe('pending')
})

it('rechecks source changes made through the original task interface during grouped reads', async () => {
  const f = fixture(); f.add(); f.add('b'); f.time(1_801_000)
  let generation = 0
  const source = f.deps.source
  f.deps.source = async item => {
    if (item.id === 'b') { f.states.set('a', { status: 'processed' }); generation++ }
    return source(item)
  }
  const service = new FollowupService({ ...f.deps, sourceVersion: item => item.id === 'a' ? generation : 0 })
  await service.tick()
  expect([...f.deliveries.values()].flat()).not.toContain('a')
})
