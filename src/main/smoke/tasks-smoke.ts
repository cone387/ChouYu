import { app } from 'electron'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openTasksStore } from '../tasks/store'

export async function runTasksSmoke(): Promise<void> {
  const file = join(app.getPath('userData'), 'tasks-smoke.db')
  try { rmSync(file, { force: true }) } catch { /* 首次运行没有旧文件 */ }
  const store = openTasksStore(file)
  try {
    if (store.listTasks().open.length !== 0) throw new Error('Tasks smoke fixture is not empty')
    console.log('CHOUYU_TASKS_SMOKE_PASSED placeholder')
  } finally { store.close() }
}
