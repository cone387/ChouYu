import { contextBridge, ipcRenderer } from 'electron'

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  log: (msg: string) => {
    ipcRenderer.send('renderer-log', msg)
  },
  takeScreenshot: (hideWindow?: boolean) => ipcRenderer.invoke('take-screenshot', hideWindow),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  fetchModels: () => ipcRenderer.invoke('fetch-models'),
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
  db: {
    getConfig: () => ipcRenderer.invoke('db:get-config'),
    saveConfig: (cfg: Record<string, unknown>) => ipcRenderer.invoke('db:save-config', cfg),
    getMessages: () => ipcRenderer.invoke('db:get-messages'),
    saveMessages: (msgs: unknown[]) => ipcRenderer.invoke('db:save-messages', msgs),
    clearMessages: () => ipcRenderer.invoke('db:clear-messages'),
    getState: (key: string) => ipcRenderer.invoke('db:get-state', key),
    setState: (key: string, value: string) => ipcRenderer.invoke('db:set-state', key, value)
  },
  update: {
    onAvailable: (callback: (info: { version: string }) => void) => {
      const handler = (_e: unknown, info: { version: string }) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
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

contextBridge.exposeInMainWorld('electronAPI', api)
