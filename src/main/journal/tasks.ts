import { createHash } from 'crypto'
import type Database from 'better-sqlite3'
import type { JournalActivity, JournalCapture, JournalSummary, JournalSummaryItem, JournalTask } from '../../shared/journal'

export interface TaskOverride {
  id: string; from: number; to: number; item: JournalSummaryItem
  title: string; category: string; note: string
}

export const taskId = (item: JournalSummaryItem) => item.id || `task:${createHash('sha256').update(JSON.stringify([[...new Set(item.sourceIds)].sort(), item.title || '', item.kind || 'activity'])).digest('hex').slice(0, 24)}`

/** Preserve identities for an unambiguous majority-overlap match across regenerations. */
export function reconcileTaskIds(items: JournalSummaryItem[], previous: JournalSummaryItem[]): JournalSummaryItem[] {
  const used = new Set<string>()
  return items.map(item => {
    const ids = new Set(item.sourceIds)
    const matches = previous.map(old => ({ old, score: old.sourceIds.filter(id => ids.has(id)).length / Math.max(ids.size, old.sourceIds.length, 1) }))
      .filter(match => match.score > .5 && !used.has(taskId(match.old))).sort((a, b) => b.score - a.score)
    const match = matches.length && (matches.length === 1 || matches[0].score > matches[1].score) ? matches[0].old : undefined
    const id = match ? taskId(match) : taskId(item)
    used.add(id)
    return { ...item, id }
  })
}

export function buildTasks(activities: JournalActivity[], captures: Pick<JournalCapture, 'id' | 'activityId' | 'capturedAt'>[], summary: JournalSummary | null, overrides: TaskOverride[]): JournalTask[] {
  const activityMap = new Map(activities.map(item => [item.id, item]))
  const captureMap = new Map(captures.map(item => [item.id, item]))
  const covered = new Set<number>()
  const edits = new Map(overrides.map(item => [item.id, item]))
  const items = [...(summary?.items || [])]
  for (const edit of overrides) if (!items.some(item => taskId(item) === edit.id)) items.push({ ...edit.item, id: edit.id })
  const resolve = (item: JournalSummaryItem, organized: boolean): JournalTask | null => {
    const sourceIds = item.sourceIds.filter(id => id.startsWith('activity:') ? activityMap.has(Number(id.slice(9))) : captureMap.has(id.slice(8)))
    const activityIds = [...new Set(sourceIds.map(id => id.startsWith('activity:') ? Number(id.slice(9)) : captureMap.get(id.slice(8))!.activityId))].filter(id => activityMap.has(id))
    if (!activityIds.length) return null
    const linked = activityIds.map(id => activityMap.get(id)!)
    const id = taskId(item), edit = edits.get(id)
    activityIds.forEach(value => covered.add(value))
    return { id, title: edit?.title || item.title || linked[0].title || '无窗口标题', text: item.text, kind: item.kind || 'activity', nextStep: item.nextStep,
      category: edit?.category || '', note: edit?.note || '', edited: Boolean(edit), organized,
      sourceIds, activityIds, captureIds: captures.filter(capture => activityIds.includes(capture.activityId)).map(capture => capture.id),
      apps: [...new Set(linked.map(value => value.app))], startedAt: Math.min(...linked.map(value => value.startedAt)), endedAt: Math.max(...linked.map(value => value.endedAt)),
      durationMs: linked.reduce((total, value) => total + value.endedAt - value.startedAt, 0) }
  }
  const tasks = items.map(item => resolve(item, Boolean(summary?.items.some(value => taskId(value) === taskId(item))) || !taskId(item).startsWith('activity:'))).filter((item): item is JournalTask => Boolean(item))
  for (const activity of activities) {
    if (covered.has(activity.id)) continue
    const item = resolve({ id: `activity:${activity.id}`, title: activity.title, text: '', sourceIds: [`activity:${activity.id}`] }, false)
    if (item) tasks.push(item)
  }
  return tasks.sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
}

export function readTaskData(db: Database.Database, from: number, to: number) {
  const activities = db.prepare('SELECT id,app,title,MAX(startedAt,?) startedAt,MIN(endedAt,?) endedAt FROM activities WHERE endedAt >= ? AND startedAt < ? ORDER BY startedAt DESC,id DESC').all(from, to, from, to) as JournalActivity[]
  // OCR is loaded only for the selected frame, not for every frame in a long day.
  const captures = db.prepare("SELECT id,activityId,app,title,capturedAt,width,height,bytes,ocrStatus,ocrError,'' ocrText FROM captures WHERE capturedAt >= ? AND capturedAt < ? ORDER BY capturedAt,id").all(from, to) as JournalCapture[]
  const row = db.prepare('SELECT value FROM summaries WHERE fromTs=? AND toTs=?').get(from, to) as { value: string } | undefined
  const summary: JournalSummary | null = row ? JSON.parse(row.value) : null
  const overrides = (db.prepare('SELECT value FROM task_overrides WHERE fromTs=? AND toTs=?').all(from, to) as { value: string }[]).map(row => JSON.parse(row.value) as TaskOverride)
  return { activities, captures, summary, overrides, tasks: buildTasks(activities, captures, summary, overrides) }
}

export function readCorrectedSummary(db: Database.Database, from: number, to: number): JournalSummary | null {
  const row = db.prepare('SELECT value FROM summaries WHERE fromTs=? AND toTs=?').get(from, to) as { value: string } | undefined
  if (!row) return null
  const summary = JSON.parse(row.value) as JournalSummary
  const overrides = (db.prepare('SELECT value FROM task_overrides WHERE fromTs=? AND toTs=?').all(from, to) as { value: string }[]).map(row => JSON.parse(row.value) as TaskOverride)
  return { ...summary, items: summary.items.map(item => {
    const edit = overrides.find(value => value.id === taskId(item))
    return edit ? { ...item, title: edit.title, category: edit.category, note: edit.note, edited: true } : item
  }) }
}

/** Remove edited derivatives if any of their original evidence was deleted. */
export function pruneTaskOverrides(db: Database.Database) {
  for (const row of db.prepare('SELECT id,value FROM task_overrides').all() as { id: string; value: string }[]) {
    const edit = JSON.parse(row.value) as TaskOverride
    if (edit.item.sourceIds.some(id => !db.prepare(id.startsWith('activity:') ? 'SELECT 1 FROM activities WHERE id=?' : 'SELECT 1 FROM captures WHERE id=?').get(id.startsWith('activity:') ? Number(id.slice(9)) : id.slice(8)))) db.prepare('DELETE FROM task_overrides WHERE id=?').run(row.id)
  }
}
