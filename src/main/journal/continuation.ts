import type { JournalSavedItem, JournalTask } from '../../shared/journal'

/** ID alone is insufficient: SQLite can reuse deleted activity row IDs. */
export function matchesContinuation(task: JournalTask, saved: JournalSavedItem, range: { from: number; to: number }): boolean {
  if (saved.kind !== 'continuation') return false
  if (saved.sourceRange && (saved.sourceRange.from !== range.from || saved.sourceRange.to !== range.to)) return false
  if (saved.task.endedAt < task.startedAt || saved.task.startedAt > task.endedAt) return false
  const current = new Set(task.sourceIds)
  const previous = new Set(saved.task.sourceIds)
  const overlap = [...previous].filter(id => current.has(id)).length
  return overlap > 0 && (saved.task.id === task.id || overlap / Math.max(current.size, previous.size) > .5)
}

export function continuationCandidates(tasks: JournalTask[]): JournalTask[] {
  return tasks.filter(task => task.organized && (task.nextStep?.trim() || task.kind === 'blocker'))
    .sort((a, b) => Number(b.kind === 'blocker') - Number(a.kind === 'blocker') || b.endedAt - a.endedAt)
    .slice(0, 5)
}
