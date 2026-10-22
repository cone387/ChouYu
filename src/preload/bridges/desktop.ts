
import type { IpcRenderer } from 'electron'

export function createDesktopBridge(ipcRenderer: IpcRenderer) {

return {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  getSystemIdleSeconds: () => ipcRenderer.invoke('system-idle-seconds') as Promise<number>,

  quitApp: () => ipcRenderer.invoke('quit-app'),

  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },

  onMouseEventsState: (callback: (ignored: boolean) => void) => {
    const handler = (_event: unknown, ignored: boolean) => callback(ignored)
    ipcRenderer.on('mouse-events-state', handler)
    return () => { ipcRenderer.removeListener('mouse-events-state', handler) }
  },

  onCursorPosition: (callback: (point: { x: number; y: number }) => void) => {
    const handler = (_event: unknown, point: { x: number; y: number }) => callback(point)
    ipcRenderer.on('cursor-position', handler)
    return () => { ipcRenderer.removeListener('cursor-position', handler) }
  },

  setWindowAlwaysOnTop: (alwaysOnTop: boolean) => {
    ipcRenderer.send('set-window-always-on-top', alwaysOnTop)
  },

  log: (msg: string) => {
    ipcRenderer.send('renderer-log', msg)
  },

  onTogglePanel: (callback: () => void) => {
    ipcRenderer.on('toggle-panel', callback)
    return () => {
      ipcRenderer.removeListener('toggle-panel', callback)
    }
  },

  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback)
    return () => {
      ipcRenderer.removeListener('open-settings', callback)
    }
  },

  onHidePanel: (callback: () => void) => {
    ipcRenderer.on('hide-panel', callback)
    return () => {
      ipcRenderer.removeListener('hide-panel', callback)
    }
  },

  onPluginHotkey: (callback: (pluginId: string) => void) => {
    const handler = (_e: unknown, pluginId: string) => callback(pluginId)
    ipcRenderer.on('plugin-hotkey', handler)
    return () => { ipcRenderer.removeListener('plugin-hotkey', handler) }
  },

  onClipboardChange: (callback: (text: string) => void) => {
    const handler = (_e: unknown, text: string) => callback(text)
    ipcRenderer.on('clipboard:changed', handler)
    return () => { ipcRenderer.removeListener('clipboard:changed', handler) }
  },

  onSetPetVisible: (callback: (visible: boolean) => void) => {
    const handler = (_e: unknown, visible: boolean) => callback(visible)
    ipcRenderer.on('set-pet-visible', handler)
    return () => { ipcRenderer.removeListener('set-pet-visible', handler) }
  },

  notifyPetVisible: (visible: boolean) => {
    ipcRenderer.send('pet-visibility-changed', visible)
  },

  update: {
    onAvailable: (callback: (info: { version: string }) => void) => {
      const handler = (_e: unknown, info: { version: string }) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
    },
    onNotAvailable: (callback: () => void) => {
      ipcRenderer.on('update:not-available', callback)
      return () => { ipcRenderer.removeListener('update:not-available', callback) }
    },
    onDownloading: (callback: () => void) => {
      ipcRenderer.on('update:downloading', callback)
      return () => { ipcRenderer.removeListener('update:downloading', callback) }
    },
    onProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
      const handler = (_e: unknown, progress: { percent: number; transferred: number; total: number }) => callback(progress)
      ipcRenderer.on('update:progress', handler)
      return () => { ipcRenderer.removeListener('update:progress', handler) }
    },
    onDownloaded: (callback: (info: { version: string }) => void) => {
      const handler = (_e: unknown, info: { version: string }) => callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => { ipcRenderer.removeListener('update:downloaded', handler) }
    },
    onError: (callback: (message: string) => void) => {
      const handler = (_e: unknown, msg: string) => callback(msg)
      ipcRenderer.on('update:error', handler)
      return () => { ipcRenderer.removeListener('update:error', handler) }
    }
  }
}
}
