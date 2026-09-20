import { app } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openTasksStore } from '../tasks/store'
import { startTaskScheduler } from '../tasks/scheduler'

export async function runTasksSmoke(): Promise<void> {
  const file = join(app.getPath('userData'), 'tasks-smoke.db')
  try { rmSync(file, { force: true }) } catch { /* 首次运行没有旧文件 */ }
  const store = openTasksStore(file)
  const reminders: string[] = []
  let backlog = 0
  let scheduler: { stop(): void } | null = null
  try {
    const project = store.createProject('冒烟项目')
    let rejected = false
    try { store.createProject('冒烟项目') } catch { rejected = true }
    if (!rejected) throw new Error('Duplicate task project name was accepted')
    const longName = '项目名称无需截断'.repeat(100)
    const longProject = store.createProject(longName)
    const renamed = `${longName}（已重命名）`
    if (longProject.name !== longName || store.renameProject(longProject.id, renamed).name !== renamed) throw new Error('Long project name was rejected or truncated')
    let emptyRejected = false
    try { store.createProject('   ') } catch { emptyRejected = true }
    if (!emptyRejected) throw new Error('Empty project name was accepted')

    // 启动调度器前先落下一条过期提醒,模拟应用未运行期间错过的积压
    const overdue = store.createTask({ title: '过期任务', priority: 'high', dueAt: Date.now() - 3_600_000, remindAt: Date.now() - 1_800_000 })
    scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      {
        onReminder: task => { reminders.push(task.id) },
        onBacklog: count => { backlog += count }
      },
      { intervalMs: 50 }
    )

    const due = store.createTask({ title: '即将到期', dueAt: Date.now() + 400, remindAt: Date.now() + 120 })
    const toComplete = store.createTask({ title: '先完成', dueAt: Date.now() + 400, remindAt: Date.now() + 120 })
    store.completeTask(toComplete.id)

    if (backlog !== 1) throw new Error(`Expected one merged backlog reminder, got ${backlog}`)
    await new Promise(resolve => setTimeout(resolve, 600))
    if (reminders.length !== 1 || reminders[0] !== due.id) throw new Error(`Expected exactly the due reminder, got ${JSON.stringify(reminders)}`)
    if (store.listTasks().open.find(task => task.id === overdue.id)?.remindFiredAt == null) throw new Error('Backlog reminder was not marked fired')
    await new Promise(resolve => setTimeout(resolve, 200))
    if (reminders.length !== 1) throw new Error('Reminder fired more than once')

    store.deleteTask(due.id)
    store.close()
    const reopened = openTasksStore(file)
    const persisted = reopened.listTasks()
    if (persisted.open.length !== 1 || persisted.done.length !== 1) throw new Error('Task rows did not survive reopen')
    if (!reopened.listProjects().some(item => item.id === project.id)) throw new Error('Project did not survive reopen')
    if (!reopened.listProjects().some(item => item.id === longProject.id && item.name === renamed)) throw new Error('Long project name did not survive reopen')
    reopened.close()
    console.log('CHOUYU_TASKS_SMOKE_PASSED backlog merge, fire-once, complete cancels, persistence')
  } finally {
    scheduler?.stop()
    try { store.close() } catch { /* 已在用例内关闭 */ }
  }
}
