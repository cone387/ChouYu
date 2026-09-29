import type { Message } from '../shared/types'
/** Keep local stream/edit content while incorporating new main-process messages. */
export function mergeForeignMessages(cached: Message[], incoming: Message[]): Message[] {
  const known = new Set(cached.map(message => message.id))
  const foreign = incoming.filter(message => !known.has(message.id))
  return foreign.length ? [...cached, ...foreign].sort((a, b) => a.timestamp - b.timestamp) : cached
}
