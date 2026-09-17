import type { ChatSessionSummary } from '../shared/types'

export function mergeSessionsInCurrentOrder(
  previous: ChatSessionSummary[],
  updated: ChatSessionSummary[]
): ChatSessionSummary[] {
  if (previous.length === 0) return updated
  const updatedById = new Map(updated.map((session) => [session.id, session]))
  const stable = previous.flatMap((session) => {
    const next = updatedById.get(session.id)
    if (!next) return []
    updatedById.delete(session.id)
    return [next]
  })
  // 新会话置顶，已有会话只更新内容，不因保存时间变化重新排队。
  return [...updatedById.values(), ...stable]
}
