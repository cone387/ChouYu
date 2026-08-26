import { clipboard, BrowserWindow } from 'electron'

let lastText = ''
let timer: ReturnType<typeof setInterval> | null = null

export function startClipboardWatcher(mainWindow: BrowserWindow): void {
  stopClipboardWatcher()
  lastText = clipboard.readText() || ''

  timer = setInterval(() => {
    const current = clipboard.readText() || ''
    if (current && current !== lastText) {
      lastText = current
      mainWindow.webContents.send('clipboard:changed', current)
    }
  }, 1500)
}

export function setClipboardWatcherEnabled(mainWindow: BrowserWindow, enabled: boolean): void {
  if (enabled) startClipboardWatcher(mainWindow)
  else stopClipboardWatcher()
}

export function stopClipboardWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
