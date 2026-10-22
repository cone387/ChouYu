import type Database from 'better-sqlite3'
import type { ChatSession, Message } from '../../shared/conversations'
import { ApplicationMetadataRepository } from './application-metadata'

export class ConversationRepository {
  constructor(private db: Database.Database, private metadata: ApplicationMetadataRepository) {}
  readSession(id: string): ChatSession | null {
    const row = this.db.prepare('SELECT value FROM sessions WHERE id=?').get(id) as { value: string } | undefined
    if (!row) return null
    const messages = (this.db.prepare('SELECT value FROM messages WHERE session_id=? ORDER BY position').all(id) as { value: string }[]).map(r => JSON.parse(r.value) as Message)
    return { ...JSON.parse(row.value), messages }
  }
  listSessions(): ChatSession[] {
    return (this.db.prepare('SELECT id FROM sessions ORDER BY position').all() as { id: string }[]).map(row => this.readSession(row.id)!)
  }
  saveSession(session: ChatSession): void {
    this.db.transaction(() => {
      const { messages, ...metadata } = session
      this.db.prepare('INSERT INTO sessions(id,position,value) VALUES(?,(SELECT count(*) FROM sessions),?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE value<>excluded.value').run(session.id, JSON.stringify(metadata))
      const put = this.db.prepare(`INSERT INTO messages(session_id,id,position,value) VALUES(?,?,?,?)
        ON CONFLICT(session_id,id) DO UPDATE SET position=excluded.position,value=excluded.value WHERE position<>excluded.position OR value<>excluded.value`)
      const ids = new Set<string>()
      messages.forEach((message, position) => {
        if (ids.has(message.id)) throw new Error('Duplicate message ID')
        ids.add(message.id); put.run(session.id, message.id, position, JSON.stringify(message))
      })
      for (const row of this.db.prepare('SELECT id FROM messages WHERE session_id=?').all(session.id) as { id: string }[]) {
        if (!ids.has(row.id)) this.db.prepare('DELETE FROM messages WHERE session_id=? AND id=?').run(session.id, row.id)
      }
    })()
  }
  orderSessions(ids: string[]): void {
    const order = this.db.prepare('UPDATE sessions SET position=? WHERE id=? AND position<>?')
    ids.forEach((id, position) => order.run(position, id, position))
  }
  deleteSession(id: string): void { this.db.prepare('DELETE FROM sessions WHERE id=?').run(id) }
  appendDelivered(input: { sessionId: string; message: Message; receiptKeys: string[] }): void {
    this.db.transaction(() => {
      if (input.receiptKeys.length && input.receiptKeys.every(key => this.metadata.getState(key))) return
      const session = this.readSession(input.sessionId)
      if (!session) throw new Error('Session missing')
      session.messages.push(input.message); session.updatedAt = input.message.timestamp
      this.saveSession(session)
      for (const key of input.receiptKeys) this.metadata.setState(key, 'delivered')
    })()
  }
  markRead(id: string, messageId?: string): void {
    const session = this.readSession(id)
    if (!session) throw new Error('Session missing')
    const end = messageId ? session.messages.findIndex(m => m.id === messageId) : session.messages.length - 1
    if (end < 0) return
    session.lastReadAt = session.messages.slice(0, end + 1).reduce((n, m) => Math.max(n, m.timestamp, m.replyCompletedAt ?? 0), Math.max(session.lastReadAt ?? 0, messageId ? 0 : Date.now()))
    this.saveSession(session)
  }
}
