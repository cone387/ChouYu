import type { AppConfig } from '../shared/config'
import {
  type AIChatMessage,
  type AIModelListErrorCode,
  type AIModelListResult,
  joinApiUrl,
  parseClaudeStreamLine,
  parseOpenAIStreamLine
} from '../shared/ai'
import type { AIToolCall, AIToolDefinition } from '../shared/tools'

export type AIStreamCallback = (chunk: string, done: boolean) => void

export interface AIToolRuntime {
  definitions: AIToolDefinition[]
  execute: (call: AIToolCall) => Promise<string>
}

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
  signal?: AbortSignal,
  toolRuntime?: AIToolRuntime
): Promise<void> {
  if (!config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }

  console.log(`[AI] provider=${config.provider} model=${config.model} baseUrl=${config.baseUrl}`)
  if (config.provider === 'claude') {
    await streamClaude(messages, systemPrompt, config, onChunk, signal, toolRuntime)
  } else {
    await streamOpenAI(messages, systemPrompt, config, onChunk, signal, toolRuntime)
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
  signal?: AbortSignal,
  toolRuntime?: AIToolRuntime
): Promise<void> {
  const apiMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...messages.map((message) => ({ role: message.role, content: buildOpenAIContent(message) }))
  ]
  const tools = toolRuntime?.definitions.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
  }))

  for (let round = 0; round < 4; round++) {
    const result = await streamOpenAIRound(apiMessages, config, onChunk, signal, tools)
    if (result.toolCalls.length === 0 || !toolRuntime) {
      onChunk('', true)
      return
    }

    apiMessages.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    })
    for (const call of result.toolCalls) {
      const content = await toolRuntime.execute(call)
      apiMessages.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }
  throw new Error('工具调用次数超过安全上限。')
}

interface OpenAIToolAccumulator {
  id: string
  name: string
  arguments: string
}

export function accumulateOpenAIToolCalls(
  payload: unknown,
  accumulators: Map<number, OpenAIToolAccumulator>
): { text: string } {
  const record = payload && typeof payload === 'object' ? payload as Record<string, any> : {}
  const delta = record.choices?.[0]?.delta || {}
  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
  for (const item of toolCalls) {
    const index = Number.isInteger(item?.index) ? item.index : 0
    const current = accumulators.get(index) || { id: '', name: '', arguments: '' }
    if (typeof item?.id === 'string') current.id += item.id
    if (typeof item?.function?.name === 'string') current.name += item.function.name
    if (typeof item?.function?.arguments === 'string') current.arguments = (current.arguments + item.function.arguments).slice(0, 50_000)
    accumulators.set(index, current)
  }
  return { text: typeof delta.content === 'string' ? delta.content : '' }
}

async function streamOpenAIRound(
  apiMessages: Array<Record<string, unknown>>,
  config: AppConfig,
  onChunk: AIStreamCallback,
  signal?: AbortSignal,
  tools?: Array<Record<string, unknown>>
): Promise<{ text: string; toolCalls: AIToolCall[] }> {
  const guard = createRequestGuard(signal)
  try {
    const requestBody: Record<string, unknown> = { model: config.model, messages: apiMessages, stream: true }
    if (tools?.length) {
      requestBody.tools = tools
      requestBody.tool_choice = 'auto'
    }
    let response = await fetch(joinApiUrl(config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: guard.signal
    })
    if (!response.ok && tools?.length && [400, 404, 422].includes(response.status)) {
      console.warn(`[AI] ${config.model} rejected tool definitions; retrying without tools`)
      await response.text().catch(() => '')
      delete requestBody.tools
      delete requestBody.tool_choice
      response = await fetch(joinApiUrl(config.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(requestBody),
        signal: guard.signal
      })
    }
    if (!response.ok) throw new Error(`API error ${response.status}: ${(await response.text()).slice(0, 2000)}`)
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    const accumulators = new Map<number, OpenAIToolAccumulator>()
    let text = ''
    await readSseStream(response.body, (payload) => {
      const delta = accumulateOpenAIToolCalls(payload, accumulators)
      if (delta.text) {
        text += delta.text
        onChunk(delta.text, false)
      }
    })
    const toolCalls = [...accumulators.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `tool_${Date.now()}_${index}`,
        name: call.name,
        arguments: call.arguments || '{}'
      }))
      .filter((call) => Boolean(call.name))
    return { text, toolCalls }
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
  signal?: AbortSignal,
  toolRuntime?: AIToolRuntime
): Promise<void> {
  const apiMessages: Array<Record<string, unknown>> = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: buildClaudeContent(message)
    }))
  const tools = toolRuntime?.definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }))

  for (let round = 0; round < 4; round++) {
    const result = await streamClaudeRound(apiMessages, systemPrompt, config, onChunk, signal, tools)
    if (result.toolCalls.length === 0 || !toolRuntime) {
      onChunk('', true)
      return
    }
    apiMessages.push({
      role: 'assistant',
      content: [
        ...(result.text ? [{ type: 'text', text: result.text }] : []),
        ...result.toolCalls.map((call) => ({
          type: 'tool_use', id: call.id, name: call.name, input: safeParseJson(call.arguments)
        }))
      ]
    })
    const toolResults = []
    for (const call of result.toolCalls) {
      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: await toolRuntime.execute(call) })
    }
    apiMessages.push({ role: 'user', content: toolResults })
  }
  throw new Error('工具调用次数超过安全上限。')
}

