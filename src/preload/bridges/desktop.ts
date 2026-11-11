import type { AppUpdateState } from '../../shared/updates'

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
    getState: () => ipcRenderer.invoke('update:get-state') as Promise<AppUpdateState>,
    download: () => ipcRenderer.invoke('update:download') as Promise<AppUpdateState>,
    install: () => ipcRenderer.invoke('update:install') as Promise<AppUpdateState>,
    onState: (callback: (state: AppUpdateState) => void) => {
      const handler = (_event: unknown, state: AppUpdateState) => callback(state)
      ipcRenderer.on('update:state', handler)
      return () => { ipcRenderer.removeListener('update:state', handler) }
    }
  }
}
}
