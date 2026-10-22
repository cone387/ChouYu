import { ipcMain } from 'electron'
import type { ChatRuntime } from '../chat/runtime'
import { parseAIStreamRequest } from '../chat/request'
import { registerDomain } from './registration'

export function registerChatHandlers({ service, approvals }: ChatRuntime): () => void {
  return registerDomain(ipcMain, ipc => {
    ipc.handle('ai:stream', (event, rawRequest) => {
      const request = parseAIStreamRequest(rawRequest)
      return request ? service.run(event.sender, request) : { ok: false, error: 'AI 请求参数无效。' }
    })
    ipc.on('ai:cancel', (event, requestId: unknown) => {
      if (typeof requestId === 'string') service.cancel(event.sender.id, requestId)
    })
    ipc.on('ai:resolve-tool-request', (event, approvalId: unknown, approved: unknown) => {
      if (typeof approvalId === 'string' && typeof approved === 'boolean') approvals.resolve(event.sender.id, approvalId, approved)
    })
  })
}
