import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { openTasksStore, type TasksStore } from './store'
import { startTaskScheduler } from './scheduler'

let store: TasksStore | undefined
let scheduler: { stop(): void } | undefined
let shuttingDown = false
let storeRebuilt = false
let pendingBacklog = 0
let readyDelivered = false

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
  if (store.quarantinedAt) storeRebuilt = true
  scheduler = startTaskScheduler(
    now => store!.claimDueReminders(now),
    {
      onBacklog: count => { pendingBacklog = count },
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
  ipcMain.handle('tasks:reopen', (_event, id: string) => store!.reopenTask(id))
  ipcMain.handle('tasks:delete', (_event, id: string) => store!.deleteTask(id))
  ipcMain.handle('tasks:projects', () => store!.listProjects())
  ipcMain.handle('tasks:createProject', (_event, name: string) => store!.createProject(name))
  ipcMain.handle('tasks:renameProject', (_event, id: string, name: string) => store!.renameProject(id, name))
  ipcMain.handle('tasks:archiveProject', (_event, id: string, archived: boolean) => store!.archiveProject(id, archived))
  ipcMain.handle('tasks:views', () => store!.listViews())
  ipcMain.handle('tasks:createView', (_event, input) => store!.createView(input ?? {}))
  ipcMain.handle('tasks:updateView', (_event, id: string, patch) => store!.updateView(id, patch ?? {}))
  ipcMain.handle('tasks:deleteView', (_event, id: string) => store!.deleteView(id))

  ipcMain.on('tasks:ready', () => {
    if (readyDelivered) return
    readyDelivered = true
    if (storeRebuilt) broadcast('tasks:store-rebuilt')
    if (pendingBacklog > 0) broadcast('tasks:reminder', { backlog: pendingBacklog })
  })
}

export function closeTasks(): void {
  shuttingDown = true
  for (const channel of ['tasks:list', 'tasks:create', 'tasks:update', 'tasks:complete', 'tasks:reopen', 'tasks:delete', 'tasks:projects', 'tasks:createProject', 'tasks:renameProject', 'tasks:archiveProject', 'tasks:views', 'tasks:createView', 'tasks:updateView', 'tasks:deleteView']) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners('tasks:ready')
  storeRebuilt = false
  pendingBacklog = 0
  readyDelivered = false
  scheduler?.stop()
  scheduler = undefined
  try { store?.close() } catch { /* 退出路径上尽力关闭 */ }
  store = undefined
}
