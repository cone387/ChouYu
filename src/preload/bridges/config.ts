import type { AppConfig } from '../../shared/config'
import type { AIModelListResult, ProviderDiagnostics } from '../../shared/ai'
import type { IpcRenderer } from 'electron'

export function createConfigBridge(ipcRenderer: IpcRenderer) {

return {
  fetchModels: () => ipcRenderer.invoke('fetch-models') as Promise<AIModelListResult>,

  diagnoseProvider: () => ipcRenderer.invoke('diagnose-provider') as Promise<ProviderDiagnostics>,

  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_e: unknown, config: AppConfig) => callback(config)
    ipcRenderer.on('config:changed', handler)
    return () => { ipcRenderer.removeListener('config:changed', handler) }
  },

  providerProfiles: {
    list: () => ipcRenderer.invoke('provider-profiles:list'),
    save: (profile: unknown) => ipcRenderer.invoke('provider-profiles:save', profile),
    remove: (id: string) => ipcRenderer.invoke('provider-profiles:delete', id)
  }
}
}
