import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { validateJournalProject, type JournalProject, type JournalProjectInput, type JournalProjectState } from '../../shared/journal-projects'

export function initializeJournalProjects(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS journal_projects (id TEXT PRIMARY KEY, nameKey TEXT NOT NULL UNIQUE, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journal_project_assignments (savedId TEXT PRIMARY KEY, projectId TEXT);
    CREATE INDEX IF NOT EXISTS journal_project_assignment_project ON journal_project_assignments(projectId);
    CREATE TRIGGER IF NOT EXISTS journal_project_saved_delete AFTER DELETE ON saved_items BEGIN DELETE FROM journal_project_assignments WHERE savedId=old.id; END;
    CREATE TRIGGER IF NOT EXISTS journal_project_delete AFTER DELETE ON journal_projects BEGIN UPDATE journal_project_assignments SET projectId=NULL WHERE projectId=old.id; END;`)
}

export function readJournalProjects(db: Database.Database): JournalProjectState {
  return { projects: (db.prepare('SELECT value FROM journal_projects ORDER BY nameKey,id').all() as { value: string }[]).map(row => JSON.parse(row.value)),
    assignments: db.prepare('SELECT savedId,projectId FROM journal_project_assignments ORDER BY savedId').all() as JournalProjectState['assignments'] }
}

export function saveJournalProject(db: Database.Database, input: JournalProjectInput): JournalProject {
  const value = validateJournalProject(input)
  return db.transaction(() => {
    const existing = value.id ? db.prepare('SELECT value FROM journal_projects WHERE id=?').get(value.id) as { value: string } | undefined : undefined
    if (value.id && !existing) throw new Error('项目已删除，请刷新。')
    if (!existing && (db.prepare('SELECT COUNT(*) count FROM journal_projects').get() as { count: number }).count >= 100) throw new Error('最多保留 100 个项目。')
    const nameKey = value.name.normalize('NFKC').toLocaleLowerCase()
    const duplicate = db.prepare('SELECT id FROM journal_projects WHERE nameKey=?').get(nameKey) as { id: string } | undefined
    if (duplicate && duplicate.id !== value.id) throw new Error('已有同名项目，请使用其他名称。')
    const now = Date.now()
    const project: JournalProject = { ...value, id: value.id || randomUUID(), createdAt: existing ? JSON.parse(existing.value).createdAt : now, updatedAt: now }
    db.prepare('INSERT INTO journal_projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nameKey=excluded.nameKey,value=excluded.value').run(project.id, nameKey, JSON.stringify(project))
    return project
  }).immediate()
}

export function assignJournalProject(db: Database.Database, input: { savedId: string; projectId: string | null; automatic?: boolean }): void {
  if (!input || typeof input.savedId !== 'string' || !(input.projectId === null || typeof input.projectId === 'string') || input.automatic !== undefined && typeof input.automatic !== 'boolean') throw new Error('无效项目归属。')
  db.transaction(() => {
    if (!db.prepare('SELECT id FROM saved_items WHERE id=?').get(input.savedId)) throw new Error('收藏已删除，请刷新。')
    if (input.projectId !== null && !db.prepare('SELECT id FROM journal_projects WHERE id=?').get(input.projectId)) throw new Error('项目已删除，请刷新。')
    if (input.automatic) db.prepare('DELETE FROM journal_project_assignments WHERE savedId=?').run(input.savedId)
    else db.prepare('INSERT INTO journal_project_assignments VALUES(?,?) ON CONFLICT(savedId) DO UPDATE SET projectId=excluded.projectId').run(input.savedId, input.projectId)
  }).immediate()
}

export function deleteJournalProject(db: Database.Database, id: string): void {
  if (typeof id !== 'string' || !id) throw new Error('无效项目。')
  db.prepare('DELETE FROM journal_projects WHERE id=?').run(id)
}
