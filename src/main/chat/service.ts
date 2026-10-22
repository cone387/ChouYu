import type { EventEmitter } from 'node:events'
import type { AIStreamRequest, AIStreamResult } from '../../shared/ai'
import { bindAIRequestLifecycle } from '../ai-request-lifecycle'

export interface ChatSender extends Pick<EventEmitter, 'on' | 'removeListener'> {
  id: number
  isDestroyed(): boolean
  send(channel: string, ...args: any[]): void
}
export interface ChatExecution {
  sender: ChatSender
  request: AIStreamRequest
  requestKey: string
  controller: AbortController
}
export interface ChatServiceOptions {
  execute(execution: ChatExecution): Promise<AIStreamResult>
  close?(): Promise<void>
}

/** Owns requests even during context preparation, before ContactAgent.Chat starts. */
export class ChatService {
  private active = new Map<string, AbortController>()
  private pending = new Set<Promise<AIStreamResult>>()
  private closed = false
  private closing?: Promise<void>
  constructor(private options: ChatServiceOptions) {}

  run(sender: ChatSender, request: AIStreamRequest): Promise<AIStreamResult> {
    if (this.closed || sender.isDestroyed()) return Promise.resolve({ ok: false, error: '聊天服务已关闭。' })
    const requestKey = `${sender.id}:${request.requestId}`
    this.active.get(requestKey)?.abort()
    const controller = new AbortController()
    this.active.set(requestKey, controller)
    const release = bindAIRequestLifecycle(sender, controller)
    const pending = Promise.resolve().then(() => this.options.execute({ sender, request: { ...request }, requestKey, controller }))
      .finally(() => {
        release()
        if (this.active.get(requestKey) === controller) this.active.delete(requestKey)
        this.pending.delete(pending)
      })
    this.pending.add(pending)
    return pending
  }

  cancel(senderId: number, requestId: string): void { this.cancelKey(`${senderId}:${requestId}`) }
  cancelKey(requestKey: string): void { this.active.get(requestKey)?.abort() }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    for (const controller of this.active.values()) controller.abort()
    // Closing Harness may itself be required to settle an in-flight provider/tool.
    const modules = Promise.resolve().then(() => this.options.close?.())
    this.closing = Promise.allSettled([modules, ...this.pending]).then(results => {
      const moduleResult = results[0]
      if (moduleResult.status === 'rejected') throw moduleResult.reason
    }).catch(error => { this.closing = undefined; throw error })
    return this.closing
  }
}
