import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { validateJournalPlaybook, type JournalPlaybookEntry, type JournalPlaybookInput } from '../../shared/journal-playbook'

export function initializeJournalPlaybook(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS journal_playbook (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, projectId TEXT, value TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS journal_playbook_project_delete AFTER DELETE ON journal_projects BEGIN
      UPDATE journal_playbook SET projectId=NULL,revision=revision+1 WHERE projectId=old.id;
    END;`)
}

export function listJournalPlaybook(db: Database.Database): JournalPlaybookEntry[] {
  const sources = new Set((db.prepare('SELECT id FROM saved_items').all() as { id: string }[]).map(row => row.id))
  return (db.prepare('SELECT id,revision,projectId,value FROM journal_playbook ORDER BY id').all() as { id: string; revision: number; projectId: string | null; value: string }[])
    .map(row => { const value = JSON.parse(row.value); return { ...value, id: row.id, revision: row.revision, projectId: row.projectId, missingSourceIds: value.sourceIds.filter((id: string) => !sources.has(id)) } })
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}

export function saveJournalPlaybook(db: Database.Database, raw: JournalPlaybookInput): JournalPlaybookEntry {
  const input = validateJournalPlaybook(raw)
  return db.transaction(() => {
    const old = input.id ? db.prepare('SELECT revision,value FROM journal_playbook WHERE id=?').get(input.id) as { revision: number; value: string } | undefined : undefined
    if (input.id && (!old || old.revision !== input.revision)) throw new Error('手册已修改或删除，请重新加载后再保存。')
    const previous = old ? JSON.parse(old.value) : undefined
    if (!old && (db.prepare('SELECT COUNT(*) count FROM journal_playbook').get() as { count: number }).count >= 200) throw new Error('最多保留 200 条踩坑手册，请先整理。')
    if (input.projectId && !db.prepare('SELECT id FROM journal_projects WHERE id=?').get(input.projectId)) throw new Error('项目已删除，请重新选择。')
    const exists = db.prepare('SELECT id FROM saved_items WHERE id=?')
    for (const id of input.sourceIds) if (!exists.get(id) && !previous?.sourceIds.includes(id)) throw new Error('关联收藏已删除，请重新选择来源。')
    const now = Date.now(), id = input.id || randomUUID(), revision = (old?.revision || 0) + 1
    const value = { ...input, id, revision, createdAt: previous?.createdAt || now, updatedAt: now }
    db.prepare('INSERT INTO journal_playbook VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,projectId=excluded.projectId,value=excluded.value').run(id, revision, input.projectId, JSON.stringify(value))
    return { ...value, missingSourceIds: input.sourceIds.filter(source => !exists.get(source)) }
  }).immediate()
}

export function deleteJournalPlaybook(db: Database.Database, input: { id: string; revision: number }): void {
  if (!input || typeof input.id !== 'string' || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('无效手册版本。')
  if (!db.prepare('DELETE FROM journal_playbook WHERE id=? AND revision=?').run(input.id, input.revision).changes) throw new Error('手册已修改或删除，请重新加载。')
}
