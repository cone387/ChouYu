import { weeklyExport } from '../../shared/journal-weekly'
import { BookmarkShortcut } from './bookmark-shortcut'
import { app, BrowserWindow, ipcMain, globalShortcut, Notification, dialog } from 'electron'
import { promises as fs } from 'fs'
import { playbookMarkdown } from '../../shared/journal-playbook'
import { JournalPlaybookMemory } from './playbook-memory'
import { getConfig } from '../database'
import { createMemory } from '../memory/service'
import { join } from 'path'
import { JournalService } from './service'
import type { AppConfig } from '../../shared/config'

let service: JournalService | undefined
let shortcut: BookmarkShortcut | undefined
let shortcutError = ''
let configuring = Promise.resolve()
let shuttingDown = false
const journalStatus = () => ({ ...service!.status(), quickBookmarkError: shortcutError })
const quickBookmark = async () => {
  try {
    const saved = await service!.quickBookmark()
    shortcutError = ''
    if (shuttingDown) return
    openJournalWorkspace()
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('journal:bookmark-saved', saved.id)
  } catch (error) {
    shortcutError = error instanceof Error ? error.message : '书签保存失败，请重试。'
    if (shuttingDown) return
    if (Notification.isSupported()) new Notification({ title: '丑鱼书签未保存', body: shortcutError }).show()
    else openJournalWorkspace()
  }
}

let journalWindow: BrowserWindow | undefined
let openWorkspace: (() => void) | undefined

export function openJournalWorkspace(): void {
  if (openWorkspace) openWorkspace()
  else openJournalWindow()
}

