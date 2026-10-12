import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export type ContactScope = { kind: 'contact' } | { kind: 'task'; topicId: string } | { kind: 'session'; sessionId: string }
export type DeliveryRef = { characterId: string; topicId: string; version: number; sectionId?: string }
export type TextAnchor = { start: number; end: number; quote: string; textHash: string }
export type ContentCitation = { ref: DeliveryRef; anchor?: TextAnchor }
export type ContactReadContext = { characterId: string; topicId?: string; sessionId?: string; query: string }
export type ContextReferences = { memories: { id: string; revision: number }[]; materials?: { id: string; version: number; start?: number; end?: number; topicId?: string }[] }
export type ContactContextRecord = ContextReferences & { characterId: string; requestId: string; status: 'completed' | 'failed'; truncated: boolean }
export function sanitizeContactContext(value: unknown): ContactContextRecord | undefined {
  const v = value as ContactContextRecord
  if (!v || !validId(v.characterId) || !validId(v.requestId) || !['completed', 'failed'].includes(v.status) || typeof v.truncated !== 'boolean' || !Array.isArray(v.memories) || v.memories.length > 12 || v.memories.some(m => !validId(m.id) || !Number.isSafeInteger(m.revision) || m.revision < 1)) return undefined
  const materials = Array.isArray(v.materials) ? v.materials.filter(m => validId(m.id) && Number.isSafeInteger(m.version) && m.version > 0 && (m.start === undefined || Number.isSafeInteger(m.start) && m.start >= 0) && (m.end === undefined || Number.isSafeInteger(m.end) && m.end >= (m.start ?? 0)) && (m.topicId === undefined || validId(m.topicId))).map(m => ({ id: m.id, version: m.version, start: m.start, end: m.end, topicId: m.topicId })) : undefined
  return { characterId: v.characterId, requestId: v.requestId, status: v.status, truncated: v.truncated, memories: v.memories.map(m => ({ id: m.id, revision: m.revision })), materials }
}
export type ContactSourceRef = { kind: 'conversation'; sessionId: string; messageId: string } | { kind: 'delivery'; ref: DeliveryRef } | { kind: 'research'; runId: string } | { kind: 'user'; at: number }
export type PortfolioQuery = { query?: string; topicId?: string; cursor?: string; favoritesOnly?: boolean; sort?: 'updated' | 'name' }
export type PortfolioItem = { ref: DeliveryRef; title: string; excerpt: string; createdAt: number; favorite: boolean; sections: { id: string; title: string; textHash: string; readHash: string | null }[] }
export type PortfolioPage = { items: PortfolioItem[]; nextCursor: string | null }
export type ReadingPosition = { ref: DeliveryRef; anchor?: TextAnchor; scrollRatio: number; updatedAt: number }
export interface ContactPortfolioAPI {
  validateCitation(characterId: string, citation: ContentCitation): Promise<ContentCitation>
  reviseCitation(characterId: string, topicRevision: number, citation: ContentCitation, feedback: string): Promise<import('./agents').AgentOverview>
  portfolio(characterId: string, query: PortfolioQuery): Promise<PortfolioPage>
  setDeliveryFavorite(characterId: string, topicId: string, value: boolean): Promise<void>
  saveDeliveryReading(characterId: string, position: ReadingPosition): Promise<void>
  deliveryReading(characterId: string, topicId: string): Promise<ReadingPosition | null>
}

const parser = unified().use(remarkParse).use(remarkGfm)
type TextNode = { type: string; value?: string; alt?: string; children?: TextNode[] }
/** Canonical visible Markdown text. All stored selection offsets are JS UTF-16. */
export function deliveryText(body: string): string {
  function project(node: TextNode): string {
    if (node.type === 'html' || node.type === 'definition' || node.type === 'footnoteDefinition') return ''
    if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
    if (node.type === 'break') return '\n'
    if (node.value !== undefined) return node.value
    const separator = ['root', 'blockquote', 'listItem'].includes(node.type) ? '\n\n' : ['list', 'table'].includes(node.type) ? '\n' : node.type === 'tableRow' ? '\t' : ''
    return (node.children ?? []).map(project).filter(Boolean).join(separator)
  }
  return project(parser.parse(body.replace(/\r\n?/g, '\n')) as TextNode).trim()
}
export function textHash(text: string): string { return bytesToHex(sha256(new TextEncoder().encode(text))) }
export function validateDeliveryRef(raw: unknown): DeliveryRef {
  const r = raw as DeliveryRef
  if (!r || typeof r !== 'object' || !validId(r.characterId) || !validId(r.topicId) || !Number.isSafeInteger(r.version) || r.version < 1 || (r.sectionId !== undefined && !validId(r.sectionId))) throw new Error('成果引用无效。')
  return { characterId: r.characterId, topicId: r.topicId, version: r.version, ...(r.sectionId === undefined ? {} : { sectionId: r.sectionId }) }
}
export function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('\0') }
export function validateAnchor(raw: unknown, text: string): TextAnchor {
  const a = raw as TextAnchor
  if (!a || !Number.isSafeInteger(a.start) || !Number.isSafeInteger(a.end) || a.start < 0 || a.end <= a.start || a.end > text.length || typeof a.quote !== 'string' || a.quote.length > 2000 || a.quote !== text.slice(a.start, a.end) || a.textHash !== textHash(text)) throw new Error('引文与已保存正文不一致，请重新选择。')
  return { start: a.start, end: a.end, quote: a.quote, textHash: a.textHash }
}
export function validatePortfolioQuery(raw: unknown): PortfolioQuery {
  const q = raw as PortfolioQuery
  if (!q || typeof q !== 'object' || Array.isArray(q) || (q.query !== undefined && (typeof q.query !== 'string' || q.query.length > 1000)) || (q.topicId !== undefined && !validId(q.topicId)) || (q.sort !== undefined && !['updated', 'name'].includes(q.sort)) || (q.favoritesOnly !== undefined && typeof q.favoritesOnly !== 'boolean') || (q.cursor !== undefined && (typeof q.cursor !== 'string' || !q.cursor || q.cursor.length > 64000))) throw new Error('成果查询条件无效。')
  return { query: q.query?.trim() ?? '', sort: q.sort ?? 'updated', favoritesOnly: q.favoritesOnly ?? false, ...(q.topicId === undefined ? {} : { topicId: q.topicId }), ...(q.cursor === undefined ? {} : { cursor: q.cursor }) }
}
