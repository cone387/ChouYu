import { globalShortcut, BrowserWindow } from 'electron'
import { getConfig, getState, saveConfig } from './database'
import { pluginRegistry } from './plugins/registry'

let registeredPluginHotkeys: string[] = []
let registeredMainHotkey = ''
let currentWindow: BrowserWindow | null = null

export function registerHotkey(mainWindow: BrowserWindow): void {
  currentWindow = mainWindow
  const configuredHotkey = getConfig().hotkey
  let registered = false
  try {
    registered = registerMainHotkey(configuredHotkey)
  } catch (err) {
    console.error(`[Hotkey] Invalid main hotkey "${configuredHotkey}":`, err)
  }
  if (!registered) {
    registerMainHotkey('Alt+Space')
    saveConfig({ hotkey: 'Alt+Space' })
  }

  // Register plugin hotkeys
  loadPluginHotkeys(mainWindow)
}

function registerMainHotkey(accelerator: string): boolean {
  if (!currentWindow) return false
  const registered = globalShortcut.register(accelerator, () => {
    // Focus the window so the textarea can receive keyboard input
    // On Windows, transparent windows need explicit focus
    if (!currentWindow || currentWindow.isDestroyed()) return
    if (!currentWindow.isFocused()) {
      currentWindow.setAlwaysOnTop(true, 'screen-saver')
      currentWindow.focus()
      currentWindow.setAlwaysOnTop(true, 'floating')
    }
    currentWindow.webContents.send('toggle-panel')
  })
  if (registered) registeredMainHotkey = accelerator
  return registered
}

export function updateMainHotkey(accelerator: string): boolean {
  if (!accelerator || !currentWindow) return false
  if (accelerator === registeredMainHotkey) return true

  const previous = registeredMainHotkey
  if (previous) globalShortcut.unregister(previous)
  registeredMainHotkey = ''

  try {
    if (registerMainHotkey(accelerator)) return true
  } catch (err) {
    console.error(`[Hotkey] Failed to register main hotkey "${accelerator}":`, err)
  }

  if (previous) registerMainHotkey(previous)
  return false
}

function loadPluginHotkeys(mainWindow: BrowserWindow): void {
  const hotkeysJson = getState('plugin-hotkeys')
  const hotkeys: Record<string, string> = {}
  try {
    if (hotkeysJson) Object.assign(hotkeys, JSON.parse(hotkeysJson))
    for (const plugin of pluginRegistry.getPlugins()) {
      const accelerator = getState(`plugin:${plugin.id}:hotkey`)
      if (accelerator) hotkeys[plugin.id] = accelerator
    }
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
