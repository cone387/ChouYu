import type { AIStreamEvent, AIStreamRequest, AIStreamResult } from '../../shared/ai'
import type { ToolApprovalRequest, ToolExecutionEvent } from '../../shared/tools'
import type { IpcRenderer } from 'electron'

export function createChatBridge(ipcRenderer: IpcRenderer) {

return {
  ai: {
    startStream: (request: AIStreamRequest) =>
      ipcRenderer.invoke('ai:stream', request) as Promise<AIStreamResult>,
    cancelStream: (requestId: string) => {
      ipcRenderer.send('ai:cancel', requestId)
    },
    resolveToolRequest: (approvalId: string, approved: boolean) => {
      ipcRenderer.send('ai:resolve-tool-request', approvalId, approved)
    },
    onToolApprovalRequest: (callback: (request: ToolApprovalRequest) => void) => {
      const handler = (_event: unknown, request: ToolApprovalRequest) => callback(request)
      ipcRenderer.on('ai:tool-approval-request', handler)
      return () => { ipcRenderer.removeListener('ai:tool-approval-request', handler) }
    },
    onToolEvent: (callback: (event: ToolExecutionEvent) => void) => {
      const handler = (_event: unknown, toolEvent: ToolExecutionEvent) => callback(toolEvent)
      ipcRenderer.on('ai:tool-event', handler)
      return () => { ipcRenderer.removeListener('ai:tool-event', handler) }
    },
    onStreamEvent: (callback: (event: AIStreamEvent) => void) => {
      const handler = (_event: unknown, streamEvent: AIStreamEvent) => callback(streamEvent)
      ipcRenderer.on('ai:stream-event', handler)
      return () => { ipcRenderer.removeListener('ai:stream-event', handler) }
    }
  }
}
}
