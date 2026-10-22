import type { ToolCatalogItem } from '../../shared/tools'
import type { CapabilityInfo } from '../../shared/capabilities'
import type { IpcRenderer } from 'electron'

export function createToolsBridge(ipcRenderer: IpcRenderer) {

return {
  tools: {
    list: () => ipcRenderer.invoke('tools:list') as Promise<ToolCatalogItem[]>,
    setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('tools:set-enabled', name, enabled) as Promise<ToolCatalogItem[]>
  },

  capabilities: {
    list: () => ipcRenderer.invoke('capabilities:list') as Promise<CapabilityInfo[]>
  }
}
}
