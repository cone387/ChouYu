import { taskScheduleBounds } from '../../../../shared/tasks'

export type SmartTaskView = 'unplanned' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'overdue' | 'all' | 'done'
export type TaskSelection = SmartTaskView | `project:${string}` | `view:${string}`

export class TaskCalendar {
  private day: number
  constructor(now: number) { this.day = taskScheduleBounds('today', now)[0] }
  check(now: number): { changed: boolean; delay: number } {
    const [start, end] = taskScheduleBounds('today', now)
    const changed = start !== this.day
    this.day = start
    return { changed, delay: end - now + 100 }
  }
}

/** Shared query authority across refresh, debounce, background invalidation and disposal. */
export class LatestTaskRequest {
  private version = 0
  invalidate(): void { this.version++ }
  async run<T>(read: () => Promise<T>, apply: (value: T) => void, fail: (reason: unknown) => void, settled: () => void): Promise<void> {
    const version = ++this.version
    try {
      const value = await read()
      if (version === this.version) apply(value)
    } catch (reason) {
      if (version === this.version) fail(reason)
    } finally {
      if (version === this.version) settled()
    }
  }
}
