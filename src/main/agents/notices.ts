import { contactResultMessage } from './contact-message'
import type { DeliveryUpdate } from '../../shared/agent-delivery'
import { validateContactMessage } from '../../shared/contact-communication'
import type Database from 'better-sqlite3'
import type { AgentNotice, AgentReport, AgentTopic } from '../../shared/agents'

/** The outbox shares the report transaction; delivery acknowledgement is separate. */
export class AgentNotices {
  constructor(private db: Database.Database, private offerInteraction?: (notice: AgentNotice) => string | undefined) {
    db.exec(`CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      value TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', sent_at INTEGER);
      CREATE INDEX IF NOT EXISTS notices_character ON notices(character_id,state,sent_at);`)
  }
  enqueue(notice: AgentNotice) {
    const run = this.db.prepare('SELECT status FROM runs WHERE id=? AND character_id=? AND topic_id=?').get(notice.runId, notice.characterId, notice.topicId) as { status: string } | undefined
    if (!run) throw new Error('消息与联系人任务不匹配，未发送。')
    const communication = validateContactMessage(notice.content, notice.communication ?? {
      version: 1, characterId: notice.characterId,
      intent: notice.kind === 'question' ? 'question' : run.status === 'failed' || ['failure', 'resources'].includes(notice.purpose ?? '') ? 'blocker' : 'status',
      source: { kind: 'task', topicId: notice.topicId, runId: notice.runId }
    }, notice.characterId)
    if ((notice.kind === 'question') !== (communication.intent === 'question')) throw new Error('消息用途与待回复状态不匹配，未发送。')
    const source = communication.source
    if (source.kind !== 'task' || source.topicId !== notice.topicId || source.runId !== notice.runId) throw new Error('任务消息来源不匹配，未发送。')
    if (source.artifact) {
      const row = this.db.prepare('SELECT value FROM delivery_versions WHERE topic_id=? AND version=? AND run_id=?').get(notice.topicId, source.artifact.version, notice.runId) as { value: string } | undefined
      const saved = row && JSON.parse(row.value).sections.find((s: { id: string; runId: string }) => s.id === source.artifact!.sectionId && s.runId === notice.runId)
      if (!saved || !notice.content.endsWith(`${saved.title}\n\n${saved.body}`)) throw new Error('消息正文与已保存成果不一致，未发送。')
    }
    const interactionId = this.offerInteraction?.(notice)
    notice = { ...notice, communication, ...(interactionId ? { interactionId } : {}) }
    this.db.prepare('INSERT OR IGNORE INTO notices(id,character_id,value) VALUES(?,?,?)').run(notice.id, notice.characterId, JSON.stringify(notice))
  }
  progress(before: AgentTopic, after: AgentTopic, report: AgentReport, previous?: AgentReport, writing = false, deliveryChanged = false, section?: DeliveryUpdate['section'], version?: number) {
    const evidence = (r: AgentReport) => JSON.stringify(r.evidence.map(e => `${e.url}:${e.hash}`).sort())
    const ended = ['completed', 'abandoned'].includes(after.status) && before.status !== after.status
    if (section && !deliveryChanged && !ended && previous && evidence(previous) === evidence(report)) return
    if (previous && !ended && !deliveryChanged && !(before.judgement !== after.judgement && (evidence(previous) !== evidence(report) || writing && previous.body !== report.body))) return
    this.enqueue({ id: `${report.runId}:progress`, characterId: after.characterId, topicId: after.id, runId: report.runId,
      ...(section && version ? { communication: { version: 1 as const, characterId: after.characterId, intent: 'delivery' as const,
        source: { kind: 'task' as const, topicId: after.id, runId: report.runId, artifact: { version, sectionId: section.id } } } } : {}),
      topicRevision: after.revision, kind: 'progress', createdAt: Date.now(), content: contactResultMessage(after, report, section, ended) })
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
