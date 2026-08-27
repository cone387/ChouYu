import type { AppConfig } from '../shared/config'
import {
  type AIChatMessage,
  joinApiUrl,
  parseClaudeStreamLine,
  parseOpenAIStreamLine
} from '../shared/ai'

export type AIStreamCallback = (chunk: string, done: boolean) => void

const REQUEST_TIMEOUT_MS = 60_000

interface RequestGuard {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
}

function createRequestGuard(externalSignal?: AbortSignal): RequestGuard {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) abortFromCaller()
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

function rethrowRequestError(error: unknown, guard: RequestGuard): never {
  if (guard.didTimeout()) {
    throw new Error('请求超过 60 秒未完成，请检查网络后重试。')
  }
  throw error
}

export async function streamAIChat(
  messages: AIChatMessage[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: AIStreamCallback,
  signal?: AbortSignal
): Promise<void> {
  if (!config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }

  console.log(`[AI] provider=${config.provider} model=${config.model} baseUrl=${config.baseUrl}`)
  if (config.provider === 'claude') {
    await streamClaude(messages, systemPrompt, config, onChunk, signal)
  } else {
    await streamOpenAI(messages, systemPrompt, config, onChunk, signal)
  }
}

function buildOpenAIContent(message: AIChatMessage): string | Array<{
  type: string
  text?: string
  image_url?: { url: string; detail?: string }
}> {
  if (!message.imageUrl) return message.content
  const parts: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = []
  parts.push({ type: 'text', text: message.content || '请看这张图片' })
  parts.push({ type: 'image_url', image_url: { url: message.imageUrl, detail: 'high' } })
  return parts
}

async function streamOpenAI(
  messages: AIChatMessage[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: AIStreamCallback,
  signal?: AbortSignal
): Promise<void> {
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((message) => ({ role: message.role, content: buildOpenAIContent(message) }))
  ]
  const guard = createRequestGuard(signal)

  try {
    const response = await fetch(joinApiUrl(config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ model: config.model, messages: apiMessages, stream: true }),
      signal: guard.signal
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2000)
      throw new Error(`API error ${response.status}: ${detail}`)
    }
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    await consumeStream(response.body, parseOpenAIStreamLine, onChunk)
  } catch (error) {
    rethrowRequestError(error, guard)
  } finally {
    guard.cleanup()
  }
}

function buildClaudeContent(message: AIChatMessage): string | Array<{
  type: string
  text?: string
  source?: { type: string; media_type: string; data: string }
}> {
  if (!message.imageUrl) return message.content
  const parts: Array<{
    type: string
    text?: string
    source?: { type: string; media_type: string; data: string }
  }> = []
  const match = message.imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (match) {
    parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
  }
  if (message.content) parts.push({ type: 'text', text: message.content })
  return parts.length > 0 ? parts : message.content
}

async function streamClaude(
  messages: AIChatMessage[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: AIStreamCallback,
  signal?: AbortSignal
): Promise<void> {
  const apiMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: buildClaudeContent(message)
    }))
  const guard = createRequestGuard(signal)

  try {
    const response = await fetch(joinApiUrl(config.baseUrl, 'messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: apiMessages,
        stream: true
      }),
      signal: guard.signal
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2000)
      throw new Error(`API error ${response.status}: ${detail}`)
    }
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    await consumeStream(response.body, parseClaudeStreamLine, onChunk)
  } catch (error) {
    rethrowRequestError(error, guard)
  } finally {
    guard.cleanup()
  }
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  parseLine: (line: string) => { text: string; done: boolean } | null,
  onChunk: AIStreamCallback
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  const finish = () => {
    if (completed) return
    completed = true
    onChunk('', true)
  }
  const consumeLine = (line: string) => {
    const event = parseLine(line)
    if (!event) return
    if (event.text) onChunk(event.text, false)
    if (event.done) finish()
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(consumeLine)
  }

  buffer += decoder.decode()
  if (buffer) buffer.split('\n').forEach(consumeLine)
  finish()
}
