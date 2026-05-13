import { globalShortcut, BrowserWindow } from 'electron'
import { getState } from './database'

let registeredPluginHotkeys: string[] = []

export function registerHotkey(mainWindow: BrowserWindow): void {
  globalShortcut.register('Alt+Space', () => {
    // Focus the window so the textarea can receive keyboard input
    // On Windows, transparent windows need explicit focus
    if (!mainWindow.isFocused()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(true, 'floating')
    }
    mainWindow.webContents.send('toggle-panel')
  })

  // Register plugin hotkeys
  loadPluginHotkeys(mainWindow)
}

function loadPluginHotkeys(mainWindow: BrowserWindow): void {
  const hotkeysJson = getState('plugin-hotkeys')
  if (!hotkeysJson) return
  try {
    const hotkeys: Record<string, string> = JSON.parse(hotkeysJson)
    for (const [pluginId, accelerator] of Object.entries(hotkeys)) {
      if (!accelerator) continue
      try {
        globalShortcut.register(accelerator, () => {
          if (!mainWindow.isFocused()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver')
            mainWindow.focus()
            mainWindow.setAlwaysOnTop(true, 'floating')
          }
          mainWindow.webContents.send('plugin-hotkey', pluginId)
        })
        registeredPluginHotkeys.push(accelerator)
      } catch (err) {
        console.error(`[Hotkey] Failed to register plugin hotkey "${accelerator}" for ${pluginId}:`, err)
      }
    }
  } catch (err) {
    console.error('[Hotkey] Failed to parse plugin-hotkeys:', err)
  }
}

export function reloadPluginHotkeys(mainWindow: BrowserWindow): void {
  // Unregister old plugin hotkeys
  for (const accelerator of registeredPluginHotkeys) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {}
  }
  registeredPluginHotkeys = []
  // Re-register from current state
  loadPluginHotkeys(mainWindow)
}
