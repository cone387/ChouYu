import { ipcMain } from 'electron'
import type { ChatRuntime } from '../chat/runtime'
import { parseAIStreamRequest } from '../chat/request'
import { registerDomain } from './registration'

export function registerChatHandlers({ service, approvals }: ChatRuntime): () => void {
  return registerDomain(ipcMain, ipc => {
    ipc.handle('ai:stream', async (event, rawRequest) => {
      const request = parseAIStreamRequest(rawRequest)
      if (!request) return { ok: false, error: 'AI 请求参数无效。' }
      const result = await service.run(event.sender, request)
      // This event follows all text/tool sends. The invoke response itself is
      // not an event-queue barrier and may arrive at the renderer first.
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream-event', { requestId: request.requestId, chunk: '', done: true })
      return { ...result, waitForStreamEnd: true }
    })
    ipc.on('ai:cancel', (event, requestId: unknown) => {
      if (typeof requestId === 'string') service.cancel(event.sender.id, requestId)
    })
    ipc.on('ai:resolve-tool-request', (event, approvalId: unknown, approved: unknown) => {
      if (typeof approvalId === 'string' && typeof approved === 'boolean') approvals.resolve(event.sender.id, approvalId, approved)
    })
  })
}
