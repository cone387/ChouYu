import { Message, AppConfig } from '../shared/types'
import type { AIStreamRequest } from '../../../shared/ai'
import {
  joinApiUrl,
  parseClaudeStreamLine,
  parseOpenAIStreamLine
} from '../../../shared/ai'

export { joinApiUrl, parseClaudeStreamLine, parseOpenAIStreamLine }
export type { ParsedStreamEvent } from '../../../shared/ai'

export type StreamCallback = (chunk: string, done: boolean) => void

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
  signal?: AbortSignal
): Promise<void> {
  if (!config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }
  if (signal?.aborted) throw createAbortError()

  const requestId = createRequestId()
  const request: AIStreamRequest = {
    requestId,
    systemPrompt,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      imageUrl: message.imageUrl
    }))
  }
  let completed = false
  const unsubscribe = window.electronAPI.ai.onStreamEvent((event) => {
    if (event.requestId !== requestId) return
    if (event.chunk) onChunk(event.chunk, false)
    if (event.done && !completed) {
      completed = true
      onChunk('', true)
    }
  })
  const abortRequest = () => window.electronAPI.ai.cancelStream(requestId)
  signal?.addEventListener('abort', abortRequest, { once: true })

  try {
    const result = await window.electronAPI.ai.startStream(request)
    if (signal?.aborted) throw createAbortError()
    if (!result.ok) throw new Error(result.error || 'AI 请求失败，请稍后重试。')
    if (!completed) {
      completed = true
      onChunk('', true)
    }
  } finally {
    signal?.removeEventListener('abort', abortRequest)
    unsubscribe()
  }
}
