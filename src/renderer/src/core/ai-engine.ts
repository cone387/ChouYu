import { Message, AppConfig } from '../shared/types'

export type StreamCallback = (chunk: string, done: boolean) => void

export interface ParsedStreamEvent {
  text: string
  done: boolean
}

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

export function joinApiUrl(baseUrl: string, endpoint: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(normalizedBase)
  } catch {
    throw new Error('Base URL 格式无效，请在设置中检查地址。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL 只支持 HTTP 或 HTTPS 地址。')
  }
  return `${normalizedBase}/${endpoint.replace(/^\/+/, '')}`
}

function rethrowRequestError(error: unknown, guard: RequestGuard): never {
  if (guard.didTimeout()) {
    throw new Error('请求超过 60 秒未完成，请检查网络后重试。')
  }
  throw error
}

function getSsePayload(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  return trimmed.slice(5).trimStart()
}

export function parseOpenAIStreamLine(line: string): ParsedStreamEvent | null {
  const payload = getSsePayload(line)
  if (payload === null) return null
  if (payload === '[DONE]') return { text: '', done: true }
  try {
    const json = JSON.parse(payload)
    return { text: json.choices?.[0]?.delta?.content || '', done: false }
  } catch {
    return null
  }
}

export function parseClaudeStreamLine(line: string): ParsedStreamEvent | null {
  const payload = getSsePayload(line)
  if (payload === null) return null
  try {
    const json = JSON.parse(payload)
    if (json.type === 'message_stop') return { text: '', done: true }
    if (json.type === 'content_block_delta') return { text: json.delta?.text || '', done: false }
  } catch {
    return null
  }
  return null
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
  if (config.provider === 'claude') {
    await streamClaude(messages, systemPrompt, config, onChunk, signal)
  } else {
    await streamOpenAI(messages, systemPrompt, config, onChunk, signal)
  }
}

function buildOpenAIContent(m: Message): string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> {
  if (!m.imageUrl) return m.content
  const parts: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = []
  if (m.content) {
    parts.push({ type: 'text', text: m.content })
  } else {
    parts.push({ type: 'text', text: '请看这张图片' })
  }
  parts.push({ type: 'image_url', image_url: { url: m.imageUrl, detail: 'high' } })
  return parts
}

async function streamOpenAI(
  messages: Message[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: StreamCallback,
  signal?: AbortSignal
): Promise<void> {
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: buildOpenAIContent(m) }))
  ]

  console.log('[AI] sending messages:', apiMessages.map((m) => ({
    role: m.role,
    contentType: Array.isArray(m.content) ? m.content.map((p) => p.type) : 'text',
    hasImage: Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  })))
  console.log('[AI] model:', config.model, '| baseUrl:', config.baseUrl)

  const guard = createRequestGuard(signal)
  try {
    const response = await fetch(joinApiUrl(config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: apiMessages,
        stream: true
      }),
      signal: guard.signal
    })

    if (!response.ok) {
      const err = (await response.text()).slice(0, 2000)
      throw new Error(`API error ${response.status}: ${err}`)
    }
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false

    const finish = () => {
      if (completed) return
      completed = true
      onChunk('', true)
    }
    const consumeLine = (line: string) => {
      const event = parseOpenAIStreamLine(line)
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
  } catch (error) {
    rethrowRequestError(error, guard)
  } finally {
    guard.cleanup()
  }
}

async function streamClaude(
  messages: Message[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: StreamCallback,
  signal?: AbortSignal
): Promise<void> {
  const apiMessages = messages.map((m) => {
    if (!m.imageUrl) return { role: m.role as 'user' | 'assistant', content: m.content }
    const parts: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = []
    if (m.imageUrl.startsWith('data:')) {
      const match = m.imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
      if (match) {
        parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
      }
    }
    if (m.content) parts.push({ type: 'text', text: m.content })
    return { role: m.role as 'user' | 'assistant', content: parts.length > 0 ? parts : m.content }
  })

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
      const err = (await response.text()).slice(0, 2000)
      throw new Error(`API error ${response.status}: ${err}`)
    }
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false

    const finish = () => {
      if (completed) return
      completed = true
      onChunk('', true)
    }
    const consumeLine = (line: string) => {
      const event = parseClaudeStreamLine(line)
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
  } catch (error) {
    rethrowRequestError(error, guard)
  } finally {
    guard.cleanup()
  }
}
