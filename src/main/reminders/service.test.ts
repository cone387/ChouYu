import { describe, expect, test } from 'vitest'
import { SnoozeService, type ReminderMessage } from './service'
function fixture() {
  let data: string | null = null, now = 1_000, valid = true, fail = false
  const delivered = new Map<string, string>()
  const message: ReminderMessage = { id: 'm', role: 'assistant', content: '任务提醒：旧标题', assistantKind: 'task', taskReminder: { taskId: 't', reminderAt: 1000 } }
  const deps = { read: () => data, write: (value: string) => { data = value }, message: () => message, task: () => valid ? '新标题' : null, changed: () => {}, now: () => now,
    append: (item: { id: string }, content: string) => { if (fail) throw new Error('disk'); delivered.set(item.id, content) } }
  const service = new SnoozeService(deps)
  return { service, deps, delivered, message, time: (value: number) => { now = value }, valid: (value: boolean) => { valid = value }, fail: (value: boolean) => { fail = value } }
}
describe('durable snoozes', () => {
  test('rescheduling replaces one pending reminder and survives service recreation', () => {
    const f = fixture(); f.service.schedule('s', 'm', 10); f.service.schedule('s', 'm', 30)
    const restored = new SnoozeService(f.deps)
    expect(restored.list()).toHaveLength(1); f.time(601_000); restored.tick(); expect(f.delivered.size).toBe(0)
    f.time(1_801_000); restored.tick(); expect([...f.delivered.values()]).toEqual(['⏰ 稍后提醒：任务提醒：新标题']); expect(restored.list()).toEqual([])
  })
  test('completion, deletion, archive or reschedule invalidates the reminder', () => {
    const f = fixture(); f.service.schedule('s', 'm', 10); f.valid(false); f.service.tick()
    expect(f.service.list()).toEqual([]); expect(f.delivered.size).toBe(0)
    expect(() => f.service.schedule('s', 'm', 10)).toThrow('无需再次提醒')
  })
  test('failed delivery remains pending and retries after recovery', () => {
    const f = fixture(); f.service.schedule('s', 'm', 10); f.time(601_000); f.fail(true); f.service.tick()
    expect(f.service.list()).toHaveLength(1); f.fail(false); f.service.tick(); f.service.tick(); expect(f.delivered.size).toBe(1)
  })
  test('cancel and validation do not create phantom reminders', () => {
    const f = fixture(); const item = f.service.schedule('s', 'm', 10); f.service.cancel(item.key); f.time(601_000); f.service.tick(); expect(f.delivered.size).toBe(0)
    expect(() => f.service.schedule('s', 'm', 0)).toThrow(); f.message.assistantKind = 'greeting'; expect(() => f.service.schedule('s', 'm', 10)).toThrow()
  })
  test('legacy pending content restores without inventing a task reference', () => {
    const f = fixture(); f.deps.write(JSON.stringify([{ id: 'old', content: '喝水', dueAt: 100 }]))
    f.service.tick(); expect([...f.delivered.values()]).toEqual(['⏰ 稍后提醒：喝水'])
  })
})


test('a postponed rest reminder and its original share the same pending action', () => {
  const f = fixture()
  f.message.taskReminder = undefined; f.message.assistantKind = 'rest'
  const original = f.service.schedule('s', 'm', 10)
  f.message.id = 'new-message'; f.message.assistantKind = 'snooze'; f.message.snoozeKey = original.key
  f.service.schedule('s', 'new-message', 30)
  expect(f.service.list()).toHaveLength(1)
  expect(f.service.list()[0].key).toBe(original.key)
})
