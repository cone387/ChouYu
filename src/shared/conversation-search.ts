export function findTextMatch(text: string, query: string): { start: number; end: number } | null {
  const needle = query.trim()
  if (!needle) return null
  const match = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

export function searchExcerpt(text: string, query: string, radius = 60): string {
  const match = findTextMatch(text, query)
  if (!match) return text.slice(0, radius * 2)
  const start = Math.max(0, match.start - radius)
  const end = Math.min(text.length, match.end + radius)
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export function searchableMessageText(message: { content: string; toolData?: { displayName: string; summary?: string } }): string {
  return [message.content, message.toolData?.displayName, message.toolData?.summary].filter(Boolean).join('\n')
}
