import { describe, expect, it, vi } from 'vitest'
import { AssistantRoutineService } from './service'
import { nextRoutineAt, type AssistantRoutineInput } from '../../shared/assistant-routines'
const input: AssistantRoutineInput = { title: '晨间总结', instruction: '检查各联系人', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true }
const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()
function fixture() {
  let raw = ''
  const receipts = new Set<string>(), messages: string[] = []
  const deps = { read: () => raw, write: (value: string) => { raw = value }, generate: vi.fn(async () => '阿笔正在处理文章，老周等待答复。'), deliver: vi.fn((id: string, text: string) => { if (!receipts.has(id)) messages.push(text); receipts.add(id) }) }
  return { deps, messages, service: new AssistantRoutineService(deps) }
}
describe('assistant routine execution', () => {
  it('uses local calendar times, skips weekends and supports weekly dates', () => {
    expect(nextRoutineAt({ ...input, cadence: 'weekdays' }, at(25, 10))).toBe(at(28, 9))
    expect(nextRoutineAt({ ...input, cadence: 'weekly', weekday: 1 }, at(28, 10))).toBe(at(35, 9))
    expect(() => fixture().service.save({ ...input, time: '25:00' })).toThrow()
  })
  it('persists schedules and catches up once after several days offline', async () => {
    const f = fixture(); f.service.save(input, undefined, undefined, at(25, 8))
    const restored = new AssistantRoutineService(f.deps)
    await restored.tick(at(28, 10)); await restored.tick(at(28, 11))
    expect(f.deps.generate).toHaveBeenCalledTimes(1); expect(f.messages).toHaveLength(1)
    expect(restored.list()[0].nextAt).toBe(at(29, 9))
  })
  it('does not use the model for simple reminders and pause survives restart', async () => {
    const f = fixture(), [item] = f.service.save({ ...input, kind: 'reminder' }, undefined, undefined, at(25, 8))
    await f.service.tick(at(25, 9)); expect(f.deps.generate).not.toHaveBeenCalled()
    f.service.save({ ...item, enabled: false }, item.id, item.revision, at(25, 10))
    await new AssistantRoutineService(f.deps).tick(at(28, 10)); expect(f.messages).toHaveLength(1)
  })
  it('retains the generated outbox on delivery failure and retries without another model call', async () => {
    const f = fixture(); f.service.save(input, undefined, undefined, at(25, 8))
    f.deps.deliver.mockImplementationOnce(() => { throw new Error('disk full') })
    await f.service.tick(at(25, 9)); expect(f.service.list()[0].pending?.content).toBeTruthy()
    await new AssistantRoutineService(f.deps).tick(at(25, 10))
    expect(f.deps.generate).toHaveBeenCalledTimes(1); expect(f.messages).toHaveLength(1)
  })
  it('deduplicates when the final schedule commit fails after delivery', async () => {
    const f = fixture(); f.service.save(input, undefined, undefined, at(25, 8))
    const write = f.deps.write
    let fail = true
    f.deps.write = value => { if (fail && JSON.parse(value)[0].lastAt) { fail = false; throw new Error('write failed') }; write(value) }
    await f.service.tick(at(25, 9)); await new AssistantRoutineService(f.deps).tick(at(25, 10))
    expect(f.messages).toHaveLength(1); expect(f.deps.generate).toHaveBeenCalledTimes(1)
  })
  it('discards results if paused or deleted during execution, and prevents overlapping ticks', async () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(25, 8))
    let finish!: (text: string) => void
    f.deps.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = f.service.tick(at(25, 9)); await f.service.tick(at(25, 9))
    f.service.remove(item.id, item.revision); finish('完成'); await running
    expect(f.messages).toHaveLength(0); expect(f.deps.generate).toHaveBeenCalledTimes(1)
  })
  it('does not replace corrupt state and rejects stale changes', () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(25, 8))
    f.service.save({ ...item, enabled: false }, item.id, item.revision, at(25, 9))
    expect(() => f.service.remove(item.id, item.revision)).toThrow('已变化')
    f.deps.write('{broken'); expect(() => f.service.save(input)).toThrow(); expect(f.deps.read()).toBe('{broken')
  })
  it('calculates the next date after model completion, avoiding a second run across the due time', async () => {
    vi.useFakeTimers()
    try {
      const started = at(25, 9) - 60000
      vi.setSystemTime(started)
      const f = fixture(); f.service.save(input, undefined, undefined, at(24, 8))
      f.deps.generate.mockImplementationOnce(async () => { vi.setSystemTime(at(25, 9) + 60000); return 'summary' })
      await f.service.tick(started)
      expect(f.service.list()[0].nextAt).toBe(at(26, 9))
    } finally { vi.useRealTimers() }
  })
})
