import { contextBridge, ipcRenderer } from 'electron'

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
