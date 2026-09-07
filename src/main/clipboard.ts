import { clipboard, BrowserWindow } from 'electron'

let lastText = ''
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

export function startClipboardWatcher(mainWindow: BrowserWindow): void {
  stopClipboardWatcher()
  const currentGeneration = generation
  let initialized = false
  const poll = async () => {
    try {
      const current = await clipboard.readText()
      if (generation !== currentGeneration || mainWindow.isDestroyed()) return
      if (initialized && current && current !== lastText) mainWindow.webContents.send('clipboard:changed', current)
      lastText = current
      initialized = true
    } catch {
      // A temporarily unavailable system clipboard should not stop future polling.
    } finally {
      if (generation === currentGeneration && !mainWindow.isDestroyed()) timer = setTimeout(() => { void poll() }, 1500)
    }
  }
  void poll()
}

export function setClipboardWatcherEnabled(mainWindow: BrowserWindow, enabled: boolean): void {
  if (enabled) startClipboardWatcher(mainWindow)
  else stopClipboardWatcher()
}

export function stopClipboardWatcher(): void {
  generation++
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
