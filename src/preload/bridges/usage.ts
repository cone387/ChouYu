import type { IpcRenderer } from 'electron'
import type { UsageAPI } from '../../shared/usage'

export function createUsageBridge(ipc: Pick<IpcRenderer, 'invoke'>): { usage: UsageAPI } {
  return { usage: { statistics: range => ipc.invoke('usage:statistics', range) } }
}
