import { globalShortcut, BrowserWindow } from 'electron'
import { getConfig, getState, saveConfig } from './database'
import { pluginRegistry } from './plugins/registry'

let registeredPluginHotkeys: string[] = []
let registeredMainHotkey = ''
let currentWindow: BrowserWindow | null = null

function focusWithoutChangingWindowMode(window: BrowserWindow): void {
  if (window.isFocused()) return
  const wasAlwaysOnTop = window.isAlwaysOnTop()
  window.setAlwaysOnTop(true, 'screen-saver')
  window.focus()
  window.setAlwaysOnTop(wasAlwaysOnTop, 'floating')
}

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
    focusWithoutChangingWindowMode(currentWindow)
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

function loadPluginHotkeys(mainWindow: BrowserWindow): string[] {
  const hotkeysJson = getState('plugin-hotkeys')
  const hotkeys: Record<string, string> = {}
  const failedPluginIds: string[] = []
  try {
    if (hotkeysJson) Object.assign(hotkeys, JSON.parse(hotkeysJson))
    for (const plugin of pluginRegistry.getPlugins()) {
      const accelerator = getState(`plugin:${plugin.id}:hotkey`)
      if (accelerator !== null) hotkeys[plugin.id] = accelerator
    }
    for (const [pluginId, accelerator] of Object.entries(hotkeys)) {
      if (!accelerator) continue
      try {
        const registered = globalShortcut.register(accelerator, () => {
          focusWithoutChangingWindowMode(mainWindow)
          mainWindow.webContents.send('plugin-hotkey', pluginId)
        })
        if (registered) registeredPluginHotkeys.push(accelerator)
        else failedPluginIds.push(pluginId)
      } catch (err) {
        failedPluginIds.push(pluginId)
        console.error(`[Hotkey] Failed to register plugin hotkey "${accelerator}" for ${pluginId}:`, err)
      }
    }
  } catch (err) {
    console.error('[Hotkey] Failed to parse plugin-hotkeys:', err)
  }
  return failedPluginIds
}

export function reloadPluginHotkeys(mainWindow: BrowserWindow): string[] {
  // Unregister old plugin hotkeys
  for (const accelerator of registeredPluginHotkeys) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {}
  }
  registeredPluginHotkeys = []
  // Re-register from current state
  return loadPluginHotkeys(mainWindow)
}
