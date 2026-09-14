import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openTasksStore } from './store'
import { startTaskScheduler } from './scheduler'

const directories: string[] = []
const tempFile = () => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-scheduler-'))
  directories.push(directory)
  return join(directory, 'tasks.db')
}
afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

describe('startTaskScheduler', () => {
  test('启动时到期提醒合并为一条 backlog,不逐条回调', () => {
    vi.useFakeTimers()
    const store = openTasksStore(tempFile())
    store.createTask({ title: '过期一', remindAt: 1 })
    store.createTask({ title: '过期二', remindAt: 2 })
    const reminders: string[] = []
    let backlog = 0
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: count => { backlog = count } },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    expect(backlog).toBe(2)
    expect(reminders).toEqual([])
    vi.advanceTimersByTime(2_500)
    expect(reminders).toEqual([])
    scheduler.stop()
    store.close()
  })

  test('运行中到期逐条回调且只发一次', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const store = openTasksStore(tempFile())
    store.createTask({ title: '即将到期', remindAt: 10_500 })
    store.createTask({ title: '更晚', remindAt: 12_000 })
    const reminders: string[] = []
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: () => {} },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    vi.advanceTimersByTime(1_000) // 11_000:第一条到期
    expect(reminders).toEqual(['即将到期'])
    vi.advanceTimersByTime(2_000) // 13_000:第二条到期,第一条不重发
    expect(reminders).toEqual(['即将到期', '更晚'])
    vi.advanceTimersByTime(5_000)
    expect(reminders).toEqual(['即将到期', '更晚'])
    scheduler.stop()
    store.close()
  })

  test('领取抛错时不回调且不中断后续 tick', () => {
    vi.useFakeTimers()
    let failures = 0
    let healthy = false
    const claim = () => {
      if (!healthy) { failures += 1; throw new Error('db busy') }
      return []
    }
    const scheduler = startTaskScheduler(claim, { onReminder: () => {}, onBacklog: () => {} }, { intervalMs: 1_000 })
    expect(failures).toBe(1) // 启动积压即失败
    healthy = true
    vi.advanceTimersByTime(1_000)
    expect(failures).toBe(1) // 恢复后不再失败,调度仍在运行
    scheduler.stop()
  })

  test('stop 后不再 tick', () => {
    vi.useFakeTimers()
    const store = openTasksStore(tempFile())
    store.createTask({ title: '稍后', remindAt: Date.now() + 900 })
    const reminders: string[] = []
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: () => {} },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    scheduler.stop()
    vi.advanceTimersByTime(5_000)
    expect(reminders).toEqual([])
    store.close()
  })
})
