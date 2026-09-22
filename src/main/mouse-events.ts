import { screen, powerMonitor } from 'electron'
import type { BrowserWindow } from 'electron'

const DEFAULT_POLL_INTERVAL_MS = 300
const WINDOWS_POLL_INTERVAL_MS = 75

const CHANNEL_STATE = 'mouse-events-state'
const CHANNEL_CURSOR = 'cursor-position'

export interface MouseEventsController {
  setIgnored(ignore: boolean): void
  dispose(): void
}

export interface MouseEventsWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void
  getContentBounds(): { x: number; y: number }
  on(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
  webContents: {
    isDestroyed(): boolean
    send(channel: string, payload: unknown): void
  }
}

export interface MouseEventsEnvironment {
  platform?: NodeJS.Platform
  screen: {
    getCursorScreenPoint(): { x: number; y: number }
    on(event: string, listener: () => void): void
    removeListener(event: string, listener: () => void): void
  }
  powerMonitor: {
    on(event: string, listener: () => void): void
    removeListener(event: string, listener: () => void): void
  }
  pollIntervalMs?: number
}

// Windows forwarding installs WH_MOUSE_LL on Electron's UI thread. Synchronous
// storage or a busy main thread can then delay mouse input across the desktop.
// Poll coordinates instead; never put this process in the global input path.
export function attachMouseEventsController(win: MouseEventsWindow, environment?: Partial<MouseEventsEnvironment>): MouseEventsController {
  const platform = environment?.platform ?? process.platform
  const env: MouseEventsEnvironment = {
    screen: environment?.screen ?? screen,
    powerMonitor: environment?.powerMonitor ?? powerMonitor,
    pollIntervalMs: environment?.pollIntervalMs ?? (platform === 'win32' ? WINDOWS_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS)
  }

  let desired = true
  let disposed = false
  let paused = false

  const apply = (): void => {
    if (disposed || win.isDestroyed()) return
    win.setIgnoreMouseEvents(desired, desired ? { forward: platform !== 'win32' } : undefined)
    if (!win.webContents.isDestroyed()) win.webContents.send(CHANNEL_STATE, desired)
  }

  const setIgnored = (ignore: boolean): void => {
    if (disposed || desired === ignore) return
    desired = ignore
    apply()
  }

  let lastSent: { x: number; y: number } | null = null
  const sendCursorPosition = (): void => {
    if (disposed || paused || win.isDestroyed() || !win.isVisible() || win.webContents.isDestroyed()) return
    const point = env.screen.getCursorScreenPoint()
    const bounds = win.getContentBounds()
    const relative = { x: point.x - bounds.x, y: point.y - bounds.y }
    // Even one pixel can cross an interactive boundary. Also detect window moves.
    if (lastSent && relative.x === lastSent.x && relative.y === lastSent.y) return
    lastSent = relative
    win.webContents.send(CHANNEL_CURSOR, relative)
  }

  const timer = setInterval(sendCursorPosition, env.pollIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()

  const refresh = (): void => { lastSent = null; apply(); sendCursorPosition() }
  const pause = (): void => { paused = true }
  const resume = (): void => { paused = false; refresh() }
  const windowEvents = ['show', 'restore', 'focus', 'move', 'resize']
  for (const event of windowEvents) win.on(event, refresh)
  const powerEvents = ['resume', 'unlock-screen']
  for (const event of powerEvents) env.powerMonitor.on(event, resume)
  const pauseEvents = ['suspend', 'lock-screen']
  for (const event of pauseEvents) env.powerMonitor.on(event, pause)
  const screenEvents = ['display-metrics-changed', 'display-added', 'display-removed']
  for (const event of screenEvents) env.screen.on(event, refresh)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    for (const event of windowEvents) win.removeListener(event, refresh)
    for (const event of powerEvents) env.powerMonitor.removeListener(event, resume)
    for (const event of pauseEvents) env.powerMonitor.removeListener(event, pause)
    for (const event of screenEvents) env.screen.removeListener(event, refresh)
    win.removeListener('closed', dispose)
  }
  win.on('closed', dispose)

  apply()
  return { setIgnored, dispose }
}

let controller: MouseEventsController | null = null

export function attachMainWindowMouseEvents(win: BrowserWindow): MouseEventsController {
  controller?.dispose()
  controller = attachMouseEventsController(win as unknown as MouseEventsWindow)
  return controller
}

export function setWindowMouseIgnored(ignore: boolean): void {
  controller?.setIgnored(ignore)
}

export function detachMainWindowMouseEvents(): void {
  controller?.dispose()
  controller = null
}
