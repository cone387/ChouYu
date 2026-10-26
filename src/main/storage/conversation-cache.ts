import type { ChatSession, Message } from '../../shared/conversations'
/** Clean bodies are replaceable. Dirty bodies remain pinned even above the soft limit. */
export class ConversationCache {
  private entries = new Map<string, { messages: Message[]; bytes: number }>()
  constructor(private read: (id: string) => Message[], private dirty: (id: string) => boolean,
    private changed: (id: string) => void, private maxEntries = 8, private maxBytes = 8 * 1024 * 1024) {}
  get size(): number { return this.entries.size }
  attach(metadata: Omit<ChatSession, 'messages'>, initial?: Message[]): ChatSession {
    if (initial) this.put(metadata.id, initial)
    const session = { ...metadata } as ChatSession
    Object.defineProperty(session, 'messages', { enumerable: true, configurable: false,
      get: () => this.get(session.id), set: (messages: Message[]) => { this.changed(session.id); this.put(session.id, messages) } })
    return session
  }
  private get(id: string): Message[] {
    const entry = this.entries.get(id)
    if (entry) { this.entries.delete(id); this.entries.set(id, entry); return entry.messages }
    const messages = this.read(id)
    this.put(id, messages)
    return messages
  }
  private put(id: string, messages: Message[]) {
    this.entries.delete(id)
    this.entries.set(id, { messages, bytes: JSON.stringify(messages).length * 2 })
    this.trim(id)
  }
  trim(protectedId?: string): void {
    let bytes = [...this.entries.values()].reduce((n, entry) => n + entry.bytes, 0)
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break
      if (id === protectedId || this.dirty(id)) continue
      this.entries.delete(id); bytes -= entry.bytes
    }
  }
  remove(id: string): void { this.entries.delete(id) }
}
