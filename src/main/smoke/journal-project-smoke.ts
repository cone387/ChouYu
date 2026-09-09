import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initializeSaved } from '../journal/saved'
import { assignJournalProject, deleteJournalProject, initializeJournalProjects, readJournalProjects, saveJournalProject } from '../journal/projects'

export function runJournalProjectSmoke(): void {
  const file = join(app.getPath('userData'), 'project-fixture.db')
  let db = new Database(file)
  try {
    initializeSaved(db); initializeJournalProjects(db)
    db.prepare("INSERT INTO saved_items VALUES('saved',1,'{}',NULL)").run()
    const project = saveJournalProject(db, { name: '项目 A', description: '合成项目', archived: false, rules: [{ app: 'editor', title: '' }] })
    assignJournalProject(db, { savedId: 'saved', projectId: project.id })
    db.close(); db = new Database(file); initializeJournalProjects(db)
    if (readJournalProjects(db).assignments[0]?.projectId !== project.id || readJournalProjects(db).projects[0].description !== '合成项目') throw new Error('Project state did not survive reopening')
    let rejected = false
    try { saveJournalProject(db, { ...project, id: undefined, name: '项目 a' }) } catch { rejected = true }
    if (!rejected || readJournalProjects(db).projects.length !== 1) throw new Error('Duplicate project name was accepted')
    deleteJournalProject(db, project.id)
    if (readJournalProjects(db).assignments[0].projectId !== null || !(db.prepare("SELECT id FROM saved_items WHERE id='saved'").get())) throw new Error('Deleting project removed saved source or lost explicit unassignment')
    rejected = false
    try { assignJournalProject(db, { savedId: 'saved', projectId: project.id }) } catch { rejected = true }
    if (!rejected) throw new Error('Assignment to deleted project was accepted')
    assignJournalProject(db, { savedId: 'saved', projectId: null, automatic: true })
    if (readJournalProjects(db).assignments.length) throw new Error('Resetting automatic matching retained manual override')
    assignJournalProject(db, { savedId: 'saved', projectId: null })
    db.prepare("DELETE FROM saved_items WHERE id='saved'").run()
    if (readJournalProjects(db).assignments.length) throw new Error('Deleted saved item retained project assignment')
    console.log('CHOUYU_JOURNAL_PROJECT_SMOKE_PASSED persistence, duplicate names, assignment correction and deletion boundaries')
  } finally { db.close() }
}
