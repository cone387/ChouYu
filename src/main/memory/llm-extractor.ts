import type { AppConfig } from '../../shared/config'
import type { MemoryCandidateInput, MemoryType } from '../../shared/memory'
import { containsSecret, normalizeMemoryKey } from '../../shared/memory'
import { joinApiUrl } from '../../shared/ai'

export interface ExtractedMemory extends MemoryCandidateInput {
  certainty: 'explicit' | 'inferred' | 'uncertain'
  subject: 'self' | 'other' | 'unknown'
}

const MEMORY_TYPES = new Set<MemoryType>(['fact', 'preference', 'person', 'project', 'workflow'])
const SENSITIVE_MEMORY_PATTERN = /(?:邮箱|邮件|电话|手机号|住址|地址|身份证|生日|email|phone|address)/i
const MEMORY_SYSTEM_PROMPT = `你是 ChouYu 的记忆分析器。你的唯一任务是分析用户刚刚发送的消息，提取值得长期记住的、关于用户本人的稳定信息。

严格规则：
1. 只提取用户明确表达、且确实指向用户本人的信息；第三方、引用、假设、玩笑、问题、否定、猜测和模型回复都不要提取。
2. “我不知道”“我可能叫……”不是可靠姓名。像“我叫不上”这种既可能是短语、也可能被用户当作昵称的表达，返回一个 certainty=uncertain、confidence<=0.79 的 person 候选，交给用户确认；不要自动保存，也不要直接丢弃。
3. 记忆类型只能是 fact、preference、person、project、workflow。
4. person 的 content 必须是规范形式“我的名字是 <姓名>”；其他类型用简洁、完整的中文事实句。
5. action 只能为 remember 或 ignore。只有 action=remember 且 subject=self 才能进入候选。
6. certainty 只能为 explicit、inferred、uncertain。只有 explicit 的候选允许自动写入；inferred/uncertain 必须等待确认。
7. 不要提取密码、Token、API Key、身份证、电话、邮箱等敏感信息。
8. 只输出 JSON，不要 Markdown，不要解释：{"memories":[{"action":"remember|ignore","type":"fact|preference|person|project|workflow","content":"...","importance":0到1,"confidence":0到1,"certainty":"explicit|inferred|uncertain","subject":"self|other|unknown"}]}。没有候选时返回 {"memories":[]}。`

function unwrapJson(text: string): string {
  const trimmed = text.trim()
  const withoutFence = trimmed.startsWith('```')
    ? (() => {
        const firstBreak = trimmed.indexOf('\n')
        const lastFence = trimmed.lastIndexOf('```')
        return firstBreak >= 0 && lastFence > firstBreak ? trimmed.slice(firstBreak + 1, lastFence).trim() : trimmed
      })()
    : trimmed
  try {
    JSON.parse(withoutFence)
    return withoutFence
  } catch {
    const firstObject = withoutFence.indexOf('{')
    const lastObject = withoutFence.lastIndexOf('}')
    return firstObject >= 0 && lastObject > firstObject ? withoutFence.slice(firstObject, lastObject + 1) : withoutFence
  }
}

function readResponseText(payload: unknown, provider: AppConfig['provider']): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (provider === 'claude') {
    const content = Array.isArray(record.content) ? record.content : []
    const first = content.find((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string') as Record<string, unknown> | undefined
    return typeof first?.text === 'string' ? first.text : ''
  }
  const choices = Array.isArray(record.choices) ? record.choices : []
  const message = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).message : null
  return message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string'
    ? (message as Record<string, unknown>).content as string
    : ''
}

function normalizeCandidate(value: unknown): ExtractedMemory | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const type = String(item.type) as MemoryType
  const content = typeof item.content === 'string' ? item.content.trim().slice(0, 500) : ''
  const subject = item.subject === 'self' ? 'self' : item.subject === 'other' ? 'other' : 'unknown'
  const certainty = item.certainty === 'explicit' ? 'explicit' : item.certainty === 'inferred' ? 'inferred' : 'uncertain'
  const action = item.action === 'remember' ? 'remember' : 'ignore'
  if (action !== 'remember' || subject !== 'self' || !MEMORY_TYPES.has(type) || !content || containsSecret(content)) return null
  const importance = typeof item.importance === 'number' && Number.isFinite(item.importance) ? Math.min(1, Math.max(0, item.importance)) : 0.6
  const confidenceValue = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0.5
  const confidence = certainty === 'explicit' ? confidenceValue : Math.min(confidenceValue, 0.79)
  const sensitivity = item.sensitivity === 'sensitive' || SENSITIVE_MEMORY_PATTERN.test(content) ? 'sensitive' : 'normal'
  if (type === 'person' && !normalizeMemoryKey(content).startsWith(normalizeMemoryKey('我的名字是'))) {
    return { type, content: `我的名字是 ${content}`, importance, confidence, certainty, subject, sensitivity }
  }
  return { type, content, importance, confidence, certainty, subject, sensitivity }
}

export async function extractMemoriesWithLLM(text: string, config: AppConfig, request: typeof fetch = fetch): Promise<ExtractedMemory[]> {
  if (!text.trim() || !config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) return []
  const userMessage = `请分析下面这条用户消息，只返回规定 JSON。\n\n<user_message>\n${text.slice(0, 4000)}\n</user_message>`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: Record<string, unknown>
  let url: string
  if (config.provider === 'claude') {
    url = joinApiUrl(config.baseUrl, 'messages')
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = { model: config.model, max_tokens: 800, temperature: 0, system: MEMORY_SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }
  } else {
    url = joinApiUrl(config.baseUrl, 'chat/completions')
    headers.Authorization = `Bearer ${config.apiKey}`
    body = { model: config.model, temperature: 0, max_tokens: 800, messages: [{ role: 'system', content: MEMORY_SYSTEM_PROMPT }, { role: 'user', content: userMessage }] }
  }
  const response = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Memory extraction API error ${response.status}`)
  const output = readResponseText(await response.json(), config.provider)
  if (!output) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(output))
  } catch {
    return []
  }
  const items = parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).memories)
    ? (parsed as Record<string, unknown>).memories as unknown[]
    : []
  return items.map(normalizeCandidate).filter((item): item is ExtractedMemory => Boolean(item)).slice(0, 5)
}
