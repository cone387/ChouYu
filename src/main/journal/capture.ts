import { app, BrowserWindow, desktopCapturer, session, type DesktopCapturerSource } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'

let acquiring = false
let captureWindow: BrowserWindow | undefined
let allowedSource: DesktopCapturerSource | undefined
let cancel: (() => void) | undefined

async function getCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow
  const captureSession = session.fromPartition('journal-window-capture')
  const window = new BrowserWindow({
    show: false, focusable: false, skipTaskbar: true, width: 64, height: 64,
    webPreferences: { session: captureSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  captureWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  captureSession.setPermissionCheckHandler((contents, permission, _origin, details) => !window.isDestroyed() && contents === window.webContents && acquiring && permission === 'media' && details.mediaType !== 'audio')
  captureSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(!window.isDestroyed() && contents === window.webContents && acquiring && permission === 'media' && !('mediaTypes' in details && details.mediaTypes?.includes('audio'))))
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    const source = allowedSource
    allowedSource = undefined
    if (!source || window.isDestroyed() || request.frame !== window.webContents.mainFrame || !request.videoRequested || request.audioRequested) { callback({}); return }
    callback({ video: source })
  })
  const directory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  await window.loadFile(join(directory, 'journal-capture.html'))
  return window
}

/** Destroying the isolated capturer stops an in-flight stream on pause/lock/quit. */
export function stopJournalCapture(): void {
  allowedSource = undefined
  cancel?.()
  const window = captureWindow; captureWindow = undefined
  if (window && !window.isDestroyed()) window.destroy()
}

/** Enumerate metadata only, then capture a single HWND. Never fall back to the desktop. */
export async function captureJournalWindow(hwnd: string) {
  if (!/^\d+$/.test(hwnd) || BigInt(hwnd) <= 0n) throw new Error('窗口标识无效。')
  if (acquiring) throw new Error('上一轮画面采集尚未结束，已跳过。')
  acquiring = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  const cancellation = new Promise<never>((_, reject) => {
    cancel = () => { cancelled = true; reject(new Error('窗口画面采集已取消或超时，活动记录仍会继续。')) }
    timer = setTimeout(stopJournalCapture, 8000)
  })
  const acquisition = (async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    if (cancelled) throw new Error('画面采集已取消。')
    const source = sources.find(item => item.id.split(':')[1] === hwnd)
    if (!source) throw new Error('当前窗口无法采集画面，活动记录仍会继续。')
    const window = await getCaptureWindow()
    if (cancelled) throw new Error('画面采集已取消。')
    allowedSource = source
    const result = await window.webContents.executeJavaScript('window.captureJournalFrame()', true) as { data: string; width: number; height: number; error?: string }
    if (cancelled) throw new Error('画面采集已取消。')
    if (result?.error) throw new Error(`当前窗口画面采集失败：${result.error}`)
    if (!result || !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 32 || result.height < 32 || result.width > 1920 || result.height > 1080 || typeof result.data !== 'string' || !result.data.startsWith('data:image/jpeg;base64,') || result.data.length > 7_000_000) throw new Error('窗口画面无效，已跳过。')
    const bytes = Buffer.from(result.data.slice('data:image/jpeg;base64,'.length), 'base64')
    return { bytes, width: result.width, height: result.height, hash: createHash('sha256').update(bytes).digest('hex') }
  })()
  // Electron cannot cancel metadata enumeration; keep the guard until it settles.
  void acquisition.finally(() => { acquiring = false }).catch(() => {})
  try { return await Promise.race([acquisition, cancellation]) }
  catch (error) { stopJournalCapture(); throw error }
  finally { clearTimeout(timer); cancel = undefined; allowedSource = undefined }
}
