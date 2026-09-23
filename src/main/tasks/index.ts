import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { TaskUISettings } from '../../shared/tasks'
import type { TaskBackup } from './backup'
import { openTasksStore, type TasksStore } from './store'
import { startTaskScheduler } from './scheduler'
import { registerTool, getRegisteredTool } from '../tools/registry'
import { getSession } from '../database'
import { createTaskTool } from './task-tool'
import { createTaskAssistantTools } from './assistant-tools'

let store: TasksStore | undefined
let scheduler: { stop(): void } | undefined
let shuttingDown = false
let storeRebuilt = false
let pendingBacklog = 0
let readyDelivered = false
const pendingBackups = new Map<number, { token: string; backup: TaskBackup; expiresAt: number }>()

async function writeBackup(path: string, backup: TaskBackup): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(backup), { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, path)
  } finally { await fs.unlink(temporary).catch(() => {}) }
}

const broadcast = (channel: string, payload?: unknown): void => {
  if (shuttingDown) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export interface TasksModuleOptions {
  notificationsEnabled(): boolean
  openTasksWorkspace(taskId?: string): void
}

export function initializeTasks(options: TasksModuleOptions): void {
  if (store) return
  shuttingDown = false
  store = openTasksStore(join(app.getPath('userData'), 'tasks.db'))
  if (!getRegisteredTool('create_task')) registerTool(createTaskTool(input => {
    if (!store) throw new Error('任务系统尚未就绪。')
    const task = store.createTask(input)
    broadcast('tasks:changed')
    return task
  }, getSession))
  for (const tool of createTaskAssistantTools(() => {
    if (!store) throw new Error('任务系统尚未就绪。')
    return store
  }, () => broadcast('tasks:changed'))) {
    if (!getRegisteredTool(tool.name)) registerTool(tool)
  }
  if (store.quarantinedAt) storeRebuilt = true
  scheduler = startTaskScheduler(
    now => store!.claimDueReminders(now),
    {
      onBacklog: count => {
        if (readyDelivered) broadcast('tasks:reminder', { backlog: count })
        else pendingBacklog += count
      },
      onReminder: task => {
        if (options.notificationsEnabled() && Notification.isSupported()) {
          try {
            const notification = new Notification({ title: '任务提醒', body: task.title })
            notification.on('click', () => options.openTasksWorkspace(task.id))
            notification.show()
          } catch { /* 显示失败不阻塞消息中心留档 */ }
        }
        broadcast('tasks:reminder', { task })
      }
    }
  )
  const notifyChange = <T>(change: () => T): T => {
    const result = change()
    broadcast('tasks:changed')
    return result
  }
  ipcMain.handle('tasks:list', (_event, options) => store!.listTasks(options ?? {}))
  ipcMain.handle('tasks:trash', () => store!.listTrash())
  ipcMain.handle('tasks:restoreTrash', (_event, id: string) => notifyChange(() => store!.restoreTrash(id)))
  ipcMain.handle('tasks:purgeTrash', (_event, id: string) => notifyChange(() => store!.purgeTrash(id)))
  ipcMain.handle('tasks:exportBackup', async (event, settings: TaskUISettings) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('任务窗口不可用。')
    const target = await dialog.showSaveDialog(owner, { title: '备份任务与视图配置', defaultPath: `丑鱼任务备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: '任务备份', extensions: ['json'] }] })
    if (target.canceled || !target.filePath) return false
    await writeBackup(target.filePath, store!.exportBackup(settings))
    return true
  })
  ipcMain.handle('tasks:selectBackup', async event => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('任务窗口不可用。')
    pendingBackups.delete(event.sender.id)
    const target = await dialog.showOpenDialog(owner, { title: '选择任务备份', properties: ['openFile'], filters: [{ name: '任务备份', extensions: ['json'] }] })
    if (target.canceled || !target.filePaths[0]) return null
    const path = target.filePaths[0]
    if ((await fs.stat(path)).size > 100 * 1024 * 1024) throw new Error('备份超过 100 MB，请使用较小的备份。')
    const backup = store!.validateBackup(JSON.parse(await fs.readFile(path, 'utf8')))
    const token = randomUUID()
    pendingBackups.set(event.sender.id, { token, backup, expiresAt: Date.now() + 10 * 60_000 })
    return { token, createdAt: backup.createdAt, taskCount: backup.tables.tasks.length, projectCount: backup.tables.task_projects.length, trashCount: backup.tables.task_trash.length }
  })
  ipcMain.handle('tasks:restoreBackup', async (event, token: string, settings: TaskUISettings) => {
    const pending = pendingBackups.get(event.sender.id)
    if (!pending || pending.token !== token || pending.expiresAt < Date.now()) throw new Error('备份预览已过期，请重新选择文件。')
    const directory = join(app.getPath('userData'), 'task-backups')
    await fs.mkdir(directory, { recursive: true })
    const safetyBackupPath = join(directory, `before-restore-${Date.now()}-${randomUUID()}.json`)
    const before = store!.exportBackup(settings)
    await writeBackup(safetyBackupPath, before)
    if (JSON.stringify(store!.exportBackup(settings).tables) !== JSON.stringify(before.tables)) throw new Error('保存安全备份期间任务数据发生变化，请重新执行恢复。当前任务数据未被替换。')
    const restored = notifyChange(() => store!.restoreBackup(pending.backup))
    pendingBackups.delete(event.sender.id)
    return { settings: restored, safetyBackupPath }
  })
  ipcMain.handle('tasks:create', (_event, input) => notifyChange(() => store!.createTask(input ?? {})))
  ipcMain.handle('tasks:get', (_event, id: string) => store!.getTask(id))
  ipcMain.handle('tasks:update', (_event, id: string, patch) => notifyChange(() => store!.updateTask(id, patch ?? {})))
  ipcMain.handle('tasks:complete', (_event, id: string) => notifyChange(() => store!.completeTask(id)))
  ipcMain.handle('tasks:reopen', (_event, id: string) => notifyChange(() => store!.reopenTask(id)))
  ipcMain.handle('tasks:delete', (_event, id: string) => notifyChange(() => store!.deleteTask(id)))
  ipcMain.handle('tasks:projects', () => store!.listProjects())
  ipcMain.handle('tasks:groups', () => store!.listGroups())
  ipcMain.handle('tasks:createGroup', (_event, name: string) => notifyChange(() => store!.createGroup(name)))
  ipcMain.handle('tasks:renameGroup', (_event, id: string, name: string) => notifyChange(() => store!.renameGroup(id, name)))
  ipcMain.handle('tasks:deleteGroup', (_event, id: string, deleteContents?: boolean) => notifyChange(() => store!.deleteGroup(id, deleteContents)))
  ipcMain.handle('tasks:moveProject', (_event, id: string, groupId: string | null) => notifyChange(() => store!.moveProject(id, groupId)))
  ipcMain.handle('tasks:createProject', (_event, name: string, groupId?: string | null) => notifyChange(() => store!.createProject(name, groupId)))
  ipcMain.handle('tasks:renameProject', (_event, id: string, name: string) => notifyChange(() => store!.renameProject(id, name)))
  ipcMain.handle('tasks:archiveProject', (_event, id: string, archived: boolean) => notifyChange(() => store!.archiveProject(id, archived)))
  ipcMain.handle('tasks:deleteProject', (_event, id: string) => notifyChange(() => store!.deleteProject(id)))
  ipcMain.handle('tasks:views', () => store!.listViews())
  ipcMain.handle('tasks:createView', (_event, input) => notifyChange(() => store!.createView(input ?? {})))
  ipcMain.handle('tasks:updateView', (_event, id: string, patch) => notifyChange(() => store!.updateView(id, patch ?? {})))
  ipcMain.handle('tasks:deleteView', (_event, id: string) => notifyChange(() => store!.deleteView(id)))
  ipcMain.handle('tasks:fields', () => store!.listFields())
  ipcMain.handle('tasks:createField', (_event, input) => notifyChange(() => store!.createField(input ?? {})))
  ipcMain.handle('tasks:updateField', (_event, id: string, patch) => notifyChange(() => store!.updateField(id, patch ?? {})))
  ipcMain.handle('tasks:deleteField', (_event, id: string) => notifyChange(() => store!.deleteField(id)))

  ipcMain.on('tasks:ready', () => {
    if (readyDelivered) return
    readyDelivered = true
    if (storeRebuilt) broadcast('tasks:store-rebuilt')
    if (pendingBacklog > 0) broadcast('tasks:reminder', { backlog: pendingBacklog })
  })
}

export function closeTasks(): void {
  shuttingDown = true
  pendingBackups.clear()
  for (const channel of ['tasks:get', 'tasks:trash', 'tasks:restoreTrash', 'tasks:purgeTrash', 'tasks:exportBackup', 'tasks:selectBackup', 'tasks:restoreBackup']) ipcMain.removeHandler(channel)
  for (const channel of ['tasks:groups', 'tasks:createGroup', 'tasks:renameGroup', 'tasks:deleteGroup', 'tasks:moveProject', 'tasks:list', 'tasks:create', 'tasks:update', 'tasks:complete', 'tasks:reopen', 'tasks:delete', 'tasks:projects', 'tasks:createProject', 'tasks:renameProject', 'tasks:archiveProject', 'tasks:deleteProject', 'tasks:views', 'tasks:createView', 'tasks:updateView', 'tasks:deleteView', 'tasks:fields', 'tasks:createField', 'tasks:updateField', 'tasks:deleteField']) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners('tasks:ready')
  storeRebuilt = false
  pendingBacklog = 0
  readyDelivered = false
  scheduler?.stop()
  scheduler = undefined
  try { store?.close() } catch { /* 退出路径上尽力关闭 */ }
  store = undefined
}
