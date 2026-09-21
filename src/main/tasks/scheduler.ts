import type { TaskReminderPayload } from '../../shared/tasks'
import type { ClaimedReminder } from './store'

export interface TaskSchedulerHandlers {
  onReminder(task: TaskReminderPayload): void
  onBacklog(count: number): void
}

export interface TaskSchedulerOptions {
  intervalMs?: number
  now?(): number
}

const toReminderPayload = (entry: ClaimedReminder): TaskReminderPayload => ({
  id: entry.task.id,
  title: entry.itemTitle ? `${entry.task.title} · ${entry.itemTitle}` : entry.task.title,
  dueAt: entry.task.dueAt,
  priority: entry.task.priority
})

export function startTaskScheduler(
  claim: (now: number) => ClaimedReminder[],
  handlers: TaskSchedulerHandlers,
  options: TaskSchedulerOptions = {}
): { stop(): void } {
  const intervalMs = options.intervalMs ?? 30_000
  const now = options.now ?? (() => Date.now())
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastTickAt = now()

  // 启动积压:应用没开时错过的提醒合并成一条,不逐条轰炸
  let backlog: ClaimedReminder[] = []
  try {
    backlog = claim(now())
  } catch (error) {
    console.error('tasks scheduler backlog failed:', error)
  }
  if (backlog.length > 0) {
    try { handlers.onBacklog(backlog.length) } catch (error) { console.error('tasks scheduler backlog handler failed:', error) }
  }

  const tick = (): void => {
    if (stopped) return
    const currentTime = now()
    const interrupted = currentTime - lastTickAt > Math.max(intervalMs * 3, 60_000)
    let due: ClaimedReminder[]
    try {
      due = claim(currentTime)
    } catch (error) {
      console.error('tasks scheduler tick failed:', error)
      return
    }
    lastTickAt = currentTime
    if (interrupted && due.length > 0) {
      try { handlers.onBacklog(due.length) } catch (error) { console.error('tasks scheduler backlog handler failed:', error) }
      return
    }
    for (const entry of due) {
      try { handlers.onReminder(toReminderPayload(entry)) } catch (error) { console.error('tasks scheduler reminder handler failed:', error) }
    }
  }

  timer = setInterval(tick, intervalMs)
  return {
    stop(): void {
      stopped = true
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }
}