export function openJournalWindow(): void {
  if (journalWindow && !journalWindow.isDestroyed()) {
    if (journalWindow.isMinimized()) journalWindow.restore()
    journalWindow.show(); journalWindow.focus(); return
  }
  const window = new BrowserWindow({
    title: '工作日志 · ChouYu', width: 1050, height: 760, minWidth: 560, minHeight: 440,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png'),
    show: false, autoHideMenuBar: true, backgroundColor: '#fbfbfd',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  journalWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { if (journalWindow === window) journalWindow = undefined })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '')}/?view=journal`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'journal' } })
}

export function initializeJournal(options: { recordingDisabled?: boolean; openWorkspace?: () => void } = {}): JournalService {
  openWorkspace = options.openWorkspace
  service = new JournalService(options)
  const playbookMemory = new JournalPlaybookMemory(() => service!.playbook(), getConfig, createMemory)
  ipcMain.handle('journal:preparePlaybookMemory', (event, input) => playbookMemory.prepare(event.sender.id, input))
  ipcMain.handle('journal:confirmPlaybookMemory', (event, token) => playbookMemory.confirm(event.sender.id, token))
  shuttingDown = false
  shortcut = new BookmarkShortcut(globalShortcut, () => { void quickBookmark() })
  void service.ready.then(() => { if (!shuttingDown && !options.recordingDisabled) { try { shortcut!.enable(Boolean(service!.status().config.quickBookmarkEnabled)) } catch (error) { shortcutError = String(error) } } })
  ipcMain.handle('journal:open', () => openJournalWorkspace())
  ipcMain.handle('journal:status', async () => { await service!.ready; return journalStatus() })
  ipcMain.handle('journal:configure', (_event, patch) => {
    const operation = configuring.then(async () => {
      await service!.ready
      const previous = Boolean(service!.status().config.quickBookmarkEnabled)
      const changesShortcut = patch && Object.prototype.hasOwnProperty.call(patch, 'quickBookmarkEnabled')
      if (changesShortcut && typeof patch.quickBookmarkEnabled !== 'boolean') throw new Error('快捷键开关无效。')
      if (changesShortcut && options.recordingDisabled && patch.quickBookmarkEnabled) throw new Error('隔离回归不注册全局快捷键。')
      if (changesShortcut) shortcut!.enable(patch.quickBookmarkEnabled)
      try { await service!.configure(patch); if (changesShortcut) shortcutError = ''; return journalStatus() }
      catch (error) { if (changesShortcut) { try { shortcut!.enable(previous) } catch {} }; throw error }
    })
    configuring = operation.then(() => {}, () => {})
    return operation
  })
  ipcMain.handle('journal:retrySavedOcr', (_event, id) => service!.retrySavedOcr(id))
  ipcMain.handle('journal:list', (_event, query) => service!.list(query))
  ipcMain.handle('journal:prepareSemantic', (_event, query) => service!.prepareSemantic(query))
  ipcMain.handle('journal:searchSemantic', (_event, id) => service!.searchSemantic(id))
  ipcMain.handle('journal:clearSemanticCache', () => service!.clearSemanticCache())
  ipcMain.handle('journal:cancelSemantic', () => service!.cancelSemantic())
  ipcMain.handle('journal:generateContinuations', (_event, input) => service!.generateContinuations(input))
  ipcMain.handle('journal:saveItem', (_event, input) => service!.saveItem(input))
  ipcMain.handle('journal:savedImage', (_event, input) => service!.savedImage(input))
  ipcMain.handle('journal:updateSaved', (_event, input) => service!.updateSaved(input))
  ipcMain.handle('journal:deleteSaved', (_event, input) => service!.deleteSaved(input))
  ipcMain.handle('journal:savedItems', () => service!.savedItems())
  ipcMain.handle('journal:projects', () => service!.projects())
  ipcMain.handle('journal:weeklySources', (_event, range) => service!.weeklySources(range))
  ipcMain.handle('journal:weekly', () => service!.weekly())
  ipcMain.handle('journal:createWeekly', (_event, input) => service!.createWeekly(input))
  ipcMain.handle('journal:editWeekly', (_event, input) => service!.editWeekly(input))
  ipcMain.handle('journal:deleteWeekly', (_event, input) => service!.deleteWeekly(input))
  ipcMain.handle('journal:playbook', () => service!.playbook())
  ipcMain.handle('journal:savePlaybook', (_event, input) => service!.savePlaybook(input))
  ipcMain.handle('journal:deletePlaybook', (_event, input) => service!.deletePlaybook(input))
  ipcMain.handle('journal:exportPlaybook', async (event, input: { id: string; revision: number }) => {
    if (!input || typeof input.id !== 'string' || !Number.isSafeInteger(input.revision)) throw new Error('无效手册版本。')
    const current = async () => {
      const entry = (await service!.playbook()).find(value => value.id === input.id)
      if (!entry || entry.revision !== input.revision) throw new Error('手册已修改或删除，请刷新后再导出。')
      return entry
    }
    await current()
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('导出窗口已关闭。')
    const target = await dialog.showSaveDialog(owner, { title: '导出踩坑手册', defaultPath: `踩坑手册-${input.id}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (target.canceled || !target.filePath) return false
    await fs.writeFile(target.filePath, playbookMarkdown(await current()), 'utf8')
    return true
  })
  ipcMain.handle('journal:exportWeekly', async (event, input: { id: string; revision: number }) => {
    if (!input || typeof input.id !== 'string' || !Number.isSafeInteger(input.revision)) throw new Error('无效周报版本。')
    const current = async () => {
      const entry = (await service!.weekly()).find(value => value.id === input.id)
      if (!entry || entry.revision !== input.revision) throw new Error('周报已修改或删除，请刷新后再导出。')
      return entry
    }
    await current()
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('导出窗口已关闭。')
    const target = await dialog.showSaveDialog(owner, { title: '导出周报', defaultPath: `周报-${input.id}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (target.canceled || !target.filePath) return false
    await fs.writeFile(target.filePath, weeklyExport(await current()), 'utf8')
    return true
  })
  ipcMain.handle('journal:saveProject', (_event, input) => service!.saveProject(input))
  ipcMain.handle('journal:deleteProject', (_event, id) => service!.deleteProject(id))
  ipcMain.handle('journal:assignProject', (_event, input) => service!.assignProject(input))
  ipcMain.handle('journal:savedUsage', () => service!.savedUsage())
  ipcMain.handle('journal:tasks', (_event, query) => service!.tasks(query))
  ipcMain.handle('journal:detail', (_event, input) => service!.detail(input))
  ipcMain.handle('journal:edit-task', (_event, input) => service!.editTask(input))
  ipcMain.handle('journal:delete-activity', (_event, id) => service!.deleteActivity(id))
  ipcMain.handle('journal:delete-capture', (_event, id) => service!.deleteCapture(id))
  ipcMain.handle('journal:capture-info', (_event, id) => service!.captureInfo(id))
  ipcMain.handle('journal:delete-range', (_event, range) => service!.deleteRange(range))
  ipcMain.handle('journal:captures', (_event, query) => service!.captures(query))
  ipcMain.handle('journal:image', (_event, id) => service!.image(id))
  ipcMain.handle('journal:retry-ocr', (_event, id) => service!.retryOcr(id))
  ipcMain.handle('journal:summarize', (_event, range) => service!.summarize(range))
  ipcMain.handle('journal:summary', (_event, range) => service!.summary(range))
  ipcMain.handle('journal:analysis-records', (_event, range) => service!.analysisRecords(range))
  ipcMain.handle('journal:overview', (_event, range) => service!.overview(range))
  ipcMain.handle('journal:ask', (_event, input) => service!.ask(input))
  ipcMain.handle('journal:cancel-analysis', () => service!.cancelAnalysis())
  return service
}

export function toggleJournalPause(): void {
  if (service?.status().config.enabled) void service.configure({ paused: !service.status().config.paused }).catch(() => openJournalWorkspace())
}

export function getJournalStatus() { return service?.status() }

export async function closeJournal(): Promise<void> { shuttingDown = true; await configuring; shortcut?.enable(false); await service?.close() }

export function notifyJournalConfig(config: AppConfig): void {
  if (journalWindow && !journalWindow.isDestroyed()) journalWindow.webContents.send('config:changed', config)
}
