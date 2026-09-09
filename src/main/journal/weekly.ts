import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import { listSaved } from './saved'
import { readJournalProjects } from './projects'
import { resolveJournalProject } from '../../shared/journal-projects'
import { validateWeeklyRange, weeklyDate, weeklyMarkdown, type JournalWeeklyCreate, type JournalWeeklyDraft, type JournalWeeklyEdit, type JournalWeeklyRange, type JournalWeeklySource } from '../../shared/journal-weekly'

export function initializeJournalWeekly(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS journal_weekly (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL)')
}
export function weeklySources(db: Database.Database, range: JournalWeeklyRange): JournalWeeklySource[] {
  const { from, to } = validateWeeklyRange(range), state = readJournalProjects(db)
  return listSaved(db).filter(item => item.task.startedAt < to && item.task.endedAt >= from).map(item => {
    const assignment = resolveJournalProject(item, state)
    const names = assignment.projectIds.map(id => state.projects.find(project => project.id === id)!.name).join(' / ')
    const value = { id: item.id, title: item.title, note: item.note, nextStep: item.task.nextStep || '', kind: item.task.kind, completed: item.completed, at: item.task.startedAt,
      project: assignment.mode === 'manual' ? names : names ? `${names}（规则建议，归属待确认）` : '' }
    return { ...value, signature: createHash('sha256').update(JSON.stringify(value)).digest('hex') }
  }).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}
export function listWeekly(db: Database.Database): JournalWeeklyDraft[] {
  const sources = new Set((db.prepare('SELECT id FROM saved_items').all() as { id: string }[]).map(row => row.id))
  return (db.prepare('SELECT id,revision,value FROM journal_weekly').all() as { id: string; revision: number; value: string }[])
    .map(row => { const value = JSON.parse(row.value); return { ...value, id: row.id, revision: row.revision, missingSourceIds: value.sourceIds.filter((id: string) => !sources.has(id)) } })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}
export function createWeekly(db: Database.Database, input: JournalWeeklyCreate): JournalWeeklyDraft {
  const range = validateWeeklyRange(input)
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 100 || input.sources.some(source => !source || typeof source.id !== 'string' || typeof source.signature !== 'string') || new Set(input.sources.map(source => source.id)).size !== input.sources.length) throw new Error('请确认选择 1–100 份不同收藏。')
  return db.transaction(() => {
    if ((db.prepare('SELECT COUNT(*) count FROM journal_weekly').get() as { count: number }).count >= 100) throw new Error('最多保留 100 份周报，请先整理。')
    const available = new Map(weeklySources(db, range).map(source => [source.id, source]))
    const selected = input.sources.map(source => {
      const current = available.get(source.id)
      if (!current || current.signature !== source.signature) throw new Error('选中收藏或项目归属已变化，请刷新来源后重新确认。')
      return current
    })
    const markdown = weeklyMarkdown(range, selected)
    if (markdown.length > 60_000) throw new Error('所选内容超过 60000 字，请减少来源后重试。')
    const now = Date.now(), draft: JournalWeeklyDraft = { ...range, id: randomUUID(), revision: 1, title: `周报 ${weeklyDate(range.from)} 至 ${weeklyDate(range.to - 1)}`, markdown, sourceIds: selected.map(source => source.id), missingSourceIds: [], createdAt: now, updatedAt: now }
    db.prepare('INSERT INTO journal_weekly VALUES(?,?,?)').run(draft.id, draft.revision, JSON.stringify(draft))
    return draft
  }).immediate()
}
export function editWeekly(db: Database.Database, input: JournalWeeklyEdit): JournalWeeklyDraft {
  if (!input || typeof input.id !== 'string' || !Number.isSafeInteger(input.revision) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || typeof input.markdown !== 'string' || !input.markdown.trim() || input.markdown.length > 60_000) throw new Error('周报标题需为 1–120 字，正文需为 1–60000 字。')
  return db.transaction(() => {
    const current = listWeekly(db).find(draft => draft.id === input.id)
    if (!current || current.revision !== input.revision) throw new Error('周报已修改或删除，请刷新后重新核对。')
    const next = { ...current, title: input.title.trim(), markdown: input.markdown, revision: current.revision + 1, updatedAt: Date.now() }
    db.prepare('UPDATE journal_weekly SET revision=?,value=? WHERE id=?').run(next.revision, JSON.stringify(next), next.id)
    return next
  }).immediate()
}
export function deleteWeekly(db: Database.Database, input: { id: string; revision: number }): void {
  if (!input || typeof input.id !== 'string' || !Number.isSafeInteger(input.revision)) throw new Error('无效周报版本。')
  if (!db.prepare('DELETE FROM journal_weekly WHERE id=? AND revision=?').run(input.id, input.revision).changes) throw new Error('周报已修改或删除，请刷新。')
}
