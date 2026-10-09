import { progressText, type AgentProgressUpdate } from '../../shared/agent-progress'
import type Database from 'better-sqlite3'
import type { AgentNotice, AgentReport, AgentTopic } from '../../shared/agents'

/** The outbox shares the report transaction; delivery acknowledgement is separate. */
export class AgentNotices {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      value TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', sent_at INTEGER);
      CREATE INDEX IF NOT EXISTS notices_character ON notices(character_id,state,sent_at);`)
  }
  enqueue(notice: AgentNotice) {
    this.db.prepare('INSERT OR IGNORE INTO notices(id,character_id,value) VALUES(?,?,?)').run(notice.id, notice.characterId, JSON.stringify(notice))
  }
  progress(before: AgentTopic, after: AgentTopic, report: AgentReport, previous?: AgentReport, writing = false, deliveryChanged = false) {
    const evidence = (r: AgentReport) => JSON.stringify(r.evidence.map(e => `${e.url}:${e.hash}`).sort())
    const ended = ['completed', 'abandoned'].includes(after.status) && before.status !== after.status
    if (previous && !ended && !deliveryChanged && !(before.judgement !== after.judgement && (evidence(previous) !== evidence(report) || writing && previous.body !== report.body))) return
    const update: AgentProgressUpdate = {
      taskTitle: after.title, title: report.title, summary: after.judgement,
      nextStep: ended ? '' : after.nextStep,
      outcome: ended ? after.status === 'abandoned' ? 'abandoned' : 'completed' : writing ? 'delivered' : 'updated'
    }
    this.enqueue({ id: `${report.runId}:progress`, characterId: after.characterId, topicId: after.id, runId: report.runId,
      topicRevision: after.revision, kind: 'progress', createdAt: Date.now(), update, content: progressText(update) })
  }
  pending(id: string, _now = Date.now()): AgentNotice[] {
    const rows = this.db.prepare("SELECT id,value FROM notices WHERE character_id=? AND state='pending' ORDER BY rowid DESC").all(id) as { id: string; value: string }[]
    const seen = new Set<string>(), valid: AgentNotice[] = []
    for (const row of rows) {
      const notice = JSON.parse(row.value) as AgentNotice
      const run = this.db.prepare('SELECT status FROM runs WHERE id=? AND character_id=?').get(notice.runId, id) as { status: string } | undefined
      const topic = this.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(notice.topicId, id) as { value: string } | undefined
      const direction = notice.purpose === 'direction'
      const presentation = notice.purpose === 'presentation'
      const failure = notice.purpose === 'failure'
      const savedProgress = !notice.purpose && notice.kind === 'progress' && run?.status === 'completed' && Boolean(this.db.prepare('SELECT 1 FROM reports WHERE run_id=?').get(notice.runId))
      const key = `${notice.topicId}:${failure || savedProgress ? notice.runId : presentation ? `presentation:${notice.runId}` : direction ? 'direction' : notice.kind}`
      if (!run || !topic || (failure ? run.status !== 'failed' : savedProgress ? false : presentation ? !['completed', 'failed'].includes(run.status) : direction ? ['cancelled', 'failed'].includes(run.status) : JSON.parse(topic.value).revision !== notice.topicRevision) || (notice.kind === 'question' && run.status !== 'waiting') || seen.has(key)) {
        this.db.prepare("UPDATE notices SET state='suppressed' WHERE id=?").run(row.id)
      } else { seen.add(key); valid.push(notice) }
    }
    const profile = this.db.prepare('SELECT settings FROM profiles WHERE character_id=?').get(id) as { settings: string } | undefined
    if (!profile) return []
    const notifyProgress = JSON.parse(profile.settings).notifyProgress !== false
    return valid.sort((a, b) => Number(b.kind === 'question') - Number(a.kind === 'question') || Number(b.purpose === 'resources' || b.purpose === 'failure') - Number(a.purpose === 'resources' || a.purpose === 'failure') || a.createdAt - b.createdAt)
      .filter(n => n.kind === 'question' || n.purpose === 'resources' || n.purpose === 'presentation' || n.purpose === 'failure' || notifyProgress).slice(0, 32)
  }
  ack(id: string, noticeId: string, now = Date.now()) {
    this.db.prepare("UPDATE notices SET state='sent',sent_at=? WHERE id=? AND character_id=? AND state='pending'").run(now, noticeId, id)
  }
}
