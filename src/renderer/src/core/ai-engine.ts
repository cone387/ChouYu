import { Message, AppConfig } from '../shared/types'
import type { AIStreamRequest } from '../../../shared/ai'
import {
  joinApiUrl,
  parseClaudeStreamLine,
  parseOpenAIStreamLine
} from '../../../shared/ai'

export { joinApiUrl, parseClaudeStreamLine, parseOpenAIStreamLine }
export type { ParsedStreamEvent } from '../../../shared/ai'

export type StreamCallback = (chunk: string, done: boolean, operation?:'append'|'replace') => void

let requestSequence = 0

function createRequestId(): string {
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER
  return `chat_${Date.now()}_${requestSequence}`
}

function createAbortError(): DOMException {
  return new DOMException('AI 请求已取消。', 'AbortError')
}

export async function streamChat(
  messages: Message[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: StreamCallback,
  signal?: AbortSignal,
  onRequestStart?: (requestId: string) => void,
  characterId?: string,
  sessionId?: string,
  onContactContext?: (context: import('../../../shared/contact-content').ContactContextRecord) => void,
  onHarnessSource?: (source:import('../../../shared/harness').HarnessSource)=>void
): Promise<void> {
  if (!characterId && !config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!characterId && !config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }
  if (signal?.aborted) throw createAbortError()

  const requestId = createRequestId()
  onRequestStart?.(requestId)
  const request: AIStreamRequest = {
    requestId,
    systemPrompt,
    characterId,
    sessionId,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      contactCitations: message.contactCitations,
      imageUrl: message.imageUrl
    }))
  }
  let completed = false
  const unsubscribe = window.electronAPI.ai.onStreamEvent((event) => {
    if (event.requestId !== requestId || signal?.aborted || completed) return
    if (event.operation) onChunk(event.chunk, false,event.operation)
    else if(event.chunk)onChunk(event.chunk,false)
    // The IPC result carries actual context references; attach them before final persistence.
  })
  const abortRequest = () => window.electronAPI.ai.cancelStream(requestId)
  signal?.addEventListener('abort', abortRequest, { once: true })

  try {
    const result = await window.electronAPI.ai.startStream(request)
    if (result.contactContext) onContactContext?.(result.contactContext)
    if (signal?.aborted) throw createAbortError()
    if (!result.ok) throw new Error(result.error || 'AI 请求失败，请稍后重试。')
    if(result.harnessSource)onHarnessSource?.(result.harnessSource)
    if (result.reply !== undefined && !completed) {
      if(result.operation)onChunk(result.reply,false,result.operation)
      else onChunk(result.reply, false)
    }
    if (!completed) {
      completed = true
      onChunk('', true)
    }
  } finally {
    signal?.removeEventListener('abort', abortRequest)
    unsubscribe()
  }
}
