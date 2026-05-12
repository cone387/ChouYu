import { contextBridge, ipcRenderer } from 'electron'

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  log: (msg: string) => {
    ipcRenderer.send('renderer-log', msg)
  },
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
