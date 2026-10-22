import { expect, it, vi } from 'vitest'
import { LatestTaskRequest, TaskCalendar } from './taskData'

it('commits only the latest query when task responses arrive out of order', async () => {
  const loader = new LatestTaskRequest()
  let first!: (value: string[]) => void
  const apply = vi.fn(), fail = vi.fn(), settled = vi.fn()
  const old = loader.run(() => new Promise<string[]>(resolve => { first = resolve }), apply, fail, settled)
  await loader.run(async () => ['current'], apply, fail, settled)
  first(['old']); await old
  expect(apply.mock.calls).toEqual([[['current']]])
  expect(settled).toHaveBeenCalledTimes(1)
})

it('background invalidation rejects pending results and errors but permits the next refresh', async () => {
  const loader = new LatestTaskRequest(), apply = vi.fn(), fail = vi.fn(), settled = vi.fn()
  let reject!: (error: Error) => void
  const old = loader.run(() => new Promise((_, no) => { reject = no }), apply, fail, settled)
  loader.invalidate()
  reject(new Error('stale error')); await old
  expect(fail).not.toHaveBeenCalled()
  expect(settled).not.toHaveBeenCalled()
  await loader.run(async () => ['after resume'], apply, fail, settled)
  expect(apply).toHaveBeenCalledExactlyOnceWith(['after resume'])
})

it('refreshes once after midnight or several hidden days and schedules the next local boundary', () => {
  const start = new Date(2026, 9, 22, 23, 59, 59).getTime()
  const calendar = new TaskCalendar(start)
  expect(calendar.check(start)).toEqual({ changed: false, delay: 1100 })
  expect(calendar.check(start + 1000).changed).toBe(true)
  expect(calendar.check(start + 2000).changed).toBe(false)
  expect(calendar.check(new Date(2026, 9, 26, 9).getTime()).changed).toBe(true)
})
