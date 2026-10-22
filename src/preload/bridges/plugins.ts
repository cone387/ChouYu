
import type { IpcRenderer } from 'electron'

export function createPluginsBridge(ipcRenderer: IpcRenderer) {

return {
  plugin: {
    execute: (pluginId: string, content: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:execute`, content),
    login: (pluginId: string, credentials: Record<string, string>) =>
      ipcRenderer.invoke(`plugin:${pluginId}:login`, credentials),
    logout: (pluginId: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:logout`),
    isAuthenticated: (pluginId: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:is-authenticated`),
    getPlugins: () =>
      ipcRenderer.invoke('plugin:get-plugins')
  }
}
}
