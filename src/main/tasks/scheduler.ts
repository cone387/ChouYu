import type { TaskRecord, TaskReminderPayload } from '../../shared/tasks'

export interface TaskSchedulerHandlers {
  onReminder(task: TaskReminderPayload): void
  onBacklog(count: number): void
}

export interface TaskSchedulerOptions {
  intervalMs?: number
  now?(): number
}

const toReminderPayload = (task: TaskRecord): TaskReminderPayload => ({
  id: task.id, title: task.title, dueAt: task.dueAt, priority: task.priority
})

export function startTaskScheduler(
  claim: (now: number) => TaskRecord[],
  handlers: TaskSchedulerHandlers,
  options: TaskSchedulerOptions = {}
): { stop(): void } {
  const intervalMs = options.intervalMs ?? 30_000
  const now = options.now ?? (() => Date.now())
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  // 启动积压:应用没开时错过的提醒合并成一条,不逐条轰炸
  let backlog: TaskRecord[] = []
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
    let due: TaskRecord[]
    try {
      due = claim(now())
    } catch (error) {
      console.error('tasks scheduler tick failed:', error)
      return
    }
    for (const task of due) {
      try { handlers.onReminder(toReminderPayload(task)) } catch (error) { console.error('tasks scheduler reminder handler failed:', error) }
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
