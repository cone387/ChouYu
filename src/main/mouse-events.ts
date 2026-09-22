import { screen, powerMonitor } from 'electron'
import type { BrowserWindow } from 'electron'

const CURSOR_SEND_THRESHOLD_PX = 4
const DEFAULT_POLL_INTERVAL_MS = 300

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

// 全屏透明覆盖层的点击穿透状态以这里为唯一权威：Chromium 的 {forward:true}
// 鼠标移动转发在 Windows 上会在睡眠/锁屏/DPI 变化后静默失效，因此期望状态
// 由本控制器持有，在环境事件后重新断言，并把每次变更广播给 renderer 同步认知。
export function attachMouseEventsController(win: MouseEventsWindow, environment?: Partial<MouseEventsEnvironment>): MouseEventsController {
  const env: MouseEventsEnvironment = {
    screen: environment?.screen ?? screen,
    powerMonitor: environment?.powerMonitor ?? powerMonitor,
    pollIntervalMs: environment?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  let desired = true

  const apply = (): void => {
    if (win.isDestroyed()) return
    win.setIgnoreMouseEvents(desired, desired ? { forward: true } : undefined)
    if (!win.webContents.isDestroyed()) win.webContents.send(CHANNEL_STATE, desired)
  }

  const setIgnored = (ignore: boolean): void => {
    desired = ignore
    apply()
  }

  let lastSent: { x: number; y: number } | null = null
  const sendCursorPosition = (): void => {
    if (win.isDestroyed() || !win.isVisible() || win.webContents.isDestroyed()) return
    const point = env.screen.getCursorScreenPoint()
    if (lastSent && Math.abs(point.x - lastSent.x) < CURSOR_SEND_THRESHOLD_PX && Math.abs(point.y - lastSent.y) < CURSOR_SEND_THRESHOLD_PX) return
    lastSent = { x: point.x, y: point.y }
    const bounds = win.getContentBounds()
    win.webContents.send(CHANNEL_CURSOR, { x: point.x - bounds.x, y: point.y - bounds.y })
  }

  const timer = setInterval(sendCursorPosition, env.pollIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()

  const windowEvents = ['show', 'restore', 'focus']
  for (const event of windowEvents) win.on(event, apply)
  const powerEvents = ['resume', 'unlock-screen']
  for (const event of powerEvents) env.powerMonitor.on(event, apply)
  const screenEvents = ['display-metrics-changed', 'display-added', 'display-removed']
  for (const event of screenEvents) env.screen.on(event, apply)

  const dispose = (): void => {
    clearInterval(timer)
    for (const event of windowEvents) win.removeListener(event, apply)
    for (const event of powerEvents) env.powerMonitor.removeListener(event, apply)
    for (const event of screenEvents) env.screen.removeListener(event, apply)
  }
  win.on('closed', dispose)

  apply()
  return { setIgnored, dispose }
}

let controller: MouseEventsController | null = null

export function attachMainWindowMouseEvents(win: BrowserWindow): MouseEventsController {
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
