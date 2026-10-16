import type { AIChatMessage } from '../../../../shared/ai'
import { joinApiUrl } from '../../../../shared/ai'
import type { AppConfig } from '../../../../shared/config'
import type { AIToolCall, AIToolDefinition } from '../../../../shared/tools'
import { readAIUsage, type AIResponseMetadata } from '../../../../shared/ai-usage'
import type { NativeConversation, NativeStreamCallback, NativeStreamOptions } from '../types'
import { createRequestGuard, rethrowRequestError, readSseStream, REQUEST_TIMEOUT_MS } from './request'

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

export function createOpenAIConversation(messages: AIChatMessage[], systemPrompt: string, definitions?: AIToolDefinition[]): NativeConversation {
  const apiMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...messages.map(message => ({ role: message.role, content: buildOpenAIContent(message) }))
  ]
  const tools = definitions?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
  return {
    serialize: () => JSON.stringify({ messages: apiMessages, tools }),
    request: (config, onChunk, signal, options) => streamOpenAIRound(apiMessages, config, onChunk, signal, tools, options),
    append(result, results) {
      apiMessages.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) })
      result.toolCalls.forEach((call, index) => apiMessages.push({ role: 'tool', tool_call_id: call.id, content: results[index] }))
    }
  }
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
  onChunk: NativeStreamCallback,
  signal?: AbortSignal,
  tools?: Array<Record<string, unknown>>,
  options: NativeStreamOptions = {}
): Promise<{ text: string; toolCalls: AIToolCall[] }> {
  const guard = createRequestGuard(signal, Math.min(180_000, Math.max(1000, options.timeoutMs ?? REQUEST_TIMEOUT_MS)), options.timeoutMs === undefined)
  try {
    const requestBody: Record<string, unknown> = { model: config.model, messages: apiMessages, stream: true }
    if (options.maxOutputTokens) requestBody.max_tokens = options.maxOutputTokens
    if (config.thinkingDisabledModels?.includes(config.model)) requestBody.thinking = { type: 'disabled' }
    if (options.onMetadata) requestBody.stream_options = { include_usage: true }
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
    if (!response.ok && requestBody.stream_options && [400, 422].includes(response.status) && /stream_options|include_usage/i.test(await response.clone().text())) {
      // Older compatible endpoints may explicitly reject usage reporting.
      await response.text()
      delete requestBody.stream_options
      response = await fetch(joinApiUrl(config.baseUrl, 'chat/completions'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(requestBody), signal: guard.signal
      })
    }
    if (!response.ok) throw new Error(`API error ${response.status}: ${(await response.text()).slice(0, 2000)}`)
    if (!response.body) throw new Error('API 返回了空响应，请稍后重试。')

    const accumulators = new Map<number, OpenAIToolAccumulator>()
    let metadata: AIResponseMetadata = {}
    let text = ''
    await readSseStream(response.body, (payload) => {
      guard.progress()
      if (options.onMetadata) { metadata = readAIUsage(payload, 'openai', metadata); options.onMetadata(metadata) }
      const delta = accumulateOpenAIToolCalls(payload, accumulators)
      if (delta.text) {
        guard.textProgress()
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

