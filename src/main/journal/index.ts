import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { JournalService } from './service'
import type { AppConfig } from '../../shared/config'

let service: JournalService | undefined
let journalWindow: BrowserWindow | undefined

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

export function initializeJournal(options: { recordingDisabled?: boolean } = {}): JournalService {
  service = new JournalService(options)
  ipcMain.handle('journal:open', () => openJournalWindow())
  ipcMain.handle('journal:status', async () => { await service!.ready; return service!.status() })
  ipcMain.handle('journal:configure', (_event, patch) => service!.configure(patch))
  ipcMain.handle('journal:list', (_event, query) => service!.list(query))
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
  if (service?.status().config.enabled) void service.configure({ paused: !service.status().config.paused }).catch(() => openJournalWindow())
}

export function getJournalStatus() { return service?.status() }

export async function closeJournal(): Promise<void> { await service?.close() }

export function notifyJournalConfig(config: AppConfig): void {
  if (journalWindow && !journalWindow.isDestroyed()) journalWindow.webContents.send('config:changed', config)
}
