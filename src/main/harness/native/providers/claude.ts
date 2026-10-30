import type { AIChatMessage } from '../../../../shared/ai'
import { joinApiUrl } from '../../../../shared/ai'
import type { AppConfig } from '../../../../shared/config'
import type { AIToolCall, AIToolDefinition } from '../../../../shared/tools'
import { readAIUsage, type AIResponseMetadata } from '../../../../shared/ai-usage'
import { beginUsageCall } from '../../../usage'
import type { NativeConversation, NativeStreamCallback, NativeStreamOptions } from '../types'
import { createRequestGuard, rethrowRequestError, readSseStream, REQUEST_TIMEOUT_MS } from './request'

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

export function createClaudeConversation(messages: AIChatMessage[], systemPrompt: string, definitions?: AIToolDefinition[]): NativeConversation {
  const apiMessages: Array<Record<string, unknown>> = messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({ role: message.role, content: buildClaudeContent(message) }))
  const tools = definitions?.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
  return {
    serialize: () => JSON.stringify({ messages: apiMessages, systemPrompt, tools }),
    request: (config, onChunk, signal, options) => streamClaudeRound(apiMessages, systemPrompt, config, onChunk, signal, tools, options),
    append(result, results) {
      apiMessages.push({ role: 'assistant', content: [
        ...(result.text ? [{ type: 'text', text: result.text }] : []),
        ...result.toolCalls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: safeParseJson(call.arguments) }))
      ] })
      apiMessages.push({ role: 'user', content: result.toolCalls.map((call, index) => ({ type: 'tool_result', tool_use_id: call.id, content: results[index] })) })
    }
  }
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
  onChunk: NativeStreamCallback,
  signal?: AbortSignal,
  tools?: Array<Record<string, unknown>>,
  options: NativeStreamOptions = {}
): Promise<{ text: string; toolCalls: AIToolCall[] }> {
  const guard = createRequestGuard(signal, Math.min(180_000, Math.max(1000, options.timeoutMs ?? REQUEST_TIMEOUT_MS)), options.timeoutMs === undefined)
  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      max_tokens: options.maxOutputTokens ?? 4096,
      system: systemPrompt,
      messages: apiMessages,
      stream: true
    }
    if (tools?.length) requestBody.tools = tools
    let usageCall = beginUsageCall(config.model)
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
      usageCall = beginUsageCall(config.model)
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
    let metadata: AIResponseMetadata = {}
    let text = ''
    await readSseStream(response.body, (payload) => {
      guard.progress()
      metadata = readAIUsage(payload, 'claude', metadata)
      usageCall.update(metadata)
      options.onMetadata?.(metadata)
      const delta = accumulateClaudeToolCalls(payload, accumulators)
      if (delta.text) {
        guard.textProgress()
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

