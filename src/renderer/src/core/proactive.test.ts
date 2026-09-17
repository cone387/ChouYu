import { describe, expect, test, vi } from 'vitest'
import { ProactiveEngine, SNOOZE_PREFIX } from './proactive'

describe('ProactiveEngine', () => {
  test('greeting fires once through the callback only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8, 0))
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: true, restReminder: false })
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(3000)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain('早上好')
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
      engine.stop()
    } finally { vi.useRealTimers() }
  })

  test('rest reminders respect the cooldown window', () => {
    vi.useFakeTimers()
    // Vitest 5 fake timers start at the real wall clock; pin the epoch so the
    // 60-minute cooldown boundary is deterministic (lastProactiveTime starts at 0).
    vi.setSystemTime(0)
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: true })
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(seen).toHaveLength(1)
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(seen).toHaveLength(2)
      engine.stop()
    } finally { vi.useRealTimers() }
  })

  test('snoozeContent fires at the deadline with the prefix and stop cancels it', () => {
    vi.useFakeTimers()
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: false })
      engine.snoozeContent('喝水', 10)
      vi.advanceTimersByTime(10 * 60 * 1000 - 1)
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([`${SNOOZE_PREFIX}喝水`])
      engine.snoozeContent('取消我', 10)
      engine.stop()
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  test('restoreSnoozes re-arms future items and fires overdue ones immediately', () => {
    vi.useFakeTimers()
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: false })
      engine.restoreSnoozes([
        { id: 'past', content: '错过的提醒', dueAt: Date.now() - 5000 },
        { id: 'future', content: '稍后的提醒', dueAt: Date.now() + 60_000 },
        { id: 'bad', content: '', dueAt: 1 },
        'junk'
      ])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([`${SNOOZE_PREFIX}错过的提醒`])
      vi.advanceTimersByTime(60_000)
      expect(seen).toEqual([`${SNOOZE_PREFIX}错过的提醒`, `${SNOOZE_PREFIX}稍后的提醒`])
      engine.stop()
    } finally { vi.useRealTimers() }
  })
})
