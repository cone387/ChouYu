import { describe, expect, it, vi } from 'vitest'
import { AssistantRoutineService } from './service'
import { nextRoutineAt, type AssistantRoutineInput } from '../../shared/assistant-routines'
const input: AssistantRoutineInput = { title: '晨间总结', instruction: '检查各联系人', times: ['09:00'], cadence: 'daily', kind: 'contact-summary', enabled: true }
const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()
function fixture() {
  let raw = ''
  const receipts = new Set<string>(), messages: string[] = []
  const history = new Map<string, string>()
  const deps = { readHistory: (id: string) => history.get(id), writeHistory: (id: string, value: string) => { history.set(id, value) }, read: () => raw, write: (value: string) => { raw = value }, generate: vi.fn(async () => '阿笔正在处理文章，老周等待答复。'), deliver: vi.fn((id: string, text: string) => { if (!receipts.has(id)) messages.push(text); receipts.add(id) }) }
  return { deps, messages, service: new AssistantRoutineService(deps) }
}
describe('assistant routine execution', () => {
  it('keeps each failed attempt and its later result across edits and restart', async () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(25, 8))
    f.deps.generate.mockRejectedValueOnce(new Error('model unavailable'))
    await f.service.tick(at(25, 9))
    const restarted = new AssistantRoutineService(f.deps)
    await restarted.tick(at(25, 10))
    const history = restarted.history(item.id).items
    expect(history.map(entry => entry.status)).toEqual(['completed', 'failed'])
    expect(history[1].error).toBe('model unavailable')
    expect(history[0].content).toContain('老周')
    expect(history[0].receipt).toBe(history[1].receipt)
    restarted.save({ ...item, enabled: false }, item.id, item.revision, at(25, 11))
    expect(restarted.history(item.id).items).toEqual(history)
    expect(restarted.list()[0]).toMatchObject({ createdAt: at(25, 8), updatedAt: at(25, 11) })
  })
  it('paginates without dropping or duplicating older history when a new execution arrives', async () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(1, 8))
    for (let day = 1; day <= 25; day++) await f.service.tick(at(day, 9))
    const first = f.service.history(item.id)
    expect(first.items).toHaveLength(20)
    await f.service.tick(at(26, 9))
    const older = f.service.history(item.id, first.nextCursor)
    expect(older.items).toHaveLength(5)
    expect(new Set([...first.items, ...older.items].map(entry => entry.id)).size).toBe(25)
    expect(older.nextCursor).toBeUndefined()
  })
  it('does not invent execution history for pre-upgrade schedules', () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(25, 8))
    f.deps.write(JSON.stringify([{ ...item, createdAt: undefined, updatedAt: undefined, lastAt: at(24, 9), lastResult: 'old summary' }]))
    expect(f.service.history(item.id).items).toEqual([])
    expect(f.service.list()[0].lastResult).toBe('old summary')
  })
  it('distinguishes a live attempt from an interrupted attempt after restart', async () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(25, 8))
    let finish!: (value: string) => void
    f.deps.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.service.tick(at(25, 9))
    expect(f.service.history(item.id).items[0].status).toBe('running')
    f.service.close(); finish('unused'); await pending
    expect(new AssistantRoutineService(f.deps).history(item.id).items[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('中断') })
    expect(f.messages).toHaveLength(0)
  })
  it('uses local calendar times, skips weekends and supports weekly dates', () => {
    expect(nextRoutineAt({ ...input, cadence: 'weekdays' }, at(25, 10))).toBe(at(28, 9))
    expect(nextRoutineAt({ ...input, cadence: 'weekly', weekday: 1 }, at(28, 10))).toBe(at(35, 9))
    expect(() => fixture().service.save({ ...input, times: ['25:00'] })).toThrow()
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

describe('extended schedule persistence', () => {
  const once = { title: '一次性', instruction: '交报告', times: ['09:00'], cadence: 'once' as const, date: '2026-09-26', kind: 'contact-summary' as const, enabled: true }
  it('normalizes a legacy stored time on read and persists the new shape on the next write', () => {
    const f = fixture(), [saved] = f.service.save(input, undefined, undefined, at(24, 8))
    f.deps.write(JSON.stringify([{ ...saved, time: '10:00', times: undefined }]))
    expect(f.service.list()[0]).toMatchObject({ times: ['10:00'] })
    f.service.save({ ...input, title: '第二项' }, undefined, undefined, at(24, 9))
    const stored = JSON.parse(f.deps.read() as string)
    expect(stored[0].times).toEqual(['10:00'])
    expect(stored[0].time).toBeUndefined()
  })
  it('archives the request log on save and keeps the previous one when a later edit omits it', () => {
    const f = fixture(), [item] = f.service.save(input, undefined, undefined, at(24, 8), '用户：每天九点检查')
    expect(f.service.list()[0].requestLog).toBe('用户：每天九点检查')
    f.service.save({ ...input, instruction: '检查所有联系人的进展' }, item.id, item.revision, at(24, 10))
    expect(f.service.list()[0].requestLog).toBe('用户：每天九点检查')
    expect(() => f.service.save(input, undefined, undefined, at(23, 8), 'x'.repeat(8001))).toThrow('8000')
  })
  it('rejects saving a once schedule whose datetime has passed', () => {
    const f = fixture()
    expect(() => f.service.save({ ...once, date: '2026-09-25' }, undefined, undefined, at(26, 8))).toThrow('已过')
  })
  it('delivers both time slots of one day exactly once each', async () => {
    const f = fixture()
    f.service.save({ ...input, times: ['09:00', '21:00'] }, undefined, undefined, at(25, 8))
    await f.service.tick(at(25, 10))
    expect(f.messages).toHaveLength(1)
    expect(f.service.list()[0].nextAt).toBe(at(25, 21))
    await f.service.tick(at(25, 22))
    expect(f.messages).toHaveLength(2)
    await f.service.tick(at(26, 12))
    expect(f.messages).toHaveLength(3)
  })
  it('marks a finished once schedule and never runs or recomputes it again', async () => {
    const f = fixture(), [item] = f.service.save(once, undefined, undefined, at(25, 8))
    await f.service.tick(at(26, 9))
    expect(f.messages).toHaveLength(1)
    expect(f.service.list()[0]).toMatchObject({ finishedAt: expect.any(Number), nextAt: item.nextAt })
    await f.service.tick(at(27, 9))
    expect(f.messages).toHaveLength(1)
  })
  it('fires a missed once schedule exactly once when reopened late', async () => {
    const f = fixture()
    f.service.save(once, undefined, undefined, at(25, 8))
    const reopened = new AssistantRoutineService(f.deps)
    await reopened.tick(at(27, 10))
    expect(f.messages).toHaveLength(1)
    expect(reopened.list()[0].finishedAt).toBeTruthy()
  })
  it('marks a once schedule finished only after a retry succeeds', async () => {
    const f = fixture()
    f.service.save(once, undefined, undefined, at(25, 8))
    f.deps.generate.mockRejectedValueOnce(new Error('model unavailable'))
    await f.service.tick(at(26, 9))
    expect(f.service.list()[0].finishedAt).toBeUndefined()
    expect(f.service.list()[0].retryAt).toBeGreaterThan(at(26, 9))
    await f.service.tick(at(26, 10))
    expect(f.service.list()[0].finishedAt).toBeTruthy()
    expect(f.messages).toHaveLength(1)
  })
})
