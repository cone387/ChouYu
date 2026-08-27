export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageUrl?: string
}

export interface AIStreamRequest {
  requestId: string
  messages: AIChatMessage[]
  systemPrompt: string
}

export interface AIStreamEvent {
  requestId: string
  chunk: string
  done: boolean
}

export interface AIStreamResult {
  ok: boolean
  error?: string
}

export interface ParsedStreamEvent {
  text: string
  done: boolean
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
