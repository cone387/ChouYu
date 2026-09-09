import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initializeSaved } from '../journal/saved'
import { initializeJournalProjects, saveJournalProject, assignJournalProject } from '../journal/projects'
import { initializeJournalWeekly, weeklySources, createWeekly, editWeekly, deleteWeekly, listWeekly } from '../journal/weekly'

export function runJournalWeeklySmoke(): void {
  const file = join(app.getPath('userData'), 'weekly-fixture.db')
  let db = new Database(file)
  const source = { id: '11111111-2222-3333-4444-555555555555', title: '合成周报事项', note: '已核对', completed: true, task: { kind: 'progress', startedAt: 100, endedAt: 200, nextStep: '' }, activities: [], capture: null }
  const range = { from: 100, to: 1000 }
  const reject = (operation: () => unknown) => { let rejected = false; try { operation() } catch { rejected = true } if (!rejected) throw new Error('Invalid weekly operation was accepted') }
  try {
    initializeSaved(db); initializeJournalProjects(db); initializeJournalWeekly(db)
    db.prepare('INSERT INTO saved_items VALUES(?,1,?,NULL)').run(source.id, JSON.stringify(source))
    const outside = { ...source, id: '22222222-2222-3333-4444-555555555555', task: { ...source.task, startedAt: 1000, endedAt: 1000 } }
    db.prepare('INSERT INTO saved_items VALUES(?,1,?,NULL)').run(outside.id, JSON.stringify(outside))
    const candidates = weeklySources(db, range)
    if (candidates.length !== 1 || candidates[0].id !== source.id) throw new Error('Weekly date boundary included an out-of-range source')
    const selected = { ...range, sources: candidates }
    const first = createWeekly(db, selected)
    const second = editWeekly(db, { ...first, markdown: `${first.markdown}\n个人核对后的总结` })
    reject(() => editWeekly(db, first)); reject(() => deleteWeekly(db, first))
    const project = saveJournalProject(db, { name: '周报归属', description: '', archived: false, rules: [] })
    assignJournalProject(db, { savedId: source.id, projectId: project.id })
    reject(() => createWeekly(db, selected))
    const latest = weeklySources(db, range)
    db.prepare('UPDATE saved_items SET value=? WHERE id=?').run(JSON.stringify({ ...source, completed: false }), source.id)
    reject(() => createWeekly(db, { ...range, sources: latest }))
    reject(() => createWeekly(db, { ...range, sources: [] }))
    db.close(); db = new Database(file)
    if (listWeekly(db)[0].markdown !== second.markdown) throw new Error('Weekly edits did not survive reopening SQLite')
    db.prepare('DELETE FROM saved_items WHERE id=?').run(source.id)
    const missing = listWeekly(db)[0]
    if (missing.missingSourceIds[0] !== source.id || missing.markdown !== second.markdown) throw new Error('Deleting weekly source damaged draft or hid missing evidence')
    deleteWeekly(db, missing)
    if (listWeekly(db).length || !db.prepare('SELECT id FROM saved_items WHERE id=?').get(outside.id)) throw new Error('Weekly deletion damaged unrelated sources')
    console.log('CHOUYU_JOURNAL_WEEKLY_SMOKE_PASSED date boundaries, changed source/project rejection, persistence, stale edits and independent deletion')
  } finally { db.close() }
}
