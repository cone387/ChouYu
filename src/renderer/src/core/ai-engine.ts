import { Message, AppConfig } from '../shared/types'

export type StreamCallback = (chunk: string, done: boolean) => void

export interface ParsedStreamEvent {
  text: string
  done: boolean
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
    signal
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`API error ${response.status}: ${err}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  const finish = () => {
    if (completed) return
    completed = true
    onChunk('', true)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const event = parseOpenAIStreamLine(line)
      if (!event) continue
      if (event.text) onChunk(event.text, false)
      if (event.done) finish()
    }
  }

  finish()
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

  const response = await fetch(`${config.baseUrl}/messages`, {
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
    signal
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`API error ${response.status}: ${err}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  const finish = () => {
    if (completed) return
    completed = true
    onChunk('', true)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const event = parseClaudeStreamLine(line)
      if (!event) continue
      if (event.text) onChunk(event.text, false)
      if (event.done) finish()
    }
  }

  finish()
}