interface ClaudeToolAccumulator {
  id: string
  name: string
  arguments: string
}

export function accumulateClaudeToolCalls(
  payload: unknown,
  accumulators: Map<number, ClaudeToolAccumulator>
): { text: string } {
  const event = payload && typeof payload === 'object' ? payload as Record<string, any> : {}
  const index = Number.isInteger(event.index) ? event.index : 0
  if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    accumulators.set(index, {
      id: String(event.content_block.id || ''),
      name: String(event.content_block.name || ''),
      arguments: event.content_block.input && Object.keys(event.content_block.input).length
        ? JSON.stringify(event.content_block.input)
        : ''
    })
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
    const current = accumulators.get(index) || { id: '', name: '', arguments: '' }
    current.arguments = (current.arguments + String(event.delta.partial_json || '')).slice(0, 50_000)
    accumulators.set(index, current)
  }
  return {
    text: event.type === 'content_block_delta' && (event.delta?.type === 'text_delta' || typeof event.delta?.text === 'string')
      ? String(event.delta.text || '')
      : ''
  }
}

async function streamClaudeRound(
  apiMessages: Array<Record<string, unknown>>,
  systemPrompt: string,
  config: AppConfig,
  onChunk: AIStreamCallback,
  signal?: AbortSignal,
  tools?: Array<Record<string, unknown>>
): Promise<{ text: string; toolCalls: AIToolCall[] }> {
  const guard = createRequestGuard(signal)
  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      stream: true
    }
    if (tools?.length) requestBody.tools = tools
    let response = await fetch(joinApiUrl(config.baseUrl, 'messages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(requestBody),
      signal: guard.signal
    })
    if (!response.ok && tools?.length && [400, 404, 422].includes(response.status)) {
      console.warn(`[AI] ${config.model} rejected tool definitions; retrying without tools`)
      await response.text().catch(() => '')
      delete requestBody.tools
      response = await fetch(joinApiUrl(config.baseUrl, 'messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(requestBody),
        signal: guard.signal
      })
    }
    if (!response.ok) throw new Error(`API error ${response.status}: ${(await response.text()).slice(0, 2000)}`)
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    const accumulators = new Map<number, ClaudeToolAccumulator>()
    let text = ''
    await readSseStream(response.body, (payload) => {
      const delta = accumulateClaudeToolCalls(payload, accumulators)
      if (delta.text) {
        text += delta.text
        onChunk(delta.text, false)
      }
    })
    return {
      text,
      toolCalls: [...accumulators.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({
          id: call.id || `tool_${Date.now()}_${index}`,
          name: call.name,
          arguments: call.arguments || '{}'
        }))
        .filter((call) => Boolean(call.name))
    }
  } catch (error) {
    rethrowRequestError(error, guard)
  } finally {
    guard.cleanup()
  }
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function readSseStream(body: ReadableStream<Uint8Array>, onPayload: (payload: unknown) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trimStart()
    if (!data || data === '[DONE]') return
    try { onPayload(JSON.parse(data)) } catch {}
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
}
