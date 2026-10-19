import { validateOutputPreference, type ContactOutputScope, type ContactOutputPreferenceRecord } from '../../shared/contact-output'
import { containsSecret } from '../../shared/memory'
import type { ContactTaskStore } from '../task-center/contact-store'

export class ContactOutputPreferences {
  constructor(private store: ContactTaskStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS contact_output_preferences (
      character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      scope_key TEXT NOT NULL, topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
      value TEXT NOT NULL, PRIMARY KEY(character_id,scope_key));
      CREATE TABLE IF NOT EXISTS contact_output_changes (
        id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
        scope_key TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);`)
  }
  private scope(owner: string, raw: ContactOutputScope): { key: string; scope: ContactOutputScope } {
    if (!this.store.profile(owner)) throw new Error('联系人不存在。')
    if (!raw || !['contact', 'task', 'delivery'].includes(raw.kind)) throw new Error('阅读偏好范围无效。')
    if (raw.kind === 'contact') return { key: 'contact', scope: { kind: 'contact' } }
    if (typeof raw.topicId !== 'string' || !raw.topicId) throw new Error('缺少实际任务。')
    this.store.topics.get(owner, raw.topicId)
    if (raw.kind === 'task') return { key: `task:${raw.topicId}`, scope: { kind: 'task', topicId: raw.topicId } }
    this.store.deliveries.get(raw.topicId, raw.version)
    if (!Number.isSafeInteger(raw.version) || raw.version < 1) throw new Error('缺少实际成果版本。')
    return { key: `delivery:${raw.topicId}:${raw.version}`, scope: { kind: 'delivery', topicId: raw.topicId, version: raw.version } }
  }
  get(owner: string, raw: ContactOutputScope): ContactOutputPreferenceRecord {
    const { key, scope } = this.scope(owner, raw)
    const row = this.store.db.prepare('SELECT value FROM contact_output_preferences WHERE character_id=? AND scope_key=?').get(owner, key) as { value: string } | undefined
    if (!row) return { scope, revision: 0, preference: {} }
    const value = JSON.parse(row.value) as ContactOutputPreferenceRecord
    return { scope, revision: value.revision, preference: validateOutputPreference(value.preference) }
  }
  list(owner: string, topicId?: string, version?: number): ContactOutputPreferenceRecord[] {
    if (version !== undefined && !topicId) throw new Error('成果阅读偏好缺少任务。')
    return [this.get(owner, { kind: 'contact' }), ...(topicId ? [this.get(owner, { kind: 'task', topicId }), ...(version === undefined ? [] : [this.get(owner, { kind: 'delivery', topicId, version })])] : [])]
  }
  catalogue(owner: string): ContactOutputPreferenceRecord[] {
    if (!this.store.profile(owner)) throw new Error('联系人不存在。')
    const rows = this.store.db.prepare('SELECT value FROM contact_output_preferences WHERE character_id=? ORDER BY scope_key').all(owner) as { value: string }[]
    return rows.map(row => { const value = JSON.parse(row.value) as ContactOutputPreferenceRecord; return this.get(owner, value.scope) })
  }
  save(owner: string, raw: ContactOutputScope, revision: number, patch: unknown, reason = '用户手动调整阅读偏好') {
    const preference = validateOutputPreference(patch)
    if (raw?.kind === 'delivery' && preference.instruction !== undefined) throw new Error('单次表达调整请提交正文修订；固定版本阅读偏好仅调整样式与间距。')
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000 || containsSecret(reason)) throw new Error('阅读偏好修改说明无效。')
    return this.store.db.transaction(() => {
      const { key, scope } = this.scope(owner, raw), before = this.get(owner, scope)
      if (!Number.isSafeInteger(revision) || revision !== before.revision) throw new Error('阅读偏好已变化，请重新读取。')
      const after: ContactOutputPreferenceRecord = { scope, revision: revision + 1, preference: { ...before.preference, ...preference } }
      this.store.db.prepare('INSERT INTO contact_output_preferences VALUES(?,?,?,?) ON CONFLICT(character_id,scope_key) DO UPDATE SET value=excluded.value').run(owner, key, scope.kind === 'contact' ? null : scope.topicId, JSON.stringify(after))
      this.store.db.prepare('INSERT INTO contact_output_changes(character_id,scope_key,before_value,after_value,reason,at) VALUES(?,?,?,?,?,?)').run(owner, key, JSON.stringify(before), JSON.stringify(after), reason.trim(), Date.now())
      return after
    }).immediate()
  }
}
