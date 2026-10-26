import type Database from 'better-sqlite3'
import type { ChatSession, Message, MessageCursor, MessagePage, ChatSessionSummary } from '../../shared/conversations'
import { projectConversation, type ConversationProjection } from '../../shared/conversation-projection'
import { findTextMatch, searchableMessageText, searchExcerpt } from '../../shared/conversation-search'
import { ApplicationMetadataRepository } from './application-metadata'

export class ConversationRepository {
  constructor(private db: Database.Database, private metadata: ApplicationMetadataRepository) {}
  listMetadata(): (Omit<ChatSession, 'messages'> & ConversationProjection)[] {
    return (this.db.prepare('SELECT value,projection FROM sessions ORDER BY position').all() as { value: string; projection: string }[])
      .map(row => ({ ...JSON.parse(row.value), ...JSON.parse(row.projection) }))
  }
  readMessages(id: string, before?: MessageCursor, limit = 100): MessagePage {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid page limit')
    if (before && (!Number.isSafeInteger(before.position) || before.position < 0 || typeof before.id !== 'string'
      || !this.db.prepare('SELECT 1 FROM messages WHERE session_id=? AND position=? AND id=?').get(id, before.position, before.id))) throw new Error('Conversation changed; reload history')
    const rows = this.db.prepare('SELECT id,position,value FROM messages WHERE session_id=? AND position<? ORDER BY position DESC LIMIT ?')
      .all(id, before?.position ?? Number.MAX_SAFE_INTEGER, limit + 1) as { id: string; position: number; value: string }[]
    const more = rows.length > limit, page = rows.slice(0, limit).reverse(), first = page[0]
    return { messages: page.map(row => JSON.parse(row.value)), before: more ? { position: first.position, id: first.id } : null }
  }
  search(query: string): ChatSessionSummary[] {
    // SQLite LIKE/NOCASE do not share JavaScript's Unicode /iu substring semantics.
    this.db.function('chouyu_text_match', { deterministic: true }, (value: unknown) => Number(Boolean(findTextMatch(String(value), query))))
    const rows = this.db.prepare(`SELECT s.projection,
      (SELECT m.search_text FROM messages m WHERE m.session_id=s.id AND chouyu_text_match(m.search_text) ORDER BY m.position LIMIT 1) AS match
      FROM sessions s WHERE chouyu_text_match(json_extract(s.value,'$.title')) OR EXISTS
      (SELECT 1 FROM messages m WHERE m.session_id=s.id AND chouyu_text_match(m.search_text)) ORDER BY s.position`)
      .all() as { projection: string; match: string | null }[]
    return rows.map(row => { const { summary } = JSON.parse(row.projection) as ConversationProjection
      return { ...summary, preview: row.match === null ? summary.preview : searchExcerpt(row.match, query) } })
  }
  noticeIds(owner: string): string[] {
    return (this.db.prepare(`SELECT m.id FROM messages m JOIN sessions s ON s.id=m.session_id
      WHERE json_extract(s.value,'$.characterId')=? AND m.id LIKE 'agent:%' AND json_extract(m.value,'$.agentNotice') IS NOT NULL`).all(owner) as { id: string }[]).map(row => row.id.slice(6))
  }
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
      this.db.prepare('INSERT INTO sessions(id,position,value,projection) VALUES(?,(SELECT count(*) FROM sessions),?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,projection=excluded.projection WHERE value<>excluded.value OR projection<>excluded.projection')
        .run(session.id, JSON.stringify(metadata), JSON.stringify(projectConversation(session)))
      const put = this.db.prepare(`INSERT INTO messages(session_id,id,position,value,search_text) VALUES(?,?,?,?,?)
        ON CONFLICT(session_id,id) DO UPDATE SET position=excluded.position,value=excluded.value,search_text=excluded.search_text WHERE position<>excluded.position OR value<>excluded.value OR search_text<>excluded.search_text`)
      const ids = new Set<string>()
      messages.forEach((message, position) => {
        if (ids.has(message.id)) throw new Error('Duplicate message ID')
        ids.add(message.id); put.run(session.id, message.id, position, JSON.stringify(message), searchableMessageText(message))
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
