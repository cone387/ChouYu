import type Database from 'better-sqlite3'
import type { JournalActivity, JournalCapture, JournalDay, JournalEvidence } from '../../shared/journal'

export function readJournalDay(db: Database.Database, from: number, to: number): JournalDay {
  const activity = db.prepare(`SELECT COUNT(*) activityCount, COALESCE(SUM(MIN(endedAt,?)-MAX(startedAt,?)),0) durationMs,
    MAX(MIN(startedAt),?) firstAt, MIN(MAX(endedAt),?) lastAt FROM activities WHERE endedAt >= ? AND startedAt < ?`).get(to, from, from, to, from, to) as Omit<JournalDay, 'captureCount' | 'ocrReady' | 'ocrFailed' | 'apps'>
  const captures = db.prepare(`SELECT COUNT(*) captureCount, COALESCE(SUM(ocrStatus='ready' AND length(trim(ocrText))>0),0) ocrReady,
    COALESCE(SUM(ocrStatus='failed'),0) ocrFailed FROM captures WHERE capturedAt >= ? AND capturedAt < ?`).get(from, to) as Pick<JournalDay, 'captureCount' | 'ocrReady' | 'ocrFailed'>
  const apps = db.prepare(`SELECT app, COUNT(*) count, SUM(MIN(endedAt,?)-MAX(startedAt,?)) durationMs
    FROM activities WHERE endedAt >= ? AND startedAt < ? GROUP BY app ORDER BY durationMs DESC LIMIT 6`).all(to, from, from, to) as JournalDay['apps']
  return { ...activity, ...captures, apps }
}

/** Sample across the entire selected interval rather than dropping the morning first. */
export function readJournalEvidence(db: Database.Database, from: number, to: number, query = '') {
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
  const activities = db.prepare(`WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY startedAt,id) position,
    COUNT(*) OVER () total FROM activities WHERE endedAt >= ? AND startedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'))
    SELECT * FROM ranked WHERE (position-1) % MAX(1,CAST((total+199)/200 AS INTEGER))=0 OR position=total ORDER BY position`).all(from, to, pattern, pattern) as Array<JournalActivity & { total: number }>
  const captures = db.prepare(`WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY capturedAt,id) position,
    COUNT(*) OVER () total FROM captures WHERE capturedAt >= ? AND capturedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\'))
    SELECT * FROM ranked WHERE (position-1) % MAX(1,CAST((total+99)/100 AS INTEGER))=0 OR position=total ORDER BY position`).all(from, to, pattern, pattern, pattern) as Array<JournalCapture & { total: number }>
  const sources: JournalEvidence[] = [
    ...activities.map(item => ({ id: `activity:${item.id}`, at: Math.max(from, item.startedAt), endedAt: Math.min(to, item.endedAt), app: item.app, title: item.title, text: '' })),
    ...captures.map(item => ({ id: `capture:${item.id}`, at: item.capturedAt, app: item.app, title: item.title, text: item.ocrText.slice(0, 3000) }))
  ].sort((a, b) => a.at - b.at)
  const available = (activities[0]?.total || 0) + (captures[0]?.total || 0)
  return { sources, available, truncated: available > sources.length || captures.some(item => item.ocrText.length > 3000) }
}
