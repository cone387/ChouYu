import type { MemoryRecord, MemoryType } from '../../shared/memory'

/** Missing fields preserve cached attributes; null explicitly clears nullable fields. */
export function remoteMemoryAttributes(metadata: Record<string, unknown>, current?: MemoryRecord) {
  const type = metadata.chouyu_type ?? current?.type ?? 'fact'
  const importance = metadata.chouyu_importance ?? current?.importance ?? .6
  const sensitivity = metadata.chouyu_sensitivity ?? current?.sensitivity ?? 'normal'
  const status = metadata.chouyu_status ?? current?.status ?? 'active'
  const expiresAt = metadata.chouyu_expires_at === undefined ? current?.expiresAt : metadata.chouyu_expires_at === null ? undefined : metadata.chouyu_expires_at
  const source = (key: string, previous?: string): string | undefined => {
    const value = metadata[key] === undefined ? previous : metadata[key] === null ? undefined : metadata[key]
    if (value !== undefined && (typeof value !== 'string' || !value || value.length > 128)) throw new Error('Mem0 来源属性无效，未更新缓存。')
    return value as string | undefined
  }
  if (!['fact', 'preference', 'person', 'project', 'workflow'].includes(String(type)) || typeof importance !== 'number' || !Number.isFinite(importance) || importance < 0 || importance > 1 ||
    !['normal', 'sensitive'].includes(String(sensitivity)) || (metadata.chouyu_status !== undefined && !['active', 'archived'].includes(String(metadata.chouyu_status))) ||
    (expiresAt !== undefined && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 8_640_000_000_000_000))) throw new Error('Mem0 记忆属性无效，未更新缓存。')
  // Non-nullable fields must not accept explicit null or coerced objects.
  for (const key of ['chouyu_type', 'chouyu_importance', 'chouyu_sensitivity', 'chouyu_status']) {
    if (metadata[key] === null || typeof metadata[key] === 'object') throw new Error('Mem0 记忆属性无效，未更新缓存。')
  }
  return { type: type as MemoryType, importance, sensitivity: sensitivity as MemoryRecord['sensitivity'], status: status as MemoryRecord['status'], expiresAt: expiresAt as number | undefined,
    sourceSessionId: source('chouyu_source_session_id', current?.sourceSessionId), sourceMessageId: source('chouyu_source_message_id', current?.sourceMessageId) }
}
