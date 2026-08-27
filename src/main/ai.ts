import type { AppConfig } from '../shared/config'
import {
  type AIChatMessage,
  type AIModelListErrorCode,
  type AIModelListResult,
  joinApiUrl,
  parseClaudeStreamLine,
  parseOpenAIStreamLine
} from '../shared/ai'

export type AIStreamCallback = (chunk: string, done: boolean) => void

const REQUEST_TIMEOUT_MS = 60_000
const MODEL_LIST_TIMEOUT_MS = 10_000

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

function getModelEndpointCandidates(baseUrl: string): Array<{ baseUrl: string; url: string }> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const candidates = [{ baseUrl: normalizedBase, url: joinApiUrl(normalizedBase, 'models') }]
  if (!/\/v1$/i.test(normalizedBase)) {
    const v1BaseUrl = `${normalizedBase}/v1`
    candidates.push({ baseUrl: v1BaseUrl, url: joinApiUrl(v1BaseUrl, 'models') })
  }
  return candidates
}

function extractModelIds(value: unknown): string[] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const source = Array.isArray(value)
    ? value
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : null
  if (!source) return []
  return Array.from(new Set(source
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      const model = item as Record<string, unknown>
      const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : ''
      return id.trim()
    })
    .filter(Boolean)))
}

function modelListFailure(
  config: AppConfig,
  errorCode: AIModelListErrorCode,
  message: string,
  httpStatus?: number
): AIModelListResult {
  return {
    ok: false,
    models: [],
    baseUrl: config.baseUrl.trim(),
    baseUrlAdjusted: false,
    configuredModelValid: false,
    httpStatus,
    errorCode,
    message
  }
}

export async function fetchProviderModels(
  config: AppConfig,
  request: typeof fetch = fetch
): Promise<AIModelListResult> {
  if (!config.baseUrl.trim()) {
    return modelListFailure(config, 'missing-base-url', '请先填写 Base URL。')
  }
  if (!config.apiKey.trim()) {
    return modelListFailure(config, 'missing-api-key', '请先填写 API Key。')
  }

  let candidates: Array<{ baseUrl: string; url: string }>
  try {
    candidates = getModelEndpointCandidates(config.baseUrl)
  } catch (error) {
    return modelListFailure(config, 'invalid-url', error instanceof Error ? error.message : 'Base URL 格式无效。')
  }

  const headers = config.provider === 'claude'
    ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${config.apiKey}` }
  const failures: AIModelListResult[] = []

  for (const candidate of candidates) {
    try {
      const response = await request(candidate.url, {
        headers,
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
      })
      if (!response.ok) {
        const errorCode: AIModelListErrorCode = response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 404
            ? 'endpoint-not-found'
            : 'invalid-response'
        const message = errorCode === 'authentication'
          ? `认证失败（HTTP ${response.status}），请检查 API Key。`
          : errorCode === 'endpoint-not-found'
            ? `没有找到模型接口（HTTP ${response.status}）。`
            : `模型接口返回 HTTP ${response.status}。`
        failures.push(modelListFailure(config, errorCode, message, response.status))
        continue
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        failures.push(modelListFailure(config, 'invalid-response', '模型接口返回的不是 JSON，Base URL 可能缺少 /v1。', response.status))
        continue
      }
      const models = extractModelIds(payload)
      if (models.length === 0) {
        failures.push(modelListFailure(config, 'invalid-response', '接口已连接，但响应中没有可识别的模型列表。', response.status))
        continue
      }

      const originalBaseUrl = config.baseUrl.trim().replace(/\/+$/, '')
      const baseUrlAdjusted = candidate.baseUrl !== originalBaseUrl
      return {
        ok: true,
        models,
        baseUrl: candidate.baseUrl,
        baseUrlAdjusted,
        configuredModelValid: models.includes(config.model),
        httpStatus: response.status,
        message: baseUrlAdjusted
          ? `连接成功，已自动将 Base URL 修正为 ${candidate.baseUrl}。`
          : `连接成功，已获取 ${models.length} 个模型。`
      }
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      failures.push(modelListFailure(
        config,
        'network',
        timedOut ? '连接超时，请检查服务地址和网络。' : '无法连接服务，请检查 Base URL 和网络。'
      ))
    }
  }

  return failures.find((failure) => failure.errorCode === 'authentication')
    ?? failures.find((failure) => failure.errorCode === 'network')
    ?? failures[failures.length - 1]
    ?? modelListFailure(config, 'invalid-response', '未获取到可用模型。')
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
