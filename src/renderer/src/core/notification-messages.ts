import type { Message } from '../shared/types'
import { messageReadTimestamp } from '../../../shared/conversation-projection'
/** Keep local stream/edit content while incorporating new main-process messages. */
export function mergeForeignMessages(cached: Message[], incoming: Message[], lastReadAt = 0): Message[] {
  const known = new Set(cached.map(message => message.id))
  const foreign = incoming.filter(message => !known.has(message.id))
  const snapshots = new Map(incoming.map(message => [message.id, message]))
  const merged = foreign.length ? [...cached, ...foreign].sort((a, b) => a.timestamp - b.timestamp) : cached
  let changed = false
  const updated = merged.map(message => {
    if (!message.reminderIds?.length) return message
    const readIds = new Set([...message.reminderReadIds ?? [], ...snapshots.get(message.id)?.reminderReadIds ?? []])
    if (messageReadTimestamp(message) <= lastReadAt) message.reminderIds.forEach(id => readIds.add(id))
    if (readIds.size === (message.reminderReadIds?.length ?? 0)) return message
    changed = true
    return { ...message, reminderReadIds: [...readIds] }
  })
  return changed ? updated : merged
}
