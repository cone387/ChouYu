export const DEFAULT_SESSION_TITLE = '新对话'
export const MAX_SESSION_TITLE_LENGTH = 80
export const MAX_SESSION_MESSAGES = 500

export interface SessionMessageLike {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
  imageUrl?: string
}

export interface SessionSummaryLike {
  title: string
  preview: string
}

export function normalizeSessionTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.slice(0, MAX_SESSION_TITLE_LENGTH) || DEFAULT_SESSION_TITLE
}

export function deriveSessionTitle(messages: readonly SessionMessageLike[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUserMessage) return DEFAULT_SESSION_TITLE
  const firstLine = firstUserMessage.content
    .replace(/^\[附件:[^\]]+\]\s*/g, '')
    .split(/\r?\n/)[0]
  return normalizeSessionTitle(firstLine).slice(0, 36)
}

export function buildSessionPreview(messages: readonly SessionMessageLike[]): string {
  const latest = [...messages].reverse().find((message) => message.content.trim())
  if (!latest) return '还没有消息'
  return latest.content.replace(/\s+/g, ' ').trim().slice(0, 72)
}

export function filterSessionSummaries<T extends SessionSummaryLike>(sessions: readonly T[], query: string): T[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...sessions]
  return sessions.filter((session) =>
    session.title.toLowerCase().includes(normalized) || session.preview.toLowerCase().includes(normalized)
  )
}

export function formatSessionMarkdown(
  session: { title: string; createdAt: number; messages: readonly SessionMessageLike[] },
  exportedAt = Date.now()
): string {
  const lines = [
    `# ${session.title}`,
    '',
    `- 创建时间：${new Date(session.createdAt).toLocaleString('zh-CN')}`,
    `- 导出时间：${new Date(exportedAt).toLocaleString('zh-CN')}`,
    ''
  ]

  for (const message of session.messages) {
    const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? 'ChouYu' : '系统'
    const timestamp = message.timestamp ? ` · ${new Date(message.timestamp).toLocaleString('zh-CN')}` : ''
    lines.push(`## ${role}${timestamp}`, '')
    if (message.imageUrl) lines.push('> [图片附件]', '')
    lines.push(message.content || '（空消息）', '')
  }

  return lines.join('\n').trimEnd() + '\n'
}
