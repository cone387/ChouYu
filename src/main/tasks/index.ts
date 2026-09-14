import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { openTasksStore, type TasksStore } from './store'
import { startTaskScheduler } from './scheduler'

let store: TasksStore | undefined
let scheduler: { stop(): void } | undefined
let shuttingDown = false

const broadcast = (channel: string, payload?: unknown): void => {
  if (shuttingDown) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export interface TasksModuleOptions {
  notificationsEnabled(): boolean
  openTasksWorkspace(): void
}

export function initializeTasks(options: TasksModuleOptions): void {
  if (store) return
  shuttingDown = false
  store = openTasksStore(join(app.getPath('userData'), 'tasks.db'))
  if (store.quarantinedAt) broadcast('tasks:store-rebuilt')
  scheduler = startTaskScheduler(
    now => store!.claimDueReminders(now),
    {
      onBacklog: count => { broadcast('tasks:reminder', { backlog: count }) },
      onReminder: task => {
        if (options.notificationsEnabled() && Notification.isSupported()) {
          try {
            const notification = new Notification({ title: '任务提醒', body: task.title })
            notification.on('click', () => options.openTasksWorkspace())
            notification.show()
          } catch { /* 显示失败不阻塞消息中心留档 */ }
        }
        broadcast('tasks:reminder', { task })
      }
    }
  )
  ipcMain.handle('tasks:list', () => store!.listTasks())
  ipcMain.handle('tasks:create', (_event, input) => store!.createTask(input ?? {}))
  ipcMain.handle('tasks:update', (_event, id: string, patch) => store!.updateTask(id, patch ?? {}))
  ipcMain.handle('tasks:complete', (_event, id: string) => store!.completeTask(id))
  ipcMain.handle('tasks:delete', (_event, id: string) => store!.deleteTask(id))
  ipcMain.handle('tasks:projects', () => store!.listProjects())
  ipcMain.handle('tasks:createProject', (_event, name: string) => store!.createProject(name))
  ipcMain.handle('tasks:renameProject', (_event, id: string, name: string) => store!.renameProject(id, name))
  ipcMain.handle('tasks:archiveProject', (_event, id: string, archived: boolean) => store!.archiveProject(id, archived))
}

export function closeTasks(): void {
  shuttingDown = true
  scheduler?.stop()
  scheduler = undefined
  try { store?.close() } catch { /* 退出路径上尽力关闭 */ }
  store = undefined
}
