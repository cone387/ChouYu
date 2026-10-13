import type Database from 'better-sqlite3'
import { latestCalendarAt, nextCalendarAt, type CalendarSchedule, type CalendarOccurrence } from '../../shared/calendar-schedule'

export type { CalendarOccurrence } from '../../shared/calendar-schedule'
interface CalendarRow { topic_id: string; revision: number; next_at: number; attempt_at: number | null; last_due_at: number | null; finished_at: number | null }
/** Uses the AgentStore transaction: claiming an occurrence and creating its run are atomic. */
export class ContactCalendars {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS contact_calendars (
      topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, next_at INTEGER NOT NULL, attempt_at INTEGER,
      last_due_at INTEGER, finished_at INTEGER);`)
  }
  get(topicId: string) { return this.db.prepare('SELECT * FROM contact_calendars WHERE topic_id=?').get(topicId) as CalendarRow | undefined }
  save(topicId: string, rule: CalendarSchedule, now: number) {
    const nextAt = nextCalendarAt(rule, now)
    this.db.prepare(`INSERT INTO contact_calendars(topic_id,revision,next_at) VALUES(?,1,?)
      ON CONFLICT(topic_id) DO UPDATE SET revision=revision+1,next_at=excluded.next_at,attempt_at=NULL,finished_at=NULL`).run(topicId, nextAt)
  }
  claim(topicId: string, rule: CalendarSchedule, now: number): CalendarOccurrence {
    const row = this.get(topicId)
    if (!row || row.finished_at || row.next_at > now) throw new Error('尚未到达安排时间。')
    const dueAt = row.attempt_at ?? Math.max(row.next_at, latestCalendarAt(rule, now) ?? row.next_at)
    this.db.prepare('UPDATE contact_calendars SET attempt_at=? WHERE topic_id=?').run(dueAt, topicId)
    return { revision: row.revision, dueAt, rule }
  }
  complete(topicId: string, occurrence: CalendarOccurrence | undefined, now: number): number | undefined {
    if (!occurrence) return
    const row = this.get(topicId)
    if (!row || row.revision !== occurrence.revision || row.attempt_at !== occurrence.dueAt) throw new Error('定时要求已变化，本轮不能提交。')
    const once = occurrence.rule.cadence === 'once'
    const nextAt = once ? row.next_at : nextCalendarAt(occurrence.rule, now)
    this.db.prepare('UPDATE contact_calendars SET next_at=?,last_due_at=?,attempt_at=NULL,finished_at=? WHERE topic_id=?')
      .run(nextAt, occurrence.dueAt, once ? now : null, topicId)
    return nextAt
  }
}
