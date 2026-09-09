import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initializeSaved } from '../journal/saved'
import { initializeJournalProjects, saveJournalProject, deleteJournalProject } from '../journal/projects'
import { initializeJournalPlaybook, saveJournalPlaybook, listJournalPlaybook, deleteJournalPlaybook } from '../journal/playbook'

export function runJournalPlaybookSmoke(): void {
  const file = join(app.getPath('userData'), 'playbook-fixture.db')
  let db = new Database(file)
  const source = '11111111-2222-3333-4444-555555555555'
  const reject = (operation: () => unknown) => { let rejected = false; try { operation() } catch { rejected = true } if (!rejected) throw new Error('Invalid playbook operation was accepted') }
  try {
    initializeSaved(db); initializeJournalProjects(db); initializeJournalPlaybook(db)
    db.prepare('INSERT INTO saved_items VALUES(?,1,?,NULL)').run(source, '{}')
    const project = saveJournalProject(db, { name: '手册项目', description: '', archived: false, rules: [] })
    const first = saveJournalPlaybook(db, { title: '请求故障', problem: '请求迟迟不返回', attempts: '检查连接数', resolution: '', status: 'open', projectId: project.id, sourceIds: [source] })
    const second = saveJournalPlaybook(db, { ...first, resolution: '释放闲置连接后恢复', status: 'resolved' })
    reject(() => saveJournalPlaybook(db, { ...first, problem: '过时编辑' }))
    reject(() => deleteJournalPlaybook(db, { id: first.id, revision: first.revision }))
    db.close(); db = new Database(file)
    const persisted = listJournalPlaybook(db)[0]
    if (persisted.revision !== second.revision || persisted.resolution !== second.resolution || persisted.missingSourceIds.length) throw new Error('Playbook did not persist confirmed fields')
    db.prepare('DELETE FROM saved_items WHERE id=?').run(source)
    const missing = listJournalPlaybook(db)[0]
    if (missing.missingSourceIds[0] !== source || missing.problem !== first.problem) throw new Error('Missing evidence was not distinguished from user-authored content')
    const edited = saveJournalPlaybook(db, { ...missing, attempts: '保留来源缺失后的个人记录' })
    deleteJournalProject(db, project.id)
    const detached = listJournalPlaybook(db)[0]
    if (detached.projectId !== null || detached.revision !== edited.revision + 1) throw new Error('Deleted project did not detach playbook or invalidate stale editor')
    reject(() => saveJournalPlaybook(db, edited))
    reject(() => saveJournalPlaybook(db, { ...first, id: undefined, revision: undefined, projectId: null }))
    db.prepare('INSERT INTO saved_items VALUES(?,1,?,NULL)').run(source, '{}')
    deleteJournalPlaybook(db, { id: detached.id, revision: detached.revision })
    if (listJournalPlaybook(db).length || !db.prepare('SELECT id FROM saved_items WHERE id=?').get(source)) throw new Error('Deleting playbook removed source or retained entry')
    console.log('CHOUYU_JOURNAL_PLAYBOOK_SMOKE_PASSED persistence, stale-write protection, missing sources and independent deletion')
  } finally { db.close() }
}
